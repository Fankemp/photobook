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
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	WidthMM   float64 `json:"widthMm"`
	HeightMM  float64 `json:"heightMm"`
	BleedMM   float64 `json:"bleedMm"`
	SafeMM    float64 `json:"safeMm"`
	Pages     int     `json:"pages"` // внутренние страницы, без обложки
	MinDPI    int     `json:"minDpi"`
	TargetDPI int     `json:"targetDpi"`
	PriceKZT  int     `json:"priceKzt"`
	SpineMM   float64 `json:"spineMm"` // корешок обложки (пока 0 — даст типография)
	WrapMM    float64 `json:"wrapMm"`  // загиб обложки на картон с каждой стороны
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

var ErrNotFound = errors.New("format not found")

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

const columns = `id, name, width_mm, height_mm, bleed_mm, safe_mm, pages, min_dpi, target_dpi, price_kzt, spine_mm, wrap_mm,
	pdf_mode, pdf_order`

func scan(row pgx.Row) (Format, error) {
	var f Format
	err := row.Scan(&f.ID, &f.Name, &f.WidthMM, &f.HeightMM, &f.BleedMM, &f.SafeMM,
		&f.Pages, &f.MinDPI, &f.TargetDPI, &f.PriceKZT, &f.SpineMM, &f.WrapMM, &f.PDFMode, &f.PDFOrder)
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
