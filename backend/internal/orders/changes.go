package orders

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"photobook/internal/pages"
)

// Правки книги после заявки. Клиент может менять книгу, пока заказ не в печати
// (Editable). Автосохранение приходит каждые пару секунд, поэтому правки
// копятся: books.SavePages отмечает время последней (orders.book_changed_at),
// а когда клиент затих на ChangeQuiet, RunChanges один раз пишет событие
// в историю, ставит сообщение в Telegram и пересборку PDF (новый снимок).

// ChangeQuiet — сколько клиент не правил книгу, чтобы считать правку законченной.
const ChangeQuiet = time.Minute

const changesPoll = 10 * time.Second

// RunChanges обрабатывает законченные правки, пока не отменят ctx.
func (s *Service) RunChanges(ctx context.Context, quiet time.Duration, log *slog.Logger) {
	for {
		did, err := s.SettleChanges(ctx, quiet)
		if err != nil {
			log.Error("book change after order failed", "err", err)
		}
		if did && err == nil {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(changesPoll):
		}
	}
}

// SettleChanges обрабатывает одну законченную правку (заявку, где клиент
// не правил книгу дольше quiet). false — таких нет.
func (s *Service) SettleChanges(ctx context.Context, quiet time.Duration) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) // после Commit ничего не делает

	var id, status string
	var number int64
	var version int
	err = tx.QueryRow(ctx, `
		SELECT o.id, o.number, o.status, b.version FROM orders o JOIN books b ON b.id = o.book_id
		WHERE o.status = ANY($1) AND o.book_changed_at IS NOT NULL
		  AND (o.change_settled_at IS NULL OR o.change_settled_at < o.book_changed_at)
		  AND o.book_changed_at < now() - $2::interval
		ORDER BY o.book_changed_at
		LIMIT 1 FOR UPDATE OF o SKIP LOCKED`, Editable, quiet,
	).Scan(&id, &number, &status, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO order_events (order_id, status, note) VALUES ($1, $2, $3)`,
		id, status, fmt.Sprintf("Клиент изменил книгу (версия книги %d), PDF пересобирается", version)); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO order_notices (order_id, kind, book_version) VALUES ($1, 'book_changed', $2)`,
		id, version); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE orders SET change_settled_at = now(), rendered_at = NULL, render_attempts = 0, render_error = NULL,
		                  render_reason = 'client_change', render_requested_at = now()
		WHERE id = $1`, id); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	select {
	case s.queued <- struct{}{}: // уведомление в Telegram
	default:
	}
	s.wakeRender()
	return true, nil
}

// Notice — сообщение в Telegram об изменении книги (для админки).
type Notice struct {
	CreatedAt time.Time
	SentAt    *time.Time
	Error     string
}

func (s *Service) lastNotice(ctx context.Context, orderID string) (*Notice, error) {
	var n Notice
	err := s.db.QueryRow(ctx, `
		SELECT created_at, sent_at, coalesce(error, '') FROM order_notices WHERE order_id = $1 ORDER BY id DESC LIMIT 1`,
		orderID).Scan(&n.CreatedAt, &n.SentAt, &n.Error)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("order notice: %w", err)
	}
	return &n, nil
}

// ErrInvalidText — после правки книга не проходит проверку (например, текст длиннее 1000 символов).
var ErrInvalidText = errors.New("edited text is not valid")

// TextEdit — новый текст блока: страница и элемент по id.
type TextEdit struct {
	PageID, ElementID, Text string
}

// EditTexts — администратор правит тексты книги по просьбе клиента (пока заказ
// не в печати). Пишет «изменено администратором» в историю и ставит пересборку
// PDF. Возвращает номера изменённых страниц (0 — обложка, pages+1 — задняя).
func (s *Service) EditTexts(ctx context.Context, number int64, edits []TextEdit, lib pages.Library) ([]int, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) // после Commit ничего не делает

	// Тот же порядок блокировок, что у автосохранения: сначала заявка, потом книга.
	var id, bookID, status string
	err = tx.QueryRow(ctx, `SELECT id, book_id, status FROM orders WHERE number = $1 FOR UPDATE`, number).Scan(&id, &bookID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !slices.Contains(Editable, status) {
		return nil, ErrNotEditable
	}
	var cover, back pages.Page
	var block []pages.Page
	if err := tx.QueryRow(ctx, `SELECT cover, pages, back_cover FROM books WHERE id = $1 FOR UPDATE`, bookID).
		Scan(&cover, &block, &back); err != nil {
		return nil, fmt.Errorf("load book: %w", err)
	}
	all := append(append([]pages.Page{cover}, block...), back)

	changed := map[int]bool{}
	for _, e := range edits {
		for pi := range all {
			if all[pi].ID != e.PageID {
				continue
			}
			for ei := range all[pi].Elements {
				el := &all[pi].Elements[ei]
				if el.ID == e.ElementID && el.Type == pages.Text && (el.Text == nil || *el.Text != e.Text) {
					text := e.Text
					el.Text = &text
					changed[pi] = true
				}
			}
		}
	}
	if len(changed) == 0 {
		return nil, nil
	}
	if err := pages.ValidateAll(all, lib); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidText, err)
	}
	n := len(all)
	if _, err := tx.Exec(ctx, `UPDATE books SET cover = $2, pages = $3, back_cover = $4, version = version + 1, updated_at = now() WHERE id = $1`,
		bookID, all[0], all[1:n-1], all[n-1]); err != nil {
		return nil, fmt.Errorf("save book: %w", err)
	}

	nums := make([]int, 0, len(changed))
	for pi := range changed {
		nums = append(nums, pi)
	}
	sort.Ints(nums)
	names := make([]string, len(nums))
	for i, pi := range nums {
		names[i] = PageName(pi, n)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO order_events (order_id, status, note) VALUES ($1, $2, $3)`,
		id, status, "Изменено администратором: текст — "+strings.Join(names, ", ")); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE orders SET rendered_at = NULL, render_attempts = 0, render_error = NULL,
		                  render_reason = 'admin_change', render_requested_at = now()
		WHERE id = $1`, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.wakeRender()
	return nums, nil
}

// PageName — «обложка», «стр. 3», «задняя обложка» по номеру среди всех n страниц.
func PageName(i, n int) string {
	switch i {
	case 0:
		return "обложка"
	case n - 1:
		return "задняя обложка"
	}
	return fmt.Sprintf("стр. %d", i)
}

// PageTexts — тексты одной страницы книги (правка текстов в админке).
type PageTexts struct {
	Name  string // «обложка», «стр. 3»
	Items []TextEdit
}

// BookTexts — все текстовые блоки книги заявки по страницам.
func (s *Service) BookTexts(ctx context.Context, bookToken string) ([]PageTexts, error) {
	var cover, back pages.Page
	var block []pages.Page
	if err := s.db.QueryRow(ctx, `SELECT cover, pages, back_cover FROM books WHERE token = $1`, bookToken).
		Scan(&cover, &block, &back); err != nil {
		return nil, fmt.Errorf("load book: %w", err)
	}
	all := append(append([]pages.Page{cover}, block...), back)
	var out []PageTexts
	for i, p := range all {
		pt := PageTexts{Name: PageName(i, len(all))}
		for _, el := range p.Elements {
			if el.Type == pages.Text {
				text := ""
				if el.Text != nil {
					text = *el.Text
				}
				pt.Items = append(pt.Items, TextEdit{PageID: p.ID, ElementID: el.ID, Text: text})
			}
		}
		if len(pt.Items) > 0 {
			out = append(out, pt)
		}
	}
	return out, nil
}
