// Package books — книги клиентов. Доступ к книге по секретному токену из ссылки,
// без регистрации: кто знает ссылку, тот и владелец.
package books

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"photobook/internal/orders"
	"photobook/internal/pages"
	"photobook/internal/templates"
)

type Book struct {
	ID            string       `json:"-"` // внутренний, наружу отдаём только токен
	Token         string       `json:"token"`
	TemplateID    string       `json:"templateId"`
	FormatID      string       `json:"formatId"`
	SchemaVersion int          `json:"schemaVersion"`
	Version       int          `json:"version"`   // растёт на 1 при каждом сохранении
	Cover         pages.Page   `json:"cover"`     // передняя обложка
	Pages         []pages.Page `json:"pages"`     // страницы блока
	BackCover     pages.Page   `json:"backCover"` // задняя обложка
	CreatedAt     time.Time    `json:"createdAt"`
	UpdatedAt     time.Time    `json:"updatedAt"`
}

var (
	ErrNotFound = errors.New("book not found")
	// ErrConflict — книгу уже сохранили с другой вкладки/устройства,
	// версия клиента устарела.
	ErrConflict = errors.New("book was changed by someone else")
	// ErrLocked — заказ книги уже в печати (или дальше), менять её нельзя.
	ErrLocked = errors.New("book is locked by an order")
)

// Токен — 26 символов base32 (128 бит случайности, см. crypto/rand.Text).
// Только заглавные латинские буквы и цифры 2–7: нет путаницы 0/O и 1/l,
// ссылку можно продиктовать по телефону.
var tokenRe = regexp.MustCompile(`^[A-Z2-7]{26}$`)

func ValidToken(s string) bool {
	return tokenRe.MatchString(s)
}

// NewFromTemplate создаёт книгу с копией страниц шаблона. Дальше книга живёт
// независимо: изменение шаблона не меняет уже созданные книги.
func NewFromTemplate(t templates.Template) (Book, error) {
	cover, err := pages.Clone(t.Cover)
	if err != nil {
		return Book{}, fmt.Errorf("copy cover: %w", err)
	}
	pp, err := pages.Clone(t.Pages)
	if err != nil {
		return Book{}, fmt.Errorf("copy pages: %w", err)
	}
	back, err := pages.Clone(t.BackCover)
	if err != nil {
		return Book{}, fmt.Errorf("copy back cover: %w", err)
	}
	return Book{
		Token:         rand.Text(),
		TemplateID:    t.ID,
		FormatID:      t.FormatID,
		SchemaVersion: pages.SchemaVersion,
		Cover:         cover,
		Pages:         pp,
		BackCover:     back,
	}, nil
}

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

// Create сохраняет новую книгу и заполняет ID и даты из базы.
// cover и pages pgx сам кодирует в JSONB через encoding/json.
func (s *Store) Create(ctx context.Context, b Book) (Book, error) {
	err := s.db.QueryRow(ctx, `
		INSERT INTO books (token, format_id, template_id, schema_version, cover, pages, back_cover)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, version, created_at, updated_at`,
		b.Token, b.FormatID, b.TemplateID, b.SchemaVersion, b.Cover, b.Pages, b.BackCover,
	).Scan(&b.ID, &b.Version, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return Book{}, fmt.Errorf("insert book: %w", err)
	}
	return b, nil
}

// IsLocked — книга закрыта: её заказ уже в печати (printing, delivery, done).
// Пока заказ new, awaiting_prepayment или paid, книгу можно менять.
func (s *Store) IsLocked(ctx context.Context, bookID string) (bool, error) {
	var locked bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM orders WHERE book_id = $1 AND status = ANY($2))`,
		bookID, orders.Locked).Scan(&locked)
	return locked, err
}

func (s *Store) GetByToken(ctx context.Context, token string) (Book, error) {
	return s.get(ctx, "token", token)
}

func (s *Store) GetByID(ctx context.Context, id string) (Book, error) {
	return s.get(ctx, "id", id)
}

// get — по токену (клиент) или по id (печать). column — из кода, не от пользователя.
func (s *Store) get(ctx context.Context, column, value string) (Book, error) {
	var b Book
	err := s.db.QueryRow(ctx, `
		SELECT id, token, template_id, format_id, schema_version, version, cover, pages, back_cover, created_at, updated_at
		FROM books WHERE `+column+` = $1`, value,
	).Scan(&b.ID, &b.Token, &b.TemplateID, &b.FormatID, &b.SchemaVersion, &b.Version, &b.Cover, &b.Pages, &b.BackCover,
		&b.CreatedAt, &b.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("get book: %w", err)
	}
	return b, nil
}

// SavePages сохраняет страницы, если версия в базе всё ещё та, что видел клиент
// (оптимистичная блокировка) и заказ книги (если он есть) ещё не в печати.
//
// Сначала блокируется строка заказа (FOR UPDATE): «Отправить в печать» в админке
// блокирует её же, поэтому правка и печать не пересекутся — либо правка успела
// и PDF устарел (печать не пустят), либо книга уже закрыта и правка отклонена,
// ничего не записав. Правка после заявки отмечается в заказе (book_changed_at):
// по ней команда получит сообщение, а PDF пересоберётся (orders.RunChanges).
func (s *Store) SavePages(ctx context.Context, bookID string, version int, cover pages.Page, pp []pages.Page, back pages.Page) (int, time.Time, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, time.Time{}, err
	}
	defer tx.Rollback(ctx) // после Commit ничего не делает

	var orderID, status string
	err = tx.QueryRow(ctx, `SELECT id, status FROM orders WHERE book_id = $1 AND status <> 'cancelled' FOR UPDATE`,
		bookID).Scan(&orderID, &status)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, time.Time{}, fmt.Errorf("lock order: %w", err)
	}
	if slices.Contains(orders.Locked, status) {
		return 0, time.Time{}, ErrLocked
	}

	var newVersion int
	var updatedAt time.Time
	err = tx.QueryRow(ctx, `
		UPDATE books SET cover = $3, pages = $4, back_cover = $5, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING version, updated_at`,
		bookID, version, cover, pp, back,
	).Scan(&newVersion, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, time.Time{}, ErrConflict // книга точно есть (нашли по токену) — не совпала версия
	}
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("save book: %w", err)
	}
	if orderID != "" {
		if _, err := tx.Exec(ctx, `UPDATE orders SET book_changed_at = now() WHERE id = $1`, orderID); err != nil {
			return 0, time.Time{}, fmt.Errorf("mark order changed: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, time.Time{}, err
	}
	return newVersion, updatedAt, nil
}
