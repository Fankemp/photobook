package orders

import (
	"context"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"photobook/internal/notify"
)

const (
	maxNotifyAttempts = 20
	notifyPoll        = 30 * time.Second
)

// NotifyConfig — что нужно для текста уведомления, кроме самой заявки.
type NotifyConfig struct {
	Sender       notify.Sender
	BaseURL      string                 // адрес сайта для ссылки на книгу
	TemplateName func(id string) string // название шаблона по id
	Log          *slog.Logger
}

// RunNotifications отправляет в Telegram сообщения о новых заявках и об
// изменениях книги после заявки. Очередь — сами заявки с пустым notified_at
// и таблица order_notices: если Telegram недоступен, сообщение не теряется,
// а уходит со следующей попытки.
func (s *Service) RunNotifications(ctx context.Context, cfg NotifyConfig) {
	for {
		did, err := s.notifyNext(ctx, cfg)
		if err != nil {
			cfg.Log.Error("order notification failed", "err", err)
		}
		didNotice, noticeErr := s.noticeNext(ctx, cfg)
		if noticeErr != nil {
			cfg.Log.Error("order change notification failed", "err", noticeErr)
		}
		if (did && err == nil) || (didNotice && noticeErr == nil) {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-s.queued:
		case <-time.After(notifyPoll):
		}
	}
}

func (s *Service) notifyNext(ctx context.Context, cfg NotifyConfig) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) // после Commit ничего не делает

	var m Message
	var id, templateID string
	var wanted time.Time
	err = tx.QueryRow(ctx, `
		SELECT o.id, o.number, o.name, o.phone, o.address, o.wanted_date, o.comment, o.price_kzt,
		       b.token, b.template_id, f.name, jsonb_array_length(b.pages)
		FROM orders o JOIN books b ON b.id = o.book_id JOIN formats f ON f.id = b.format_id
		WHERE o.notified_at IS NULL AND o.notify_attempts < $1
		ORDER BY o.notify_attempts, o.created_at
		LIMIT 1 FOR UPDATE OF o SKIP LOCKED`, maxNotifyAttempts,
	).Scan(&id, &m.Number, &m.Name, &m.Phone, &m.Address, &wanted, &m.Comment, &m.PriceKZT,
		&m.BookToken, &templateID, &m.FormatName, &m.Pages)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	m.WantedDate = wanted
	m.TemplateName = cfg.TemplateName(templateID)
	m.BaseURL = cfg.BaseURL

	sendErr := cfg.Sender.Send(ctx, NewOrderMessage(m))
	if sendErr != nil && ctx.Err() != nil {
		return false, nil // сервер останавливается — попытку не тратим
	}
	if sendErr != nil {
		_, err = tx.Exec(ctx, `UPDATE orders SET notify_attempts = notify_attempts + 1, notify_error = $2 WHERE id = $1`,
			id, sendErr.Error())
		if err == nil {
			err = tx.Commit(ctx)
		}
		// false: подождём, а не будем долбить Telegram той же заявкой подряд.
		return false, errors.Join(fmt.Errorf("order %d: %w", m.Number, sendErr), err)
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET notified_at = now(), notify_error = NULL WHERE id = $1`, id); err != nil {
		return true, err
	}
	return true, tx.Commit(ctx)
}

// noticeNext отправляет одно сообщение об изменении книги из очереди order_notices.
func (s *Service) noticeNext(ctx context.Context, cfg NotifyConfig) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) // после Commit ничего не делает

	var id int64
	var number int64
	var version int
	var status string
	err = tx.QueryRow(ctx, `
		SELECT n.id, o.number, n.book_version, o.status
		FROM order_notices n JOIN orders o ON o.id = n.order_id
		WHERE n.sent_at IS NULL AND n.attempts < $1
		ORDER BY n.attempts, n.created_at
		LIMIT 1 FOR UPDATE OF n SKIP LOCKED`, maxNotifyAttempts).Scan(&id, &number, &version, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	sendErr := cfg.Sender.Send(ctx, BookChangedMessage(number, version, cfg.BaseURL))
	if sendErr != nil && ctx.Err() != nil {
		return false, nil
	}
	if sendErr != nil {
		_, err = tx.Exec(ctx, `UPDATE order_notices SET attempts = attempts + 1, error = $2 WHERE id = $1`, id, sendErr.Error())
		if err == nil {
			err = tx.Commit(ctx)
		}
		return false, errors.Join(fmt.Errorf("order %d change: %w", number, sendErr), err)
	}
	if _, err := tx.Exec(ctx, `UPDATE order_notices SET sent_at = now(), error = NULL WHERE id = $1`, id); err != nil {
		return true, err
	}
	return true, tx.Commit(ctx)
}

// BookChangedMessage — «Клиент изменил книгу в заказе №N» со ссылкой в админку.
func BookChangedMessage(number int64, bookVersion int, baseURL string) string {
	url := fmt.Sprintf("%s/admin/orders/%d", strings.TrimRight(baseURL, "/"), number)
	return fmt.Sprintf("<b>Клиент изменил книгу в заказе №%d</b>\n\nВерсия книги %d. PDF пересобирается — "+
		"отправлять в печать после пересборки.\n\n<a href=\"%s\">Заявка в админке</a>", number, bookVersion, html.EscapeString(url))
}

// Message — данные для текста уведомления о новой заявке.
type Message struct {
	Number       int64
	Name         string
	Phone        string
	Address      string
	WantedDate   time.Time
	Comment      string
	PriceKZT     int
	TemplateName string
	FormatName   string
	Pages        int
	BookToken    string
	BaseURL      string
}

// NewOrderMessage — текст для Telegram (HTML). Всё, что ввёл клиент,
// экранируется: иначе «<» в имени сломал бы разметку сообщения.
func NewOrderMessage(m Message) string {
	var b strings.Builder
	fmt.Fprintf(&b, "<b>Новая заявка №%d</b>\n\n", m.Number)
	line := func(label, value string) {
		fmt.Fprintf(&b, "%s: %s\n", label, html.EscapeString(value))
	}
	line("Имя", m.Name)
	line("Телефон", FormatPhone(m.Phone))
	line("Адрес", m.Address)
	line("Желаемая дата", m.WantedDate.Format("02.01.2006"))
	if m.Comment != "" {
		line("Комментарий", m.Comment)
	}
	line("Книга", fmt.Sprintf("%s, %s, %d стр.", m.TemplateName, m.FormatName, m.Pages))
	if m.PriceKZT > 0 {
		line("Сумма", FormatTenge(m.PriceKZT))
	}
	url := strings.TrimRight(m.BaseURL, "/") + "/b/" + m.BookToken + "/preview"
	fmt.Fprintf(&b, "\n<a href=\"%s\">Превью книги</a>", html.EscapeString(url))
	return b.String()
}

// FormatTenge — «15 000 ₸» (тысячи через неразрывный пробел).
func FormatTenge(n int) string {
	s := fmt.Sprint(n)
	var parts []string
	for len(s) > 3 {
		parts = append([]string{s[len(s)-3:]}, parts...)
		s = s[:len(s)-3]
	}
	parts = append([]string{s}, parts...)
	return strings.Join(parts, " ") + " ₸"
}
