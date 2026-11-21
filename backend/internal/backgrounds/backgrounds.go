// Package backgrounds — узоры фона страниц (полоски, горошек, плитка, кружево)
// из общего с фронтендом конфига frontend/src/book/backgrounds.json. Узор —
// наш SVG во frontend/public/backgrounds; страница ссылается на него по id
// (поле backgroundImage), backend проверяет, что такой узор есть.
package backgrounds

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
)

type Background struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	File string `json:"file"` // путь внутри frontend/public/backgrounds
}

type Registry struct {
	byID map[string]Background
}

func New(list ...Background) *Registry {
	r := &Registry{byID: map[string]Background{}}
	for _, b := range list {
		r.byID[b.ID] = b
	}
	return r
}

var (
	idRe   = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	fileRe = regexp.MustCompile(`^[a-z0-9-]+\.svg$`)
)

// Load читает и проверяет конфиг: id уникальны, файлы — SVG в папке узоров.
func Load(path string) (*Registry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read backgrounds config: %w", err)
	}
	var cfg struct {
		Backgrounds []Background `json:"backgrounds"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse backgrounds config %s: %w", path, err)
	}
	seen := map[string]bool{}
	for _, b := range cfg.Backgrounds {
		switch {
		case !idRe.MatchString(b.ID):
			return nil, fmt.Errorf("backgrounds config: id %q must be lowercase latin, digits and dashes", b.ID)
		case seen[b.ID]:
			return nil, fmt.Errorf("backgrounds config: duplicate id %q", b.ID)
		case !fileRe.MatchString(b.File):
			return nil, fmt.Errorf("backgrounds config: %s: file %q must look like name.svg", b.ID, b.File)
		}
		seen[b.ID] = true
	}
	return New(cfg.Backgrounds...), nil
}

func (r *Registry) Has(id string) bool {
	_, ok := r.byID[id]
	return ok
}
