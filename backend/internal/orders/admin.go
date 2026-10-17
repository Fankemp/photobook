package orders

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Statuses — все статусы по порядку работы с заказом.
var Statuses = []string{"new", "awaiting_prepayment", "paid", "printing", "delivery", "done", "cancelled"}

// NextStatus — обычный следующий шаг (кнопка в админке). У done и cancelled его нет.
var NextStatus = map[string]string{
	"new":                 "awaiting_prepayment",
	"awaiting_prepayment": "paid",
	"paid":                "printing",
	"printing":            "delivery",
	"delivery":            "done",
}

// Active — заказы «в работе»: всё, кроме выполненных и отменённых.
var Active = []string{"new", "awaiting_prepayment", "paid", "printing", "delivery"}

var (
	ErrNotFound  = errors.New("order not found")
	ErrBadStatus = errors.New("unknown order status")
	ErrBadNote   = errors.New("note is too long")
)

// Row — заявка в списке админки.
type Row struct {
	Order
	BookToken   string
	TemplateID  string
	CoverPDFKey string // печатные PDF (пусто — ещё не собраны)
	BlockPDFKey string
}

// PDFReady — оба печатных файла собраны.
func (r Row) PDFReady() bool { return r.CoverPDFKey != "" && r.BlockPDFKey != "" }

type Event struct {
	Status    string
	Note      string
	CreatedAt time.Time
}

// Detail — всё о заявке для её страницы в админке.
type Detail struct {
	Row
	Events         []Event
	NotifiedAt     *time.Time
	NotifyError    string
	RenderedAt     *time.Time
	RenderError    string
	RenderAttempts int
	PDFInfo        string
}

const rowColumns = `o.id, o.number, o.book_id, o.book_version, o.name, o.phone, o.address, o.wanted_date,
	o.comment, o.status, o.price_kzt, o.created_at, b.token, b.template_id,
	coalesce(o.cover_pdf_key, ''), coalesce(o.block_pdf_key, '')`

func scanRow(row pgx.Row, extra ...any) (Row, error) {
	var r Row
	var wanted time.Time
	dest := append([]any{&r.ID, &r.Number, &r.BookID, &r.BookVersion, &r.Name, &r.Phone, &r.Address, &wanted,
		&r.Comment, &r.Status, &r.PriceKZT, &r.CreatedAt, &r.BookToken, &r.TemplateID, &r.CoverPDFKey, &r.BlockPDFKey}, extra...)
	if err := row.Scan(dest...); err != nil {
		return Row{}, err
	}
	r.WantedDate = wanted.Format("2006-01-02")
	return r, nil
}

// List — заявки с указанными статусами (пусто — все), новые сверху.
func (s *Service) List(ctx context.Context, statuses []string, limit int) ([]Row, error) {
	rows, err := s.db.Query(ctx, `
		SELECT `+rowColumns+`
		FROM orders o JOIN books b ON b.id = o.book_id
		WHERE cardinality($1::text[]) = 0 OR o.status = ANY($1)
		ORDER BY o.created_at DESC
		LIMIT $2`, statuses, limit)
	if err != nil {
		return nil, fmt.Errorf("list orders: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Row, error) { return scanRow(r) })
}

// Counts — сколько заявок в каждом статусе (для фильтров в админке).
func (s *Service) Counts(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.Query(ctx, `SELECT status, count(*) FROM orders GROUP BY status`)
	if err != nil {
		return nil, fmt.Errorf("count orders: %w", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		out[st] = n
	}
	return out, rows.Err()
}

func (s *Service) GetByNumber(ctx context.Context, number int64) (Detail, error) {
	var d Detail
	var notifyErr, renderErr, pdfInfo *string
	row, err := scanRow(s.db.QueryRow(ctx, `
		SELECT `+rowColumns+`, o.notified_at, o.notify_error, o.rendered_at, o.render_error, o.render_attempts, o.pdf_info
		FROM orders o JOIN books b ON b.id = o.book_id
		WHERE o.number = $1`, number), &d.NotifiedAt, &notifyErr, &d.RenderedAt, &renderErr, &d.RenderAttempts, &pdfInfo)
	if errors.Is(err, pgx.ErrNoRows) {
		return Detail{}, ErrNotFound
	}
	if err != nil {
		return Detail{}, fmt.Errorf("get order %d: %w", number, err)
	}
	d.Row = row
	if notifyErr != nil {
		d.NotifyError = *notifyErr
	}
	if renderErr != nil {
		d.RenderError = *renderErr
	}
	if pdfInfo != nil {
		d.PDFInfo = *pdfInfo
	}

	rows, err := s.db.Query(ctx, `SELECT status, note, created_at FROM order_events WHERE order_id = $1 ORDER BY id`, d.ID)
	if err != nil {
		return Detail{}, fmt.Errorf("order events: %w", err)
	}
	d.Events, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Event])
	if err != nil {
		return Detail{}, fmt.Errorf("order events: %w", err)
	}
	return d, nil
}

// ChangeStatus меняет статус и пишет запись в историю. Отмена открывает книгу
// клиенту для изменений (книга закрыта, пока есть неотменённая заявка).
// Вернуть отменённую заявку нельзя, если по книге уже есть другая действующая.
func (s *Service) ChangeStatus(ctx context.Context, number int64, to, note string) error {
	if !slices.Contains(Statuses, to) {
		return ErrBadStatus
	}
	if utf8.RuneCountInString(note) > 500 {
		return ErrBadNote
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) // после Commit ничего не делает

	var id, from string
	err = tx.QueryRow(ctx, `SELECT id, status FROM orders WHERE number = $1 FOR UPDATE`, number).Scan(&id, &from)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if from == to {
		return nil
	}
	_, err = tx.Exec(ctx, `UPDATE orders SET status = $2, updated_at = now() WHERE id = $1`, id, to)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.ConstraintName == "orders_one_active_per_book" {
		return ErrAlreadyOrdered
	}
	if err != nil {
		return fmt.Errorf("update status: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO order_events (order_id, status, note) VALUES ($1, $2, $3)`, id, to, note); err != nil {
		return fmt.Errorf("insert order event: %w", err)
	}
	return tx.Commit(ctx)
}

// ResetRender — собрать PDF заново (например, после исправления шаблона или
// рендера): старые ключи сбрасываются, заявка снова попадает в очередь.
func (s *Service) ResetRender(ctx context.Context, number int64) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE orders SET cover_pdf_key = NULL, block_pdf_key = NULL, render_attempts = 0,
		                  render_error = NULL, rendered_at = NULL, pdf_info = NULL
		WHERE number = $1`, number)
	if err != nil {
		return fmt.Errorf("reset render: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// BookOf — книга заявки (для печатной страницы).
func (s *Service) BookOf(ctx context.Context, orderID string) (string, error) {
	var bookID string
	err := s.db.QueryRow(ctx, `SELECT book_id FROM orders WHERE id = $1`, orderID).Scan(&bookID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return bookID, err
}
