package assets

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Миниатюры: клиент в редакторе видит их, а не оригиналы (оригиналы — для печати).
const (
	ThumbSize        = 1600 // px по длинной стороне: хватает для телефона с увеличением кадра
	thumbQuality     = 80
	maxThumbAttempts = 3
	thumbTimeout     = 2 * time.Minute
	idlePoll         = time.Minute // на всякий случай проверяем очередь и без сигнала
)

// Thumbnailer делает миниатюру и печатную копию фото (libvips).
type Thumbnailer interface {
	// Thumbnail — миниатюра из файла src в JPEG-файл dst.
	Thumbnail(ctx context.Context, src, dst string) error
	// Header — размеры, поворот и дата съёмки из заголовка файла (любой формат,
	// который знает libvips, включая HEIC).
	Header(ctx context.Context, src string) (Header, error)
	// Upright — JPEG-копия фото для печати, повёрнутая по пометке EXIF.
	// quality — качество JPEG (1–100).
	Upright(ctx context.Context, src, dst string, quality int) error
}

// Header — данные из заголовка фото.
type Header struct {
	Width, Height int        // как записано в файле (JPEG — без поворота по EXIF)
	Orientation   int        // пометка EXIF о повороте: 1 — фото стоит как надо, иначе 2–8
	TakenAt       *time.Time // дата съёмки (EXIF DateTimeOriginal), если есть
}

// Качество печатных JPEG-копий. Q=95 — визуально без потерь (повёрнутые копии
// фото с телефона). HEIC в Chromium не открывается, поэтому печатается его
// копия — с максимальным качеством и без прореживания цвета; сам HEIC
// остаётся в хранилище без изменений.
const (
	uprightQuality = 95
	heifQuality    = 98
)

// VipsThumbnailer вызывает утилиту vipsthumbnail из libvips отдельным процессом:
// не нужен CGO, а если vips упадёт на странном файле, сервер это не уронит.
// libvips читает JPEG уже уменьшенным, поэтому даже фото 50 Мп не съедают память.
type VipsThumbnailer struct{}

func (VipsThumbnailer) Thumbnail(ctx context.Context, src, dst string) error {
	size := fmt.Sprintf("%dx%d>", ThumbSize, ThumbSize) // ">" — только уменьшать, не растягивать
	// keep=none — без метаданных: поворот из EXIF уже применён, пометка не нужна;
	// background=255 — прозрачное в PNG станет белым, а не чёрным.
	out := fmt.Sprintf("%s[Q=%d,keep=none,background=255]", dst, thumbQuality)
	cmd := exec.CommandContext(ctx, "vipsthumbnail", src, "--size", size, "-o", out)
	if msg, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("vipsthumbnail: %w: %s", err, bytes.TrimSpace(msg))
	}
	return nil
}

// Header читает все поля заголовка одной командой (vipsheader -a).
func (VipsThumbnailer) Header(ctx context.Context, src string) (Header, error) {
	out, err := exec.CommandContext(ctx, "vipsheader", "-a", src).CombinedOutput()
	if err != nil {
		return Header{}, fmt.Errorf("vipsheader: %w: %s", err, bytes.TrimSpace(out))
	}
	return parseHeader(string(out))
}

// parseHeader разбирает вывод vipsheader -a: строки «поле: значение».
// Дата съёмки выглядит так: «2023:07:15 14:22:01 (2023:07:15 14:22:01, ASCII, 20 components, 20 bytes)».
func parseHeader(out string) (Header, error) {
	h := Header{Orientation: 1}
	for line := range strings.Lines(out) {
		key, val, ok := strings.Cut(strings.TrimSpace(line), ": ")
		if !ok {
			continue
		}
		switch key {
		case "width":
			h.Width, _ = strconv.Atoi(val)
		case "height":
			h.Height, _ = strconv.Atoi(val)
		case "orientation":
			if n, err := strconv.Atoi(val); err == nil && n >= 1 && n <= 8 {
				h.Orientation = n
			}
		case "exif-ifd2-DateTimeOriginal":
			if len(val) >= 19 {
				if t, err := time.Parse("2006:01:02 15:04:05", val[:19]); err == nil {
					h.TakenAt = &t
				}
			}
		}
	}
	if h.Width <= 0 || h.Height <= 0 {
		return Header{}, errors.New("vipsheader: no image size")
	}
	return h, nil
}

func (VipsThumbnailer) Upright(ctx context.Context, src, dst string, quality int) error {
	// keep=icc — сохранить цветовой профиль фото; subsample_mode=off при высоком
	// качестве — цвет без прореживания (как в оригинале).
	opts := fmt.Sprintf("[Q=%d,keep=icc]", quality)
	if quality >= heifQuality {
		opts = fmt.Sprintf("[Q=%d,keep=icc,subsample_mode=off]", quality)
	}
	cmd := exec.CommandContext(ctx, "vips", "autorot", src, dst+opts)
	if msg, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("vips autorot: %w: %s", err, bytes.TrimSpace(msg))
	}
	return nil
}

// VipsAvailable — установлен ли libvips. В Docker-образе есть; при локальном
// go run может не быть, тогда миниатюры не делаются и показываются оригиналы.
func VipsAvailable() bool {
	_, err := exec.LookPath("vipsthumbnail")
	return err == nil
}

// RunThumbnails обрабатывает очередь миниатюр, пока не отменят ctx.
// Одно фото за раз: на одном VPS важнее предсказуемая память, чем скорость.
func (s *Service) RunThumbnails(ctx context.Context, th Thumbnailer, log *slog.Logger) {
	for {
		did, err := s.thumbnailNext(ctx, th)
		if err != nil {
			log.Error("thumbnail failed", "err", err)
		}
		if did && err == nil {
			continue // в очереди может быть ещё
		}
		select {
		case <-ctx.Done():
			return
		case <-s.thumbsQueued:
		case <-time.After(idlePoll):
		}
	}
}

// thumbnailNext берёт из очереди одно фото и делает миниатюру.
// FOR UPDATE SKIP LOCKED: если обработчиков станет несколько, они не возьмут одно фото дважды.
func (s *Service) thumbnailNext(ctx context.Context, th Thumbnailer) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) // после Commit ничего не делает

	var a Asset
	err = tx.QueryRow(ctx, `
		SELECT id, book_id, original_key, content_type FROM assets
		WHERE status = 'uploaded' AND thumb_key IS NULL AND thumb_attempts < $1
		ORDER BY thumb_attempts, uploaded_at
		LIMIT 1 FOR UPDATE SKIP LOCKED`, maxThumbAttempts,
	).Scan(&a.ID, &a.BookID, &a.OriginalKey, &a.ContentType)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	jobCtx, cancel := context.WithTimeout(ctx, thumbTimeout)
	defer cancel()
	res, thumbErr := s.makeThumb(jobCtx, th, a)
	if thumbErr != nil && ctx.Err() != nil {
		return false, nil // сервер останавливается — это не ошибка фото, попытку не тратим
	}
	if thumbErr != nil {
		_, err = tx.Exec(ctx, `UPDATE assets SET thumb_attempts = thumb_attempts + 1, thumb_error = $2 WHERE id = $1`,
			a.ID, thumbErr.Error())
		if err == nil {
			err = tx.Commit(ctx)
		}
		return true, errors.Join(fmt.Errorf("asset %s: %w", a.ID, thumbErr), err)
	}

	// Дату съёмки обычно присылает браузер; если не смог (HEIC) — берём из файла.
	_, err = tx.Exec(ctx, `
		UPDATE assets SET thumb_key = $2, print_key = $3, width_px = $4, height_px = $5, thumb_error = NULL,
			taken_at = coalesce(taken_at, $6)
		WHERE id = $1`, a.ID, res.thumbKey, nullIfEmpty(res.printKey), res.width, res.height, res.takenAt)
	if err != nil {
		return true, err
	}
	return true, tx.Commit(ctx)
}

type thumbResult struct {
	thumbKey      string
	printKey      string // пусто — для печати годится сам оригинал
	width, height int
	takenAt       *time.Time
}

// makeThumb скачивает оригинал, делает и загружает миниатюру, а для фото
// «лёжа» с пометкой EXIF и для HEIC — ещё и печатную JPEG-копию. Заодно
// уточняет размеры оригинала с учётом поворота: до этого их сообщал браузер.
func (s *Service) makeThumb(ctx context.Context, th Thumbnailer, a Asset) (thumbResult, error) {
	var res thumbResult
	dir, err := os.MkdirTemp("", "thumb-")
	if err != nil {
		return res, err
	}
	defer os.RemoveAll(dir)

	src := filepath.Join(dir, "original")
	dst := filepath.Join(dir, "thumb.jpg")
	if err := s.storage.Download(ctx, a.OriginalKey, src); err != nil {
		return res, err
	}
	head, err := th.Header(ctx, src)
	if err != nil {
		return res, fmt.Errorf("read original: %w", err)
	}
	rawW, rawH := head.Width, head.Height
	res.takenAt = head.TakenAt
	if err := th.Thumbnail(ctx, src, dst); err != nil {
		return res, err
	}
	thumbW, thumbH, err := fileImageSize(dst)
	if err != nil {
		return res, fmt.Errorf("read thumbnail: %w", err)
	}
	res.thumbKey = fmt.Sprintf("books/%s/thumbs/%s.jpg", a.BookID, a.ID)
	if err := s.storage.Upload(ctx, res.thumbKey, dst, "image/jpeg"); err != nil {
		return res, err
	}
	res.width, res.height = orientedSize(rawW, rawH, thumbW, thumbH)

	if quality := printCopyQuality(a.ContentType, head.Orientation); quality > 0 {
		upright := filepath.Join(dir, "print.jpg")
		if err := th.Upright(ctx, src, upright, quality); err != nil {
			return res, err
		}
		res.printKey = fmt.Sprintf("books/%s/print/%s.jpg", a.BookID, a.ID)
		if err := s.storage.Upload(ctx, res.printKey, upright, "image/jpeg"); err != nil {
			return res, err
		}
	}
	return res, nil
}

// printCopyQuality — нужна ли печатная JPEG-копия и с каким качеством (0 — не нужна).
func printCopyQuality(contentType string, orientation int) int {
	switch {
	case !browserTypes[contentType]:
		return heifQuality // HEIC: Chromium его не откроет
	case orientation > 1:
		return uprightQuality
	}
	return 0
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// orientedSize — размеры оригинала так, как фото видит человек.
// Миниатюра уже повёрнута по EXIF, а оригинал хранится, как его записала
// камера. Если у них разная ориентация (альбомная/книжная), фото повёрнуто на 90°.
func orientedSize(rawW, rawH, thumbW, thumbH int) (int, int) {
	if rawW != rawH && (thumbW > thumbH) != (rawW > rawH) {
		return rawH, rawW
	}
	return rawW, rawH
}

func fileImageSize(path string) (int, int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, err
	}
	return cfg.Width, cfg.Height, nil
}

// RunCleanup раз в час удаляет загрузки, которые начали, но не подтвердили
// (закрыли вкладку, оборвалась сеть): запись в базе и файл, если он успел дойти.
func (s *Service) RunCleanup(ctx context.Context, log *slog.Logger) {
	for {
		n, err := s.cleanupPending(ctx, 24*time.Hour)
		if err != nil {
			log.Error("cleanup pending uploads failed", "err", err)
		} else if n > 0 {
			log.Info("cleaned up pending uploads", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}

func (s *Service) cleanupPending(ctx context.Context, olderThan time.Duration) (int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, original_key FROM assets
		WHERE status = 'pending' AND created_at < now() - $1::interval`, olderThan)
	if err != nil {
		return 0, err
	}
	stale, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Asset, error) {
		var a Asset
		return a, r.Scan(&a.ID, &a.OriginalKey)
	})
	if err != nil {
		return 0, err
	}
	for _, a := range stale {
		// Удаление несуществующего файла в S3 — не ошибка.
		if err := s.storage.Remove(ctx, a.OriginalKey); err != nil {
			return 0, err
		}
		if _, err := s.db.Exec(ctx, `DELETE FROM assets WHERE id = $1 AND status = 'pending'`, a.ID); err != nil {
			return 0, err
		}
	}
	return len(stale), nil
}
