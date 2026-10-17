// Package formats — форматы книг (размеры, вылеты, DPI, цена) из таблицы formats.
package formats

import (
	"context"
	"errors"
	"fmt"

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
}

var ErrNotFound = errors.New("format not found")

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

const columns = `id, name, width_mm, height_mm, bleed_mm, safe_mm, pages, min_dpi, target_dpi, price_kzt`

func scan(row pgx.Row) (Format, error) {
	var f Format
	err := row.Scan(&f.ID, &f.Name, &f.WidthMM, &f.HeightMM, &f.BleedMM, &f.SafeMM,
		&f.Pages, &f.MinDPI, &f.TargetDPI, &f.PriceKZT)
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
