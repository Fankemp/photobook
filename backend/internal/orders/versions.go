package orders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"photobook/internal/formats"
	"photobook/internal/pages"
)

// Снимки заказа (таблица order_versions). Снимок — копия страниц книги,
// формата и версии шаблона на момент заявки и каждой пересборки PDF, с датой
// и подтверждением клиента. Печатается именно снимок, поэтому PDF версии
// всегда соответствует её содержимому. Снимки не меняются и не удаляются
// (это охраняет триггер в базе): каждая пересборка — новая версия.

// Version — снимок заказа (без страниц) для админки и сборки PDF.
type Version struct {
	ID              int64
	Number          int    // версия заказа: 1 — заявка, дальше по порядку
	Reason          string // order, client_change, admin_change, rerender
	BookVersion     int
	TemplateID      string
	TemplateVersion string
	SchemaVersion   int
	ConfirmedAt     *time.Time
	CreatedAt       time.Time
	Pages           int // страниц блока в снимке
	BookPDFKey      string
	CoverPDFKey     string
	BlockPDFKey     string
	PDFInfo         string
	RenderedAt      *time.Time
}

// Snapshot — содержимое снимка: по нему собирается PDF.
type Snapshot struct {
	Version
	OrderID   string
	BookID    string
	Format    formats.Format
	Cover     pages.Page
	Pages     []pages.Page
	BackCover pages.Page
}

// snapshot сохраняет новую версию заказа из текущей книги (в транзакции,
// где заявка уже заблокирована или только что создана).
func (s *Service) snapshot(ctx context.Context, tx pgx.Tx, orderID, reason string) (Version, error) {
	var templateID string
	if err := tx.QueryRow(ctx, `SELECT b.template_id FROM orders o JOIN books b ON b.id = o.book_id WHERE o.id = $1`,
		orderID).Scan(&templateID); err != nil {
		return Version{}, fmt.Errorf("snapshot: %w", err)
	}
	templateVersion := ""
	if s.TemplateVersion != nil {
		templateVersion = s.TemplateVersion(templateID)
	}
	v := Version{Reason: reason, TemplateID: templateID, TemplateVersion: templateVersion}
	err := tx.QueryRow(ctx, `
		INSERT INTO order_versions (order_id, version, reason, book_version, template_id, template_version,
		                            schema_version, format, cover, pages, back_cover, confirmed_at)
		SELECT o.id, coalesce((SELECT max(version) FROM order_versions WHERE order_id = o.id), 0) + 1, $2,
		       b.version, b.template_id, $3, b.schema_version, `+formats.JSONSQL+`,
		       b.cover, b.pages, b.back_cover, o.confirmed_at
		FROM orders o JOIN books b ON b.id = o.book_id JOIN formats f ON f.id = b.format_id
		WHERE o.id = $1
		RETURNING id, version, book_version, schema_version, confirmed_at, created_at, jsonb_array_length(pages)`,
		orderID, reason, templateVersion,
	).Scan(&v.ID, &v.Number, &v.BookVersion, &v.SchemaVersion, &v.ConfirmedAt, &v.CreatedAt, &v.Pages)
	if err != nil {
		return Version{}, fmt.Errorf("insert order version: %w", err)
	}
	return v, nil
}

const versionColumns = `id, version, reason, book_version, template_id, template_version, schema_version,
	confirmed_at, created_at, jsonb_array_length(pages), coalesce(book_pdf_key, ''), coalesce(cover_pdf_key, ''),
	coalesce(block_pdf_key, ''), coalesce(pdf_info, ''), rendered_at`

func scanVersion(row pgx.Row, extra ...any) (Version, error) {
	var v Version
	err := row.Scan(append([]any{&v.ID, &v.Number, &v.Reason, &v.BookVersion, &v.TemplateID, &v.TemplateVersion,
		&v.SchemaVersion, &v.ConfirmedAt, &v.CreatedAt, &v.Pages, &v.BookPDFKey, &v.CoverPDFKey, &v.BlockPDFKey,
		&v.PDFInfo, &v.RenderedAt}, extra...)...)
	return v, err
}

// Versions — снимки заказа, новые сверху (история версий в админке).
func (s *Service) Versions(ctx context.Context, orderID string) ([]Version, error) {
	rows, err := s.db.Query(ctx, `SELECT `+versionColumns+` FROM order_versions WHERE order_id = $1 ORDER BY version DESC`, orderID)
	if err != nil {
		return nil, fmt.Errorf("order versions: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Version, error) { return scanVersion(r) })
}

// VersionForRender — снимок, который нужно собрать в PDF: последний ещё не
// собранный, если он совпадает с текущей книгой (например, первая версия или
// повтор после сбоя сборки); иначе — новый снимок книги (новая версия).
func (s *Service) VersionForRender(ctx context.Context, orderID string) (Snapshot, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback(ctx) // после Commit ничего не делает

	// Блокируем заявку: снимок и правка книги не должны пересечься.
	var reason string
	var bookVersion int
	if err := tx.QueryRow(ctx, `
		SELECT o.render_reason, b.version FROM orders o JOIN books b ON b.id = o.book_id
		WHERE o.id = $1 FOR UPDATE OF o`, orderID).Scan(&reason, &bookVersion); err != nil {
		return Snapshot{}, fmt.Errorf("lock order: %w", err)
	}
	var id int64
	err = tx.QueryRow(ctx, `
		SELECT id FROM order_versions
		WHERE order_id = $1 AND rendered_at IS NULL AND book_version = $2 AND reason = $3
		  AND version = (SELECT max(version) FROM order_versions WHERE order_id = $1)`,
		orderID, bookVersion, reason).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		v, err := s.snapshot(ctx, tx, orderID, reason)
		if err != nil {
			return Snapshot{}, err
		}
		id = v.ID
	} else if err != nil {
		return Snapshot{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Snapshot{}, err
	}
	return s.snapshotByID(ctx, orderID, id)
}

// SnapshotOf — снимок заказа по номеру версии (для печатной страницы).
func (s *Service) SnapshotOf(ctx context.Context, orderID string, version int) (Snapshot, error) {
	var id int64
	err := s.db.QueryRow(ctx, `SELECT id FROM order_versions WHERE order_id = $1 AND version = $2`, orderID, version).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Snapshot{}, ErrNotFound
	}
	if err != nil {
		return Snapshot{}, err
	}
	return s.snapshotByID(ctx, orderID, id)
}

func (s *Service) snapshotByID(ctx context.Context, orderID string, id int64) (Snapshot, error) {
	sn := Snapshot{OrderID: orderID}
	var format []byte
	v, err := scanVersion(s.db.QueryRow(ctx, `
		SELECT `+versionColumns+`, (SELECT book_id FROM orders WHERE id = order_id), format, cover, pages, back_cover
		FROM order_versions WHERE id = $1`, id), &sn.BookID, &format, &sn.Cover, &sn.Pages, &sn.BackCover)
	if err != nil {
		return Snapshot{}, fmt.Errorf("order version %d: %w", id, err)
	}
	sn.Version = v
	if err := json.Unmarshal(format, &sn.Format); err != nil {
		return Snapshot{}, fmt.Errorf("order version %d: format: %w", id, err)
	}
	return sn, nil
}

// PDF — ключи собранных файлов: book (single) или cover и block (split).
type PDF struct {
	Book, Cover, Block string
	Info               string
}

// SaveRenderedPDF — PDF версии собран: записываем его у версии (один раз)
// и делаем текущим PDF заявки.
func (s *Service) SaveRenderedPDF(ctx context.Context, orderID string, v Version, pdf PDF) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) // после Commit ничего не делает

	if _, err := tx.Exec(ctx, `
		UPDATE order_versions SET book_pdf_key = $2, cover_pdf_key = $3, block_pdf_key = $4, pdf_info = $5, rendered_at = now()
		WHERE id = $1`, v.ID, nullIfEmpty(pdf.Book), nullIfEmpty(pdf.Cover), nullIfEmpty(pdf.Block), pdf.Info); err != nil {
		return fmt.Errorf("save version pdf: %w", err)
	}
	// Если после снимка снова попросили пересобрать (правка книги во время
	// сборки), заявка остаётся в очереди: rendered_at не ставим.
	if _, err := tx.Exec(ctx, `
		UPDATE orders SET book_pdf_key = $2, cover_pdf_key = $3, block_pdf_key = $4, pdf_info = $5,
		                  pdf_book_version = $6, render_error = NULL,
		                  rendered_at = CASE WHEN render_requested_at <= $7 THEN now() END
		WHERE id = $1`, orderID, nullIfEmpty(pdf.Book), nullIfEmpty(pdf.Cover), nullIfEmpty(pdf.Block), pdf.Info,
		v.BookVersion, v.CreatedAt); err != nil {
		return fmt.Errorf("save order pdf: %w", err)
	}
	return tx.Commit(ctx)
}

// VersionPDFKey — файл PDF версии заказа (book, cover, block) для скачивания в админке.
func (s *Service) VersionPDFKey(ctx context.Context, orderID string, version int, part string) (string, error) {
	var book, cover, block string
	err := s.db.QueryRow(ctx, `
		SELECT coalesce(book_pdf_key, ''), coalesce(cover_pdf_key, ''), coalesce(block_pdf_key, '')
		FROM order_versions WHERE order_id = $1 AND version = $2`, orderID, version).Scan(&book, &cover, &block)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return map[string]string{"book": book, "cover": cover, "block": block}[part], nil
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
