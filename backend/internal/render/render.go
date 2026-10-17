// Package render — сборка печатных PDF заявки: cover.pdf (обложка) и block.pdf
// (страницы). Сам PDF делает сервис рендера (render/, Chromium через Playwright):
// он открывает печатную страницу сайта — тот же компонент страницы, что видит
// клиент, только с оригиналами фото — и печатает её в PDF.
package render

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"photobook/internal/storage"
)

const (
	maxAttempts   = 3
	idlePoll      = time.Minute
	linkTTL       = 15 * time.Minute
	renderTimeout = 5 * time.Minute // 20 страниц с оригиналами фото — обычно секунды, берём с запасом
	sizeTolerMM   = 0.5             // допуск на размер страницы PDF (округление pt ↔ мм)
)

// Config — где сервис рендера и как собирать PDF. Всё из переменных окружения.
type Config struct {
	ServiceURL   string // сервис рендера, например http://render:3000
	PrintBaseURL string // адрес сайта, как его видит сервис рендера, например http://frontend:5173
	// CMYK: прогнать PDF через Ghostscript в CMYK. Пока типографии нужен RGB —
	// выключено; включается переменной PDF_CMYK=true без изменений кода.
	CMYK bool
}

// Sheet — размеры печатного листа в мм (берутся из таблицы formats).
type Sheet struct {
	WidthMM, HeightMM, BleedMM, WrapMM, SpineMM float64
}

// Page — лист блока: страница и вылет с каждой стороны.
func (s Sheet) Page() (w, h float64) {
	return s.WidthMM + 2*s.BleedMM, s.HeightMM + 2*s.BleedMM
}

// Cover — лист обложки: лицевая сторона, вылет и загиб на картон с каждой стороны.
// Корешок (SpineMM) пока не участвует: обложка — только лицевая сторона. Когда
// типография даст развёртку (задняя + корешок + лицевая), формула меняется здесь
// и во frontend (book/geometry.ts, sheetMarginMm).
func (s Sheet) Cover() (w, h float64) {
	m := s.BleedMM + s.WrapMM
	return s.WidthMM + 2*m, s.HeightMM + 2*m
}

type Worker struct {
	db      *pgxpool.Pool
	storage *storage.Storage
	signer  *Signer
	cfg     Config
	log     *slog.Logger
	client  *http.Client
	queued  chan struct{}
}

func NewWorker(db *pgxpool.Pool, st *storage.Storage, signer *Signer, cfg Config, log *slog.Logger) *Worker {
	return &Worker{db: db, storage: st, signer: signer, cfg: cfg, log: log,
		client: &http.Client{Timeout: renderTimeout}, queued: make(chan struct{}, 1)}
}

// Wake — «есть работа»: новая заявка или просьба пересобрать PDF из админки.
func (w *Worker) Wake() {
	select {
	case w.queued <- struct{}{}:
	default:
	}
}

// Run собирает PDF по очереди, по одной заявке за раз: Chromium прожорлив
// по памяти, а сервер один (правило 6 в CLAUDE.md).
func (w *Worker) Run(ctx context.Context) {
	for {
		did, err := w.renderNext(ctx)
		if err != nil {
			w.log.Error("render failed", "err", err)
		}
		if did && err == nil {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-w.queued:
		case <-time.After(idlePoll):
		}
	}
}

type job struct {
	orderID     string
	number      int64
	orderVer    int
	bookVer     int
	pages       int
	sheet       Sheet
	coverKey    string
	blockKey    string
	fontsUsed   []string
	colorspaces []string
	jpegImages  int // фото, вложенные как есть (без пересжатия)
	otherImages int // фото, разжатые Chromium (PNG или с пометкой поворота)
}

// serviceReady — сервис рендера отвечает. Если нет (ещё стартует или упал),
// заявку не берём: иначе впустую потратили бы её попытки.
func (w *Worker) serviceReady(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(w.cfg.ServiceURL, "/")+"/health", nil)
	if err != nil {
		return false
	}
	resp, err := w.client.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func (w *Worker) renderNext(ctx context.Context) (bool, error) {
	if !w.serviceReady(ctx) {
		return false, fmt.Errorf("сервис рендера не отвечает (%s), подождём", w.cfg.ServiceURL)
	}
	// Заявку не блокируем (без FOR UPDATE и без открытой транзакции на время
	// рендера): обработчик PDF один, делить работу не с кем, а долгая блокировка
	// строки мешала бы остальным — уведомлению в Telegram и смене статуса в админке.
	var j job
	err := w.db.QueryRow(ctx, `
		SELECT o.id, o.number, o.book_version, b.version, f.pages,
		       f.width_mm, f.height_mm, f.bleed_mm, f.wrap_mm, f.spine_mm
		FROM orders o JOIN books b ON b.id = o.book_id JOIN formats f ON f.id = b.format_id
		WHERE o.status <> 'cancelled' AND (o.cover_pdf_key IS NULL OR o.block_pdf_key IS NULL)
		  AND o.render_attempts < $1
		  -- Ждём, пока фото книги обработаны (миниатюра и, если нужно, повёрнутая
		  -- печатная копия), но не дольше 10 минут после загрузки.
		  AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.book_id = o.book_id AND a.status = 'uploaded'
		                  AND a.thumb_key IS NULL AND a.thumb_attempts < 3
		                  AND a.uploaded_at > now() - interval '10 minutes')
		ORDER BY o.render_attempts, o.created_at
		LIMIT 1`, maxAttempts,
	).Scan(&j.orderID, &j.number, &j.orderVer, &j.bookVer, &j.pages,
		&j.sheet.WidthMM, &j.sheet.HeightMM, &j.sheet.BleedMM, &j.sheet.WrapMM, &j.sheet.SpineMM)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	started := time.Now()
	renderErr := w.renderOrder(ctx, &j)
	if renderErr != nil && ctx.Err() != nil {
		return false, nil // сервер останавливается — попытку не тратим
	}
	if renderErr != nil {
		_, err = w.db.Exec(ctx, `UPDATE orders SET render_attempts = render_attempts + 1, render_error = $2 WHERE id = $1`,
			j.orderID, renderErr.Error())
		return false, errors.Join(fmt.Errorf("order %d: %w", j.number, renderErr), err)
	}

	coverW, coverH := j.sheet.Cover()
	pageW, pageH := j.sheet.Page()
	info := fmt.Sprintf("обложка: 1 стр., %s мм; блок: %d стр., %s мм; цвет фото: %s; фото: %d JPEG без пересжатия, %d разжато; шрифты встроены: %s",
		mm(coverW, coverH), j.pages, mm(pageW, pageH), colorList(j.colorspaces), j.jpegImages, j.otherImages, fontList(j.fontsUsed))
	_, err = w.db.Exec(ctx, `
		UPDATE orders SET cover_pdf_key = $2, block_pdf_key = $3, rendered_at = now(), render_error = NULL, pdf_info = $4
		WHERE id = $1`, j.orderID, j.coverKey, j.blockKey, info)
	if err != nil {
		return true, err
	}
	w.log.Info("pdf rendered", "number", j.number, "took", time.Since(started).Round(time.Millisecond))
	return true, nil
}

func (w *Worker) renderOrder(ctx context.Context, j *job) error {
	// Книга закрыта после заявки, так что версия совпадает; если нет — печатать
	// нельзя: клиент заказывал другое содержимое.
	if j.bookVer != j.orderVer {
		return fmt.Errorf("книга изменилась после заявки (версия %d, в заявке %d)", j.bookVer, j.orderVer)
	}
	coverW, coverH := j.sheet.Cover()
	pageW, pageH := j.sheet.Page()
	parts := []struct {
		name   string
		pages  int
		w, h   float64
		target *string
	}{
		{"cover", 1, coverW, coverH, &j.coverKey},
		{"block", j.pages, pageW, pageH, &j.blockKey},
	}
	for _, p := range parts {
		res, err := w.renderPart(ctx, j.orderID, p.name, p.pages, p.w, p.h)
		if err != nil {
			return fmt.Errorf("%s.pdf: %w", p.name, err)
		}
		// Проверяем результат, а не верим на слово: страниц и размер — как заказано.
		if res.pages != p.pages {
			return fmt.Errorf("%s.pdf: %d стр., ожидалось %d", p.name, res.pages, p.pages)
		}
		if math.Abs(res.widthMM-p.w) > sizeTolerMM || math.Abs(res.heightMM-p.h) > sizeTolerMM {
			return fmt.Errorf("%s.pdf: страница %s мм, ожидалось %s мм", p.name, mm(res.widthMM, res.heightMM), mm(p.w, p.h))
		}
		key := fmt.Sprintf("orders/%d/%s.pdf", j.number, p.name)
		if err := w.storage.Upload(ctx, key, res.path, "application/pdf"); err != nil {
			os.Remove(res.path)
			return err
		}
		os.Remove(res.path)
		*p.target = key
		j.fontsUsed = append(j.fontsUsed, res.fonts...)
		j.jpegImages += res.jpegImages
		j.otherImages += res.otherImages
		if !slices.Contains(j.colorspaces, res.color) {
			j.colorspaces = append(j.colorspaces, res.color)
		}
	}
	return nil
}

type partResult struct {
	path              string
	pages             int
	widthMM, heightMM float64
	fonts             []string
	color             string
	jpegImages        int
	otherImages       int
}

// renderPart просит сервис рендера напечатать одну часть книги в PDF.
func (w *Worker) renderPart(ctx context.Context, orderID, part string, pages int, widthMM, heightMM float64) (partResult, error) {
	exp, sig := w.signer.Link(orderID, linkTTL, time.Now())
	pageURL := fmt.Sprintf("%s/print/%s?part=%s&exp=%s&sig=%s", strings.TrimRight(w.cfg.PrintBaseURL, "/"), orderID, part, exp, sig)
	// pages: сколько страниц в части — сервис печатает их по одной (память Chromium).
	body, _ := json.Marshal(map[string]any{"url": pageURL, "widthMm": widthMM, "heightMm": heightMM, "pages": pages, "cmyk": w.cfg.CMYK})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(w.cfg.ServiceURL, "/")+"/render", bytes.NewReader(body))
	if err != nil {
		return partResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := w.client.Do(req)
	if err != nil {
		return partResult{}, fmt.Errorf("сервис рендера недоступен: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&e)
		return partResult{}, fmt.Errorf("сервис рендера: HTTP %d: %s", resp.StatusCode, e.Error)
	}

	f, err := os.CreateTemp("", "photobook-*.pdf")
	if err != nil {
		return partResult{}, err
	}
	defer f.Close()
	if _, err := io.Copy(f, resp.Body); err != nil {
		os.Remove(f.Name())
		return partResult{}, err
	}

	// Итог проверки PDF (pdfinfo/pdffonts в сервисе рендера) — в заголовках ответа.
	res := partResult{path: f.Name(), color: resp.Header.Get("X-Pdf-Color")}
	res.pages, _ = strconv.Atoi(resp.Header.Get("X-Pdf-Pages"))
	res.widthMM, _ = strconv.ParseFloat(resp.Header.Get("X-Pdf-Width-Mm"), 64)
	res.heightMM, _ = strconv.ParseFloat(resp.Header.Get("X-Pdf-Height-Mm"), 64)
	fmt.Sscanf(resp.Header.Get("X-Pdf-Images"), "jpeg=%d,other=%d", &res.jpegImages, &res.otherImages)
	if fonts := resp.Header.Get("X-Pdf-Fonts"); fonts != "" {
		res.fonts = strings.Split(fonts, ",")
	}
	return res, nil
}

func mm(w, h float64) string {
	return strconv.FormatFloat(w, 'f', -1, 64) + "×" + strconv.FormatFloat(h, 'f', -1, 64)
}

// colorList — цвет фото по данным pdfimages (rgb, cmyk, gray; none — фото нет).
func colorList(cs []string) string {
	var out []string
	for _, c := range cs {
		for _, part := range strings.Split(c, "+") {
			// icc — так Chromium вкладывает RGB-фото: с цветовым профилем sRGB.
			name := map[string]string{"icc": "RGB (sRGB)", "rgb": "RGB", "cmyk": "CMYK", "gray": "оттенки серого"}[part]
			if name != "" && !slices.Contains(out, name) {
				out = append(out, name)
			}
		}
	}
	if len(out) == 0 {
		return "фото нет"
	}
	return strings.Join(out, ", ")
}

// fontList — уникальные имена шрифтов без префикса подмножества («ABCDEF+Lora» → «Lora»).
func fontList(fonts []string) string {
	var out []string
	for _, f := range fonts {
		if i := strings.IndexByte(f, '+'); i >= 0 {
			f = f[i+1:]
		}
		if f != "" && !slices.Contains(out, f) {
			out = append(out, f)
		}
	}
	if len(out) == 0 {
		return "нет текста"
	}
	return strings.Join(out, ", ")
}
