// Package assets — фото в книге.
//
// Загрузка в три шага, чтобы тяжёлые файлы с телефона шли напрямую
// в хранилище, а не через наш сервер:
//  1. клиент просит место под файл → запись pending + presigned PUT-ссылка;
//  2. браузер сам загружает файл по ссылке;
//  3. клиент подтверждает → сервер проверяет файл и помечает его uploaded.
package assets

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // регистрирует декодеры для image.DecodeConfig
	_ "image/png"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"photobook/internal/storage"
)

const (
	MaxSizeBytes   = 25 << 20 // 25 МБ: фото с телефона обычно 3–12 МБ
	MaxPerBook     = 300      // защита от бесконечных загрузок в одну книгу
	MaxDimensionPx = 20000    // пикселей по стороне
	uploadURLTTL   = 15 * time.Minute
)

// Поддерживаемые форматы. HEIC с iPhone браузер при выборе файла сам
// превращает в JPEG, поэтому отдельно его не поддерживаем.
var allowedTypes = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
}

var (
	ErrNotFound        = errors.New("asset not found")
	ErrUnsupportedType = errors.New("unsupported file type")
	ErrTooLarge        = errors.New("file too large")
	ErrTooMany         = errors.New("too many files in book")
	ErrNotUploaded     = errors.New("file was not uploaded")
	ErrBadImage        = errors.New("file is not a valid image")
)

type Asset struct {
	ID          string
	BookID      string
	Status      string
	OriginalKey string
	ThumbKey    string // пусто, пока миниатюра не готова
	PrintKey    string // повёрнутая копия для печати; пусто — печатается оригинал
	ContentType string
	SizeBytes   int64
	WidthPx     int
	HeightPx    int
}

type Service struct {
	db      *pgxpool.Pool
	storage *storage.Storage
	// Сигнал обработчику миниатюр «в очереди новое фото» (см. RunThumbnails).
	// Буфер 1: несколько сигналов подряд схлопываются в один — обработчик всё равно
	// заберёт из базы всё, что накопилось.
	thumbsQueued chan struct{}
}

func NewService(db *pgxpool.Pool, st *storage.Storage) *Service {
	return &Service{db: db, storage: st, thumbsQueued: make(chan struct{}, 1)}
}

// StartUpload создаёт запись pending и ссылку, по которой браузер загрузит файл.
func (s *Service) StartUpload(ctx context.Context, bookID, contentType string, size int64) (Asset, string, error) {
	ext, ok := allowedTypes[contentType]
	if !ok {
		return Asset{}, "", ErrUnsupportedType
	}
	if size <= 0 || size > MaxSizeBytes {
		return Asset{}, "", ErrTooLarge
	}

	var count int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM assets WHERE book_id = $1`, bookID).Scan(&count); err != nil {
		return Asset{}, "", fmt.Errorf("count assets: %w", err)
	}
	if count >= MaxPerBook {
		return Asset{}, "", ErrTooMany
	}

	a := Asset{ID: uuid.NewString(), BookID: bookID, Status: "pending", ContentType: contentType}
	a.OriginalKey = fmt.Sprintf("books/%s/originals/%s.%s", bookID, a.ID, ext)
	_, err := s.db.Exec(ctx, `
		INSERT INTO assets (id, book_id, original_key, content_type) VALUES ($1, $2, $3, $4)`,
		a.ID, a.BookID, a.OriginalKey, a.ContentType)
	if err != nil {
		return Asset{}, "", fmt.Errorf("insert asset: %w", err)
	}

	url, err := s.storage.PresignPut(ctx, a.OriginalKey, uploadURLTTL)
	if err != nil {
		return Asset{}, "", err
	}
	return a, url, nil
}

// CompleteUpload проверяет загруженный файл и помечает его готовым.
// width/height присылает браузер: он знает размеры с учётом поворота фото
// (EXIF). Сервер сверяет их с заголовком файла — совпасть должны с точностью
// до поворота на 90°. (На шаге 4 размеры будет считать libvips.)
func (s *Service) CompleteUpload(ctx context.Context, bookID, assetID string, width, height int) (Asset, error) {
	a, err := s.Get(ctx, bookID, assetID)
	if err != nil {
		return Asset{}, err
	}
	if a.Status == "uploaded" {
		return a, nil // повторное подтверждение (например, ретрай после обрыва сети)
	}

	info, err := s.storage.Stat(ctx, a.OriginalKey)
	if errors.Is(err, storage.ErrNotFound) {
		return Asset{}, ErrNotUploaded
	}
	if err != nil {
		return Asset{}, err
	}
	if info.Size > MaxSizeBytes {
		s.discard(ctx, a)
		return Asset{}, ErrTooLarge
	}

	rawW, rawH, err := s.imageSize(ctx, a.OriginalKey)
	if err != nil {
		s.discard(ctx, a)
		return Asset{}, ErrBadImage
	}
	sameOrRotated := (width == rawW && height == rawH) || (width == rawH && height == rawW)
	if !sameOrRotated || width > MaxDimensionPx || height > MaxDimensionPx {
		s.discard(ctx, a)
		return Asset{}, ErrBadImage
	}

	_, err = s.db.Exec(ctx, `
		UPDATE assets SET status = 'uploaded', size_bytes = $2, width_px = $3, height_px = $4, uploaded_at = now()
		WHERE id = $1`, a.ID, info.Size, width, height)
	if err != nil {
		return Asset{}, fmt.Errorf("mark uploaded: %w", err)
	}
	a.Status, a.SizeBytes, a.WidthPx, a.HeightPx = "uploaded", info.Size, width, height

	select {
	case s.thumbsQueued <- struct{}{}:
	default: // сигнал уже ждёт обработчика
	}
	return a, nil
}

// imageSize читает из хранилища только заголовок файла (первые килобайты),
// а не всё фото целиком.
func (s *Service) imageSize(ctx context.Context, key string) (int, int, error) {
	r, err := s.storage.Open(ctx, key)
	if err != nil {
		return 0, 0, err
	}
	defer r.Close()
	cfg, _, err := image.DecodeConfig(bufio.NewReader(r))
	if err != nil {
		return 0, 0, err
	}
	return cfg.Width, cfg.Height, nil
}

// discard удаляет плохой файл и запись о нём. Ошибки игнорируем:
// клиенту важен отказ, а остатки подчистит будущая фоновая уборка.
func (s *Service) discard(ctx context.Context, a Asset) {
	_ = s.storage.Remove(ctx, a.OriginalKey)
	_, _ = s.db.Exec(ctx, `DELETE FROM assets WHERE id = $1`, a.ID)
}

// Get возвращает фото, только если оно принадлежит этой книге.
func (s *Service) Get(ctx context.Context, bookID, assetID string) (Asset, error) {
	if uuid.Validate(assetID) != nil {
		return Asset{}, ErrNotFound
	}
	var a Asset
	var thumb *string
	var size *int64
	var w, h *int
	err := s.db.QueryRow(ctx, `
		SELECT id, book_id, status, original_key, thumb_key, content_type, size_bytes, width_px, height_px
		FROM assets WHERE id = $1 AND book_id = $2`, assetID, bookID,
	).Scan(&a.ID, &a.BookID, &a.Status, &a.OriginalKey, &thumb, &a.ContentType, &size, &w, &h)
	if errors.Is(err, pgx.ErrNoRows) {
		return Asset{}, ErrNotFound
	}
	if err != nil {
		return Asset{}, fmt.Errorf("get asset: %w", err)
	}
	if thumb != nil {
		a.ThumbKey = *thumb
	}
	if size != nil {
		a.SizeBytes = *size
	}
	if w != nil && h != nil {
		a.WidthPx, a.HeightPx = *w, *h
	}
	return a, nil
}

// ListUploaded — готовые фото книги, ключ — id.
func (s *Service) ListUploaded(ctx context.Context, bookID string) (map[string]Asset, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, original_key, coalesce(print_key, ''), content_type, size_bytes, width_px, height_px
		FROM assets WHERE book_id = $1 AND status = 'uploaded'`, bookID)
	if err != nil {
		return nil, fmt.Errorf("list assets: %w", err)
	}
	defer rows.Close()

	out := map[string]Asset{}
	for rows.Next() {
		a := Asset{BookID: bookID, Status: "uploaded"}
		if err := rows.Scan(&a.ID, &a.OriginalKey, &a.PrintKey, &a.ContentType, &a.SizeBytes, &a.WidthPx, &a.HeightPx); err != nil {
			return nil, fmt.Errorf("scan asset: %w", err)
		}
		out[a.ID] = a
	}
	return out, rows.Err()
}

// OriginalURLForPrint — ссылка на фото для печати (внутренний адрес хранилища,
// снаружи недоступен): оригинал, а для фото «лёжа» — его повёрнутая копия.
// Клиент оригиналы не получает — только миниатюры.
func (s *Service) OriginalURLForPrint(ctx context.Context, a Asset) (string, error) {
	key := a.OriginalKey
	if a.PrintKey != "" {
		key = a.PrintKey
	}
	return s.storage.PresignGetInternal(ctx, key, time.Hour)
}

// ImageURL — временная ссылка на картинку для показа в браузере: миниатюра,
// а пока она не готова (первые секунды после загрузки) — оригинал.
// final = false значит «это временная замена», и браузеру нельзя её запоминать.
func (s *Service) ImageURL(ctx context.Context, a Asset) (url string, final bool, err error) {
	if a.ThumbKey != "" {
		url, err = s.storage.PresignGet(ctx, a.ThumbKey, time.Hour)
		return url, true, err
	}
	url, err = s.storage.PresignGet(ctx, a.OriginalKey, time.Hour)
	return url, false, err
}
