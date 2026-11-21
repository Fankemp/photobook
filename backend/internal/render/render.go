// Package render — сборка печатных PDF заявки: cover.pdf (обложка) и block.pdf
// (страницы). Сам PDF делает сервис рендера (render/, Chromium через Playwright):
// он открывает печатную страницу сайта — тот же компонент страницы, что видит
// клиент, только с оригиналами фото — и печатает её в PDF.
//
// Печатается снимок заказа (orders.Snapshot), а не живая книга: каждая сборка —
// своя версия заказа со своими файлами (orders/<номер>/v<версия>/…), прежние
// PDF не перезаписываются.
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

	"photobook/internal/formats"
	"photobook/internal/orders"
	"photobook/internal/storage"
)

const (
	maxAttempts   = 3
	idlePoll      = time.Minute
	linkTTL       = time.Hour        // ссылки нужны до последнего листа книги
	renderTimeout = 15 * time.Minute // книга печатается по листу; обычно минута, берём с запасом
	sizeTolerMM   = 0.5              // допуск на размер страницы PDF (округление pt ↔ мм)
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
	orders  *orders.Service
	storage *storage.Storage
	signer  *Signer
	cfg     Config
	log     *slog.Logger
	client  *http.Client
	queued  chan struct{}
}

func NewWorker(db *pgxpool.Pool, ord *orders.Service, st *storage.Storage, signer *Signer, cfg Config, log *slog.Logger) *Worker {
	return &Worker{db: db, orders: ord, storage: st, signer: signer, cfg: cfg, log: log,
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

// sheetSpec — лист печатного PDF: что на нём и какого он размера.
type sheetSpec struct {
	Kind string  // front (передняя обложка), back (задняя), page (страница блока)
	Page int     // номер страницы блока с 0 (для page)
	W, H float64 // размер листа в мм
}

// fileSpec — печатный файл: имя (book, cover, block → book.pdf, …) и листы по порядку.
type fileSpec struct {
	Name   string
	Sheets []sheetSpec
}

// Plan — какие файлы собрать и какие листы в каком порядке в них положить.
// Всё из настройки формата (pdf_mode, pdf_order), а не из кода:
//
//	single — один book.pdf: части в порядке order (по умолчанию front, pages, back);
//	split  — cover.pdf: обложки в порядке order; block.pdf: страницы.
func Plan(mode string, order []string, pageCount int, s Sheet) []fileSpec {
	coverW, coverH := s.Cover()
	pageW, pageH := s.Page()
	expand := func(part string) []sheetSpec {
		switch part {
		case formats.PartFront:
			return []sheetSpec{{Kind: "front", W: coverW, H: coverH}}
		case formats.PartBack:
			return []sheetSpec{{Kind: "back", W: coverW, H: coverH}}
		}
		out := make([]sheetSpec, pageCount)
		for i := range out {
			out[i] = sheetSpec{Kind: "page", Page: i, W: pageW, H: pageH}
		}
		return out
	}

	if mode == "split" {
		var cover, block []sheetSpec
		for _, part := range order {
			if part == formats.PartPages {
				block = append(block, expand(part)...)
			} else {
				cover = append(cover, expand(part)...)
			}
		}
		var files []fileSpec
		if len(cover) > 0 {
			files = append(files, fileSpec{Name: "cover", Sheets: cover})
		}
		return append(files, fileSpec{Name: "block", Sheets: block})
	}
	var all []sheetSpec
	for _, part := range order {
		all = append(all, expand(part)...)
	}
	return []fileSpec{{Name: "book", Sheets: all}}
}

type job struct {
	orderID     string
	number      int64
	version     orders.Version // какой снимок заказа собираем
	pages       int
	sheet       Sheet
	format      formats.Format // только pdf_mode и pdf_order — для плана файлов
	keys        map[string]string
	files       []string // описание файлов для админки
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
		SELECT o.id, o.number FROM orders o
		WHERE o.status <> 'cancelled' AND o.rendered_at IS NULL AND o.render_attempts < $1
		  -- Ждём, пока фото книги обработаны (миниатюра и, если нужно, повёрнутая
		  -- печатная копия), но не дольше 10 минут после загрузки.
		  AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.book_id = o.book_id AND a.status = 'uploaded'
		                  AND a.thumb_key IS NULL AND a.thumb_attempts < 3
		                  AND a.uploaded_at > now() - interval '10 minutes')
		ORDER BY o.render_attempts, o.created_at
		LIMIT 1`, maxAttempts,
	).Scan(&j.orderID, &j.number)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// Что печатать: снимок заказа (первая версия или новый снимок после правок).
	sn, err := w.orders.VersionForRender(ctx, j.orderID)
	if err != nil {
		return false, fmt.Errorf("order %d: snapshot: %w", j.number, err)
	}
	f := sn.Format
	j.version, j.pages, j.format = sn.Version, len(sn.Pages), f
	j.sheet = Sheet{WidthMM: f.WidthMM, HeightMM: f.HeightMM, BleedMM: f.BleedMM, WrapMM: f.WrapMM, SpineMM: f.SpineMM}

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

	info := fmt.Sprintf("%s; цвет фото: %s; фото: %d JPEG без пересжатия, %d разжато; шрифты встроены: %s",
		strings.Join(j.files, ". "), colorList(j.colorspaces), j.jpegImages, j.otherImages, fontList(j.fontsUsed))
	err = w.orders.SaveRenderedPDF(ctx, j.orderID, j.version, orders.PDF{
		Book: j.keys["book"], Cover: j.keys["cover"], Block: j.keys["block"], Info: info})
	if err != nil {
		return true, err
	}
	w.log.Info("pdf rendered", "number", j.number, "version", j.version.Number, "files", len(j.keys),
		"took", time.Since(started).Round(time.Millisecond))
	return true, nil
}

func (w *Worker) renderOrder(ctx context.Context, j *job) error {
	order, err := j.format.Order() // настройку могли поменять в базе после старта
	if err != nil {
		return err
	}
	j.keys = map[string]string{}
	for _, f := range Plan(j.format.PDFMode, order, j.pages, j.sheet) {
		res, err := w.renderFile(ctx, j.orderID, j.version.Number, f)
		if err != nil {
			return fmt.Errorf("%s.pdf: %w", f.Name, err)
		}
		// Проверяем результат, а не верим на слово: листов и размеры — как в плане.
		if err := checkSheets(f, res); err != nil {
			os.Remove(res.path)
			return err
		}
		key := fmt.Sprintf("orders/%d/v%d/%s.pdf", j.number, j.version.Number, f.Name)
		err = w.storage.Upload(ctx, key, res.path, "application/pdf")
		os.Remove(res.path)
		if err != nil {
			return err
		}
		j.keys[f.Name] = key
		j.files = append(j.files, fmt.Sprintf("%s.pdf — %d стр.: %s; %s мм", f.Name, len(f.Sheets), describe(f.Sheets), sizes(f.Sheets)))
		j.fontsUsed = append(j.fontsUsed, res.fonts...)
		j.jpegImages += res.jpegImages
		j.otherImages += res.otherImages
		if !slices.Contains(j.colorspaces, res.color) {
			j.colorspaces = append(j.colorspaces, res.color)
		}
	}
	return nil
}

func checkSheets(f fileSpec, res partResult) error {
	if res.pages != len(f.Sheets) || len(res.sizes) != len(f.Sheets) {
		return fmt.Errorf("%s.pdf: %d стр., ожидалось %d", f.Name, res.pages, len(f.Sheets))
	}
	for i, s := range f.Sheets {
		got := res.sizes[i]
		if math.Abs(got[0]-s.W) > sizeTolerMM || math.Abs(got[1]-s.H) > sizeTolerMM {
			return fmt.Errorf("%s.pdf, стр. %d: %s мм, ожидалось %s мм", f.Name, i+1, mm(got[0], got[1]), mm(s.W, s.H))
		}
	}
	return nil
}

// describe — порядок листов для людей: «передняя обложка, страницы 1–20, задняя обложка».
func describe(sheets []sheetSpec) string {
	var parts []string
	for i := 0; i < len(sheets); i++ {
		switch sheets[i].Kind {
		case "front":
			parts = append(parts, "передняя обложка")
		case "back":
			parts = append(parts, "задняя обложка")
		default:
			first := sheets[i].Page
			for i+1 < len(sheets) && sheets[i+1].Kind == "page" {
				i++
			}
			parts = append(parts, fmt.Sprintf("страницы %d–%d", first+1, sheets[i].Page+1))
		}
	}
	return strings.Join(parts, ", ")
}

// sizes — размеры листов без повторов: «206×206» или «236×236, 206×206».
func sizes(sheets []sheetSpec) string {
	var out []string
	for _, s := range sheets {
		if v := mm(s.W, s.H); !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	return strings.Join(out, ", ")
}

type partResult struct {
	path        string
	pages       int
	sizes       [][2]float64 // размер каждой страницы PDF в мм
	fonts       []string
	color       string
	jpegImages  int
	otherImages int
}

// renderFile просит сервис рендера собрать один PDF из листов плана.
// Каждый лист — печатная страница сайта со своим размером; сервис печатает
// их по одному (память Chromium) и склеивает.
func (w *Worker) renderFile(ctx context.Context, orderID string, version int, f fileSpec) (partResult, error) {
	exp, sig := w.signer.Link(PrintSubject(orderID, version), linkTTL, time.Now())
	base := fmt.Sprintf("%s/print/%s?v=%d&exp=%s&sig=%s", strings.TrimRight(w.cfg.PrintBaseURL, "/"), orderID, version, exp, sig)
	sheets := make([]map[string]any, len(f.Sheets))
	for i, s := range f.Sheets {
		u := base + "&sheet=" + s.Kind
		if s.Kind == "page" {
			u += "&page=" + strconv.Itoa(s.Page)
		}
		sheets[i] = map[string]any{"url": u, "widthMm": s.W, "heightMm": s.H}
	}
	body, _ := json.Marshal(map[string]any{"sheets": sheets, "cmyk": w.cfg.CMYK})

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

	tmp, err := os.CreateTemp("", "photobook-*.pdf")
	if err != nil {
		return partResult{}, err
	}
	defer tmp.Close()
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		os.Remove(tmp.Name())
		return partResult{}, err
	}

	// Итог проверки PDF (pdfinfo/pdffonts/pdfimages в сервисе рендера) — в заголовках ответа.
	res := partResult{path: tmp.Name(), color: resp.Header.Get("X-Pdf-Color")}
	res.pages, _ = strconv.Atoi(resp.Header.Get("X-Pdf-Pages"))
	for _, sz := range strings.Split(resp.Header.Get("X-Pdf-Page-Sizes"), ";") {
		var wmm, hmm float64
		if _, err := fmt.Sscanf(sz, "%fx%f", &wmm, &hmm); err == nil {
			res.sizes = append(res.sizes, [2]float64{wmm, hmm})
		}
	}
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
