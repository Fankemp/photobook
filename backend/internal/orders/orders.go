// Package orders — заявки клиентов: проверка формы, создание, статус,
// уведомление команды в Telegram.
package orders

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Статусы заказа: new → awaiting_prepayment → paid → printing → delivery → done (+ cancelled).
const (
	StatusNew      = "new"
	StatusPrinting = "printing"
)

// Editable — окно правок: пока заказ в этих статусах, клиент может менять книгу
// по своей ссылке (мы пересоберём PDF). С printing и дальше книга закрыта.
var Editable = []string{"new", "awaiting_prepayment", "paid"}

// Locked — книга уже в печати или отдана: менять её нельзя.
var Locked = []string{"printing", "delivery", "done"}

// Almaty — время для «сегодня» и желаемой даты. В Казахстане с 2024 года
// один часовой пояс, UTC+5, поэтому без базы часовых поясов.
var Almaty = time.FixedZone("Asia/Almaty", 5*60*60)

type Order struct {
	ID          string    `json:"-"`
	Number      int64     `json:"number"` // «заявка №1001»
	BookID      string    `json:"-"`
	BookVersion int       `json:"-"`
	Name        string    `json:"name"`
	Phone       string    `json:"phone"`
	Address     string    `json:"address"`
	WantedDate  string    `json:"wantedDate"` // YYYY-MM-DD
	Comment     string    `json:"comment"`
	Status      string    `json:"status"`
	PriceKZT    int       `json:"priceKzt"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Input — данные формы заявки. Version — версия книги, которую клиент видел:
// заказываем ровно её (если книгу успели изменить — конфликт). Confirmed —
// галочка «Я проверил(а) тексты и фото. После печати исправить ничего нельзя»:
// без неё заявка не создаётся.
type Input struct {
	Name       string `json:"name"`
	Phone      string `json:"phone"`
	Address    string `json:"address"`
	WantedDate string `json:"wantedDate"`
	Comment    string `json:"comment"`
	Version    int    `json:"version"`
	Confirmed  bool   `json:"confirmed"`
}

// ValidationError — какое поле заполнено неверно. Code уходит клиенту
// ("invalid_phone"), текст для человека — в словаре фронтенда.
type ValidationError struct{ Code string }

func (e ValidationError) Error() string { return e.Code }

var (
	ErrAlreadyOrdered  = errors.New("book already has an active order")
	ErrVersionConflict = errors.New("book was changed after the client saw it")
	ErrPDFNotCurrent   = errors.New("print PDF is not built for the current book version")
	ErrNotEditable     = errors.New("order is already in print, the book cannot be changed")
)

type Service struct {
	db          *pgxpool.Pool
	minLeadDays int // за сколько дней минимум можно заказать (время на печать)
	// Сигнал обработчику уведомлений «есть новая заявка» (как у миниатюр).
	queued chan struct{}
	// Разбудить сборку PDF (новая заявка, правка книги). Задаётся в main.
	WakeRender func()
	// Версия шаблона по id (хеш файла) — для снимка заказа. Задаётся в main.
	TemplateVersion func(id string) string
}

func NewService(db *pgxpool.Pool, minLeadDays int) *Service {
	return &Service{db: db, minLeadDays: minLeadDays, queued: make(chan struct{}, 1)}
}

// MinWantedDate — самая ранняя дата, которую можно выбрать в форме.
func (s *Service) MinWantedDate(now time.Time) time.Time {
	y, m, d := now.In(Almaty).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, Almaty).AddDate(0, 0, s.minLeadDays)
}

// Validate проверяет форму и приводит значения к виду для хранения.
func (s *Service) Validate(in Input, now time.Time) (Input, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.Address = strings.TrimSpace(in.Address)
	in.Comment = strings.TrimSpace(in.Comment)

	if n := utf8.RuneCountInString(in.Name); n < 1 || n > 100 {
		return in, ValidationError{"invalid_name"}
	}
	phone, ok := NormalizePhone(in.Phone)
	if !ok {
		return in, ValidationError{"invalid_phone"}
	}
	in.Phone = phone
	if n := utf8.RuneCountInString(in.Address); n < 5 || n > 300 {
		return in, ValidationError{"invalid_address"}
	}
	date, err := time.ParseInLocation("2006-01-02", in.WantedDate, Almaty)
	if err != nil || date.Before(s.MinWantedDate(now)) || date.After(now.AddDate(1, 0, 0)) {
		return in, ValidationError{"invalid_date"}
	}
	if utf8.RuneCountInString(in.Comment) > 1000 {
		return in, ValidationError{"invalid_comment"}
	}
	if !in.Confirmed {
		return in, ValidationError{"not_confirmed"}
	}
	return in, nil
}

// NormalizePhone приводит номер к виду +7XXXXXXXXXX. Принимает «+7 700 123-45-67»,
// «8 (700) 123 45 67», «77001234567». Номера Казахстана (и России) начинаются с +7.
func NormalizePhone(s string) (string, bool) {
	var digits strings.Builder
	for _, r := range s {
		switch {
		case unicode.IsDigit(r):
			digits.WriteRune(r)
		case r == '+' || r == ' ' || r == '-' || r == '(' || r == ')':
		default:
			return "", false
		}
	}
	d := digits.String()
	if len(d) == 11 && d[0] == '8' {
		d = "7" + d[1:]
	}
	if len(d) != 11 || d[0] != '7' {
		return "", false
	}
	return "+" + d, true
}

// FormatPhone — «+7 700 123 45 67» для людей.
func FormatPhone(p string) string {
	if len(p) != 12 {
		return p
	}
	return fmt.Sprintf("%s %s %s %s %s", p[:2], p[2:5], p[5:8], p[8:10], p[10:])
}

// Create оформляет заявку: проверяет, что версия книги та, что видел клиент,
// и что действующей заявки ещё нет, и сохраняет первый снимок заказа (версия 1)
// с подтверждением клиента. Книгу ещё можно менять, пока заказ не в печати.
func (s *Service) Create(ctx context.Context, bookID string, priceKZT int, in Input) (Order, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer tx.Rollback(ctx) // после Commit ничего не делает

	// FOR UPDATE: автосохранение этой книги подождёт, пока заявка не создастся.
	var version int
	if err := tx.QueryRow(ctx, `SELECT version FROM books WHERE id = $1 FOR UPDATE`, bookID).Scan(&version); err != nil {
		return Order{}, fmt.Errorf("lock book: %w", err)
	}
	if version != in.Version {
		return Order{}, ErrVersionConflict
	}

	o := Order{BookID: bookID, BookVersion: version, Name: in.Name, Phone: in.Phone, Address: in.Address,
		WantedDate: in.WantedDate, Comment: in.Comment, PriceKZT: priceKZT}
	if !in.Confirmed {
		return Order{}, ValidationError{"not_confirmed"} // Validate это уже проверил; на всякий случай
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO orders (book_id, book_version, name, phone, address, wanted_date, comment, price_kzt, confirmed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
		RETURNING id, number, status, created_at`,
		o.BookID, o.BookVersion, o.Name, o.Phone, o.Address, o.WantedDate, o.Comment, o.PriceKZT,
	).Scan(&o.ID, &o.Number, &o.Status, &o.CreatedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.ConstraintName == "orders_one_active_per_book" {
		return Order{}, ErrAlreadyOrdered
	}
	if err != nil {
		return Order{}, fmt.Errorf("insert order: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO order_events (order_id, status, note) VALUES ($1, $2, 'заявка с сайта')`,
		o.ID, o.Status); err != nil {
		return Order{}, fmt.Errorf("insert order event: %w", err)
	}
	if _, err := s.snapshot(ctx, tx, o.ID, "order"); err != nil {
		return Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Order{}, err
	}

	select {
	case s.queued <- struct{}{}:
	default: // сигнал уже ждёт обработчика
	}
	s.wakeRender()
	return o, nil
}

func (s *Service) wakeRender() {
	if s.WakeRender != nil {
		s.WakeRender()
	}
}

// ActiveForBook — действующая (не отменённая) заявка книги или nil.
func (s *Service) ActiveForBook(ctx context.Context, bookID string) (*Order, error) {
	var o Order
	var wanted time.Time
	err := s.db.QueryRow(ctx, `
		SELECT id, number, book_id, book_version, name, phone, address, wanted_date, comment, status, price_kzt, created_at
		FROM orders WHERE book_id = $1 AND status <> 'cancelled'`, bookID,
	).Scan(&o.ID, &o.Number, &o.BookID, &o.BookVersion, &o.Name, &o.Phone, &o.Address, &wanted, &o.Comment,
		&o.Status, &o.PriceKZT, &o.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get active order: %w", err)
	}
	o.WantedDate = wanted.Format("2006-01-02")
	return &o, nil
}
