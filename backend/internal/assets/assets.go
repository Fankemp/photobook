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
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // регистрирует декодеры для image.DecodeConfig
	_ "image/png"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"photobook/internal/storage"
)

const (
	MaxDimensionPx = 20000 // пикселей по стороне
	uploadURLTTL   = 15 * time.Minute
)

// Limits — ограничения загрузки из общего с фронтендом конфига
// (frontend/src/editor/uploads.json): фронтенд проверяет файлы до загрузки
// и показывает понятное сообщение, сервер — то же самое ещё раз.
type Limits struct {
	MaxFileMB  int               `json:"maxFileMb"`  // размер одного файла
	MaxPerBook int               `json:"maxPerBook"` // фото в одной книге (защита от бесконечных загрузок)
	Types      map[string]string `json:"types"`      // тип файла → расширение в хранилище
}

func (l Limits) MaxBytes() int64 { return int64(l.MaxFileMB) << 20 }

var extRe = regexp.MustCompile(`^[a-z0-9]{2,5}$`)

// LoadLimits читает и проверяет конфиг загрузки.
func LoadLimits(path string) (Limits, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Limits{}, fmt.Errorf("read uploads config: %w", err)
	}
	var l Limits
	if err := json.Unmarshal(data, &l); err != nil {
		return Limits{}, fmt.Errorf("parse uploads config %s: %w", path, err)
	}
	if l.MaxFileMB < 1 || l.MaxFileMB > 200 || l.MaxPerBook < 1 || len(l.Types) == 0 {
		return Limits{}, fmt.Errorf("uploads config %s: need maxFileMb 1–200, maxPerBook ≥ 1 and types", path)
	}
	for typ, ext := range l.Types {
		if !extRe.MatchString(ext) {
			return Limits{}, fmt.Errorf("uploads config: bad extension %q for %s", ext, typ)
		}
	}
	return l, nil
}

// browserTypes — форматы, которые умеет показать любой браузер (и Chromium
// в печатном PDF). HEIC/HEIF (фото с iPhone) — не любой: такое фото печатается
// с JPEG-копии, а на экране видна миниатюра (их делает libvips с поддержкой HEIF).
var browserTypes = map[string]bool{"image/jpeg": true, "image/png": true}

var (
	ErrNotFound        = errors.New("asset not found")
	ErrUnsupportedType = errors.New("unsupported file type")
	ErrTooLarge        = errors.New("file too large")
	ErrTooMany         = errors.New("too many files in book")
	ErrNotUploaded     = errors.New("file was not uploaded")
	ErrBadImage        = errors.New("file is not a valid image")
	ErrDuplicate       = errors.New("same file is already in the book")
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
	SHA256      string     // хеш файла; пусто — браузер не прислал
	TakenAt     *time.Time // дата съёмки из EXIF (местное время камеры)
	Removed     bool       // удалено из лотка «Мои фото» (файл остаётся)
	CreatedAt   time.Time  // порядок загрузки
}

// Ready — миниатюра готова (до неё на экране показывается оригинал, а HEIC — никак).
func (a Asset) Ready() bool { return a.ThumbKey != "" }

type Service struct {
	db      *pgxpool.Pool
	storage *storage.Storage
	limits  Limits
	// Сигнал обработчику миниатюр «в очереди новое фото» (см. RunThumbnails).
	// Буфер 1: несколько сигналов подряд схлопываются в один — обработчик всё равно
	// заберёт из базы всё, что накопилось.
	thumbsQueued chan struct{}
}

func NewService(db *pgxpool.Pool, st *storage.Storage, limits Limits) *Service {
	return &Service{db: db, storage: st, limits: limits, thumbsQueued: make(chan struct{}, 1)}
}

func (s *Service) Limits() Limits { return s.limits }

// Upload — что браузер сообщает о файле до загрузки.
type Upload struct {
	ContentType string
	Size        int64
	SHA256      string     // необязательно: хеш файла (64 hex)
	TakenAt     *time.Time // необязательно: дата съёмки из EXIF
}

var sha256Re = regexp.MustCompile(`^[0-9a-f]{64}$`)

// StartUpload создаёт запись pending и ссылку, по которой браузер загрузит файл.
// Если такой же файл (по хешу) уже есть в лотке книги, возвращает его
// и ErrDuplicate: второй раз не загружаем.
func (s *Service) StartUpload(ctx context.Context, bookID string, up Upload) (Asset, string, error) {
	ext, ok := s.limits.Types[up.ContentType]
	if !ok {
		return Asset{}, "", ErrUnsupportedType
	}
	if up.Size <= 0 || up.Size > s.limits.MaxBytes() {
		return Asset{}, "", ErrTooLarge
	}
	if up.SHA256 != "" && !sha256Re.MatchString(up.SHA256) {
		up.SHA256 = "" // необязательное поле: кривое просто не сохраняем
	}

	if up.SHA256 != "" {
		var id string
		err := s.db.QueryRow(ctx, `
			SELECT id FROM assets
			WHERE book_id = $1 AND sha256 = $2 AND status = 'uploaded' AND removed_at IS NULL
			LIMIT 1`, bookID, up.SHA256).Scan(&id)
		if err == nil {
			return Asset{ID: id, BookID: bookID}, "", ErrDuplicate
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return Asset{}, "", fmt.Errorf("find duplicate: %w", err)
		}
	}

	var count int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM assets WHERE book_id = $1`, bookID).Scan(&count); err != nil {
		return Asset{}, "", fmt.Errorf("count assets: %w", err)
	}
	if count >= s.limits.MaxPerBook {
		return Asset{}, "", ErrTooMany
	}

	a := Asset{ID: uuid.NewString(), BookID: bookID, Status: "pending", ContentType: up.ContentType, SHA256: up.SHA256, TakenAt: up.TakenAt}
	a.OriginalKey = fmt.Sprintf("books/%s/originals/%s.%s", bookID, a.ID, ext)
	_, err := s.db.Exec(ctx, `
		INSERT INTO assets (id, book_id, original_key, content_type, sha256, taken_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		a.ID, a.BookID, a.OriginalKey, a.ContentType, nullIfEmpty(a.SHA256), a.TakenAt)
	if err != nil {
		return Asset{}, "", fmt.Errorf("insert asset: %w", err)
	}

	url, err := s.storage.PresignPut(ctx, a.OriginalKey, up.Size, uploadURLTTL)
	if err != nil {
		return Asset{}, "", err
	}
	return a, url, nil
}

// CompleteUpload проверяет загруженный файл и помечает его готовым.
// width/height присылает браузер: он знает размеры с учётом поворота фото
// (EXIF). Сервер сверяет их с заголовком файла — совпасть должны с точностью
// до поворота на 90°. HEIC не всякий браузер умеет открыть: тогда он присылает
// 0×0, и размеры берутся из файла (libvips). Окончательные размеры уточнит
// обработчик миниатюр.
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
	if info.Size > s.limits.MaxBytes() {
		s.discard(ctx, a)
		return Asset{}, ErrTooLarge
	}

	var rawW, rawH int
	if browserTypes[a.ContentType] {
		rawW, rawH, err = s.imageSize(ctx, a.OriginalKey)
	} else {
		rawW, rawH, err = s.heifSize(ctx, a.OriginalKey)
		if err == nil && width == 0 && height == 0 {
			width, height = rawW, rawH // libvips уже применил поворот из файла
		}
	}
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

// heifSize — размеры HEIC/HEIF по самому файлу. Go их не читает, поэтому
// файл скачивается целиком (несколько мегабайт) и читается утилитой libvips.
func (s *Service) heifSize(ctx context.Context, key string) (int, int, error) {
	dir, err := os.MkdirTemp("", "heif-")
	if err != nil {
		return 0, 0, err
	}
	defer os.RemoveAll(dir)
	src := filepath.Join(dir, "original")
	if err := s.storage.Download(ctx, key, src); err != nil {
		return 0, 0, err
	}
	h, err := VipsThumbnailer{}.Header(ctx, src)
	if err != nil {
		return 0, 0, err
	}
	return h.Width, h.Height, nil
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
	var thumb, sha *string
	var size *int64
	var w, h *int
	var removed *time.Time
	err := s.db.QueryRow(ctx, `
		SELECT id, book_id, status, original_key, thumb_key, content_type, size_bytes, width_px, height_px,
			sha256, taken_at, removed_at, created_at
		FROM assets WHERE id = $1 AND book_id = $2`, assetID, bookID,
	).Scan(&a.ID, &a.BookID, &a.Status, &a.OriginalKey, &thumb, &a.ContentType, &size, &w, &h,
		&sha, &a.TakenAt, &removed, &a.CreatedAt)
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
	if sha != nil {
		a.SHA256 = *sha
	}
	a.Removed = removed != nil
	return a, nil
}

// List — загруженные фото книги в порядке загрузки, вместе с удалёнными
// из лотка (Removed): на них ещё могут ссылаться страницы (например, после
// «Отменить»), и такие фото печатаются как обычно.
func (s *Service) List(ctx context.Context, bookID string) ([]Asset, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, original_key, coalesce(thumb_key, ''), coalesce(print_key, ''), content_type, size_bytes,
			width_px, height_px, coalesce(sha256, ''), taken_at, removed_at IS NOT NULL, created_at
		FROM assets WHERE book_id = $1 AND status = 'uploaded'
		ORDER BY created_at, id`, bookID)
	if err != nil {
		return nil, fmt.Errorf("list assets: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Asset, error) {
		a := Asset{BookID: bookID, Status: "uploaded"}
		err := r.Scan(&a.ID, &a.OriginalKey, &a.ThumbKey, &a.PrintKey, &a.ContentType, &a.SizeBytes,
			&a.WidthPx, &a.HeightPx, &a.SHA256, &a.TakenAt, &a.Removed, &a.CreatedAt)
		return a, err
	})
}

// ListUploaded — то же, что List, ключ — id.
func (s *Service) ListUploaded(ctx context.Context, bookID string) (map[string]Asset, error) {
	list, err := s.List(ctx, bookID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]Asset, len(list))
	for _, a := range list {
		out[a.ID] = a
	}
	return out, nil
}

// SetRemoved убирает фото из лотка (removed = true) или возвращает его
// («Отменить»). Файл не удаляется: удаление из лотка можно отменить.
func (s *Service) SetRemoved(ctx context.Context, bookID, assetID string, removed bool) error {
	if uuid.Validate(assetID) != nil {
		return ErrNotFound
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE assets SET removed_at = CASE WHEN $3 THEN coalesce(removed_at, now()) END
		WHERE id = $1 AND book_id = $2 AND status = 'uploaded'`, assetID, bookID, removed)
	if err != nil {
		return fmt.Errorf("set removed: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
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

// ErrNotReady — миниатюры ещё нет, а оригинал браузер не покажет (HEIC).
var ErrNotReady = errors.New("thumbnail is not ready")

// ImageURL — временная ссылка на картинку для показа в браузере: миниатюра,
// а пока она не готова (первые секунды после загрузки) — оригинал.
// final = false значит «это временная замена», и браузеру нельзя её запоминать.
func (s *Service) ImageURL(ctx context.Context, a Asset) (url string, final bool, err error) {
	if a.ThumbKey != "" {
		url, err = s.storage.PresignGet(ctx, a.ThumbKey, time.Hour)
		return url, true, err
	}
	if !browserTypes[a.ContentType] {
		return "", false, ErrNotReady
	}
	url, err = s.storage.PresignGet(ctx, a.OriginalKey, time.Hour)
	return url, false, err
}
