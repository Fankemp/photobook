// Package stickers — список стикеров из общего с фронтендом конфига
// (frontend/src/book/stickers.json). Нужен для проверки шаблонов и книг:
// элемент-стикер может ссылаться только на стикер, который у нас есть.
// Сами рисунки (SVG) лежат во frontend/public/stickers, backend их не читает.
package stickers

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
)

type Sticker struct {
	ID     string  `json:"id"`
	File   string  `json:"file"`   // путь внутри frontend/public/stickers
	Aspect float64 `json:"aspect"` // ширина / высота рисунка
}

type Registry struct {
	byID map[string]Sticker
}

func New(list ...Sticker) *Registry {
	r := &Registry{byID: map[string]Sticker{}}
	for _, s := range list {
		r.byID[s.ID] = s
	}
	return r
}

var (
	idRe   = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	fileRe = regexp.MustCompile(`^[a-z0-9-]+/[a-z0-9-]+\.svg$`)
)

// Load читает конфиг и проверяет его: id уникальны, файлы — SVG внутри папки
// стикеров. Названия и наборы нужны только фронтенду.
func Load(path string) (*Registry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read stickers config: %w", err)
	}
	var cfg struct {
		Sets []struct {
			ID       string    `json:"id"`
			Stickers []Sticker `json:"stickers"`
		} `json:"sets"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse stickers config %s: %w", path, err)
	}
	var list []Sticker
	seen := map[string]bool{}
	for _, set := range cfg.Sets {
		for _, s := range set.Stickers {
			switch {
			case !idRe.MatchString(s.ID):
				return nil, fmt.Errorf("stickers config: id %q must be lowercase latin, digits and dashes", s.ID)
			case seen[s.ID]:
				return nil, fmt.Errorf("stickers config: duplicate id %q", s.ID)
			case !fileRe.MatchString(s.File) || strings.Contains(s.File, ".."):
				return nil, fmt.Errorf("stickers config: sticker %s: file %q must look like set/name.svg", s.ID, s.File)
			case s.Aspect <= 0:
				return nil, fmt.Errorf("stickers config: sticker %s: aspect must be > 0", s.ID)
			}
			seen[s.ID] = true
			list = append(list, s)
		}
	}
	if len(list) == 0 {
		return nil, fmt.Errorf("stickers config %s is empty", path)
	}
	return New(list...), nil
}

func (r *Registry) Has(id string) bool {
	_, ok := r.byID[id]
	return ok
}
