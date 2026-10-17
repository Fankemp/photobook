// Package fonts — список шрифтов из общего с фронтендом конфига
// (frontend/src/book/fonts.json). Нужен для проверки шаблонов и книг:
// текст может ссылаться только на шрифт, который у нас есть, иначе на печати
// он подменится чужим.
package fonts

import (
	"encoding/json"
	"fmt"
	"os"
)

type Font struct {
	ID   string `json:"id"`
	Bold bool   `json:"bold"` // есть жирное начертание
}

type Registry struct {
	byID map[string]Font
}

func New(list ...Font) *Registry {
	r := &Registry{byID: map[string]Font{}}
	for _, f := range list {
		r.byID[f.ID] = f
	}
	return r
}

// Load читает конфиг. Остальные поля (файлы, категория) нужны только фронтенду.
func Load(path string) (*Registry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read fonts config: %w", err)
	}
	var cfg struct {
		Fonts []Font `json:"fonts"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse fonts config %s: %w", path, err)
	}
	if len(cfg.Fonts) == 0 {
		return nil, fmt.Errorf("fonts config %s is empty", path)
	}
	return New(cfg.Fonts...), nil
}

func (r *Registry) Has(id string) bool {
	_, ok := r.byID[id]
	return ok
}

func (r *Registry) HasBold(id string) bool {
	return r.byID[id].Bold
}
