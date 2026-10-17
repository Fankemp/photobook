// Package templates загружает шаблоны книг из JSON-файлов.
//
// Добавить шаблон = положить файл в папку templates/ и перезапустить сервер.
// При старте все шаблоны проверяются: битый файл не даст серверу запуститься,
// и ошибка будет видна сразу, а не у клиента.
package templates

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"

	"photobook/internal/formats"
	"photobook/internal/pages"
)

type Template struct {
	SchemaVersion int          `json:"schemaVersion"`
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	Occasion      string       `json:"occasion"`
	Preview       string       `json:"preview,omitempty"` // картинка для каталога; если нет, показываем обложку
	FormatID      string       `json:"formatId"`
	Cover         pages.Page   `json:"cover"`
	Pages         []pages.Page `json:"pages"`
}

// Occasions — допустимые поводы. Подписи для них — во фронтенде (словарь),
// поэтому новый повод = строка здесь + перевод в ru.ts.
var Occasions = []string{"anniversary", "birthday", "travel", "mom", "wedding", "baby", "family", "other"}

var idRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// Catalog — загруженные шаблоны. После загрузки только читается,
// поэтому безопасен для одновременного использования из разных запросов.
type Catalog struct {
	list []Template
	byID map[string]Template
}

// LoadDir читает все *.json из dir и проверяет их против известных форматов.
func LoadDir(dir string, fmts map[string]formats.Format) (*Catalog, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no templates in %s", dir)
	}
	sort.Strings(files)

	c := &Catalog{byID: map[string]Template{}}
	for _, file := range files {
		t, err := loadFile(file, fmts)
		if err != nil {
			return nil, fmt.Errorf("template %s: %w", filepath.Base(file), err)
		}
		if _, dup := c.byID[t.ID]; dup {
			return nil, fmt.Errorf("template %s: duplicate id %q", filepath.Base(file), t.ID)
		}
		c.byID[t.ID] = t
		c.list = append(c.list, t)
	}
	return c, nil
}

func loadFile(path string, fmts map[string]formats.Format) (Template, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Template{}, err
	}
	var t Template
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields() // опечатка в имени поля — ошибка, а не тихо пропавшие данные
	if err := dec.Decode(&t); err != nil {
		return Template{}, fmt.Errorf("parse: %w", err)
	}
	return t, t.validate(fmts)
}

func (t Template) validate(fmts map[string]formats.Format) error {
	if t.SchemaVersion != pages.SchemaVersion {
		return fmt.Errorf("schemaVersion %d is not supported (current is %d)", t.SchemaVersion, pages.SchemaVersion)
	}
	if !idRe.MatchString(t.ID) {
		return fmt.Errorf("id %q must be lowercase latin letters, digits and dashes", t.ID)
	}
	if t.Name == "" {
		return fmt.Errorf("name is empty")
	}
	if !slices.Contains(Occasions, t.Occasion) {
		return fmt.Errorf("occasion %q is unknown, allowed: %v", t.Occasion, Occasions)
	}
	f, ok := fmts[t.FormatID]
	if !ok {
		return fmt.Errorf("formatId %q not found in formats table", t.FormatID)
	}
	if len(t.Pages) != f.Pages {
		return fmt.Errorf("has %d pages, format %q needs exactly %d", len(t.Pages), f.ID, f.Pages)
	}
	return pages.ValidateAll(append([]pages.Page{t.Cover}, t.Pages...))
}

// List возвращает шаблоны в порядке имён файлов.
func (c *Catalog) List() []Template {
	return c.list
}

func (c *Catalog) Get(id string) (Template, bool) {
	t, ok := c.byID[id]
	return t, ok
}
