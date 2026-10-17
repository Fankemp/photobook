// Package formats — форматы книг (размеры, вылеты, DPI, цена) из таблицы formats.
package formats

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Format struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	WidthMM  float64 `json:"widthMm"`
	HeightMM float64 `json:"heightMm"`
	BleedMM  float64 `json:"bleedMm"`
	SafeMM   float64 `json:"safeMm"`
	// Страницы блока (без обложек): Pages — у новой книги (столько в шаблонах);
	// клиент меняет число сам, листами по PageStep, от MinPages до MaxPages.
	Pages     int `json:"pages"`
	MinPages  int `json:"minPages"`
	MaxPages  int `json:"maxPages"`
	PageStep  int `json:"pageStep"`
	MinDPI    int `json:"minDpi"`
	TargetDPI int `json:"targetDpi"`
	PriceKZT  int `json:"priceKzt"` // цена книги с Pages страниц
	// Доплата за страницу сверх Pages (за каждую страницу меньше — скидка).
	PricePerPageKZT int     `json:"pricePerPageKzt"`
	SpineMM         float64 `json:"spineMm"` // корешок обложки (пока 0 — даст типография)
	WrapMM          float64 `json:"wrapMm"`  // загиб обложки на картон с каждой стороны
	// Печатный PDF: single — один файл, split — cover.pdf и block.pdf.
	PDFMode string `json:"pdfMode"`
	// Порядок частей через запятую: front — передняя обложка, pages — страницы,
	// back — задняя обложка. По умолчанию front,pages,back.
	PDFOrder string `json:"pdfOrder"`
}

// PDF-части, из которых состоит печатная книга.
const (
	PartFront = "front"
	PartPages = "pages"
	PartBack  = "back"
)

// Order — порядок частей печатного PDF из настройки формата. Проверяется
// при старте сервера (ошибка в настройке — сервер не запустится).
func (f Format) Order() ([]string, error) {
	var out []string
	for _, p := range strings.Split(f.PDFOrder, ",") {
		p = strings.TrimSpace(p)
		if p != PartFront && p != PartPages && p != PartBack {
			return nil, fmt.Errorf("format %s: pdf_order: unknown part %q (front, pages, back)", f.ID, p)
		}
		if slices.Contains(out, p) {
			return nil, fmt.Errorf("format %s: pdf_order: %q twice", f.ID, p)
		}
		out = append(out, p)
	}
	if !slices.Contains(out, PartPages) {
		return nil, fmt.Errorf("format %s: pdf_order must contain pages", f.ID)
	}
	if f.PDFMode != "single" && f.PDFMode != "split" {
		return nil, fmt.Errorf("format %s: pdf_mode %q (single or split)", f.ID, f.PDFMode)
	}
	return out, nil
}

// Validate — настройка формата целиком: порядок частей PDF и пределы числа
// страниц (то же проверяет база, ограничения в миграциях). Проверяется при
// старте сервера.
func (f Format) Validate() error {
	if _, err := f.Order(); err != nil {
		return err
	}
	if f.PageStep < 1 || f.MinPages < 1 || f.MinPages > f.Pages || f.Pages > f.MaxPages || f.Pages%f.PageStep != 0 {
		return fmt.Errorf("format %s: pages %d must be within min_pages %d..max_pages %d and a multiple of page_step %d",
			f.ID, f.Pages, f.MinPages, f.MaxPages, f.PageStep)
	}
	return nil
}

// PageCountOK — можно ли книге иметь n страниц: в пределах и кратно шагу.
func (f Format) PageCountOK(n int) bool {
	return n >= f.MinPages && n <= f.MaxPages && f.PageStep > 0 && n%f.PageStep == 0
}

// Price — цена книги с n страницами: цена формата плюс доплата за каждую
// страницу сверх Pages (меньше страниц — дешевле, но не меньше нуля).
func (f Format) Price(n int) int {
	return max(0, f.PriceKZT+f.PricePerPageKZT*(n-f.Pages))
}

var ErrNotFound = errors.New("format not found")

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

const columns = `id, name, width_mm, height_mm, bleed_mm, safe_mm, pages, min_pages, max_pages, page_step,
	min_dpi, target_dpi, price_kzt, price_per_page_kzt, spine_mm, wrap_mm, pdf_mode, pdf_order`

func scan(row pgx.Row) (Format, error) {
	var f Format
	err := row.Scan(&f.ID, &f.Name, &f.WidthMM, &f.HeightMM, &f.BleedMM, &f.SafeMM,
		&f.Pages, &f.MinPages, &f.MaxPages, &f.PageStep,
		&f.MinDPI, &f.TargetDPI, &f.PriceKZT, &f.PricePerPageKZT, &f.SpineMM, &f.WrapMM, &f.PDFMode, &f.PDFOrder)
	return f, err
}

func (s *Store) Get(ctx context.Context, id string) (Format, error) {
	f, err := scan(s.db.QueryRow(ctx, `SELECT `+columns+` FROM formats WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Format{}, ErrNotFound
	}
	if err != nil {
		return Format{}, fmt.Errorf("get format %q: %w", id, err)
	}
	return f, nil
}

// All возвращает все форматы, ключ — id.
func (s *Store) All(ctx context.Context) (map[string]Format, error) {
	rows, err := s.db.Query(ctx, `SELECT `+columns+` FROM formats`)
	if err != nil {
		return nil, fmt.Errorf("list formats: %w", err)
	}
	defer rows.Close()

	out := map[string]Format{}
	for rows.Next() {
		f, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("scan format: %w", err)
		}
		out[f.ID] = f
	}
	return out, rows.Err()
}
