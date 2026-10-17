// Package books — книги клиентов. Доступ к книге по секретному токену из ссылки,
// без регистрации: кто знает ссылку, тот и владелец.
package books

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"photobook/internal/pages"
	"photobook/internal/templates"
)

type Book struct {
	ID            string       `json:"-"` // внутренний, наружу отдаём только токен
	Token         string       `json:"token"`
	TemplateID    string       `json:"templateId"`
	FormatID      string       `json:"formatId"`
	SchemaVersion int          `json:"schemaVersion"`
	Version       int          `json:"version"` // растёт на 1 при каждом сохранении
	Cover         pages.Page   `json:"cover"`
	Pages         []pages.Page `json:"pages"`
	CreatedAt     time.Time    `json:"createdAt"`
	UpdatedAt     time.Time    `json:"updatedAt"`
}

var (
	ErrNotFound = errors.New("book not found")
	// ErrConflict — книгу уже сохранили с другой вкладки/устройства,
	// версия клиента устарела.
	ErrConflict = errors.New("book was changed by someone else")
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
	return Book{
		Token:         rand.Text(),
		TemplateID:    t.ID,
		FormatID:      t.FormatID,
		SchemaVersion: pages.SchemaVersion,
		Cover:         cover,
		Pages:         pp,
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
		INSERT INTO books (token, format_id, template_id, schema_version, cover, pages)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, version, created_at, updated_at`,
		b.Token, b.FormatID, b.TemplateID, b.SchemaVersion, b.Cover, b.Pages,
	).Scan(&b.ID, &b.Version, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return Book{}, fmt.Errorf("insert book: %w", err)
	}
	return b, nil
}

func (s *Store) GetByToken(ctx context.Context, token string) (Book, error) {
	var b Book
	err := s.db.QueryRow(ctx, `
		SELECT id, token, template_id, format_id, schema_version, version, cover, pages, created_at, updated_at
		FROM books WHERE token = $1`, token,
	).Scan(&b.ID, &b.Token, &b.TemplateID, &b.FormatID, &b.SchemaVersion, &b.Version, &b.Cover, &b.Pages, &b.CreatedAt, &b.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("get book: %w", err)
	}
	return b, nil
}

// SavePages сохраняет страницы, если версия в базе всё ещё та, что видел клиент
// (оптимистичная блокировка). Возвращает новую версию и время сохранения.
func (s *Store) SavePages(ctx context.Context, bookID string, version int, cover pages.Page, pp []pages.Page) (int, time.Time, error) {
	var newVersion int
	var updatedAt time.Time
	err := s.db.QueryRow(ctx, `
		UPDATE books SET cover = $3, pages = $4, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING version, updated_at`,
		bookID, version, cover, pp,
	).Scan(&newVersion, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Книга точно существует (её нашли по токену до вызова), значит, не совпала версия.
		return 0, time.Time{}, ErrConflict
	}
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("save book: %w", err)
	}
	return newVersion, updatedAt, nil
}
