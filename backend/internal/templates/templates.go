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
	"math"
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
	// Задняя обложка. Необязательна: без неё — пустая страница с фоном обложки.
	BackCover pages.Page `json:"backCover"`
}

// BackCoverID — id задней обложки, если шаблон её не задаёт.
const BackCoverID = "back"

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

// LoadDir читает все *.json из dir и проверяет их против известных форматов и шрифтов.
func LoadDir(dir string, fmts map[string]formats.Format, lib pages.Library) (*Catalog, error) {
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
		t, err := loadFile(file, fmts, lib)
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

func loadFile(path string, fmts map[string]formats.Format, lib pages.Library) (Template, error) {
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
	if t.BackCover.ID == "" {
		t.BackCover = pages.Page{ID: BackCoverID, Background: t.Cover.Background, Elements: []pages.Element{}}
	}
	return t, t.validate(fmts, lib)
}

func (t Template) validate(fmts map[string]formats.Format, lib pages.Library) error {
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
	all := append(append([]pages.Page{t.Cover}, t.Pages...), t.BackCover)
	if err := pages.ValidateAll(all, lib); err != nil {
		return err
	}
	if err := textInsideSafeZone(all, f); err != nil {
		return err
	}
	return noOverlaps(all, f)
}

// textInsideSafeZone: текстовые блоки шаблона не ближе к краю, чем safe_mm.
// Рез может сместиться на пару миллиметров — текст у края рискует быть срезанным.
// (Фото у края — нормально: они специально уходят в вылет.)
func textInsideSafeZone(all []pages.Page, f formats.Format) error {
	const eps = 0.01 // мм
	for _, p := range all {
		for _, e := range p.Elements {
			if e.Type != pages.Text {
				continue
			}
			minX, minY, maxX, maxY := boundsMM(e, f)
			if minX < f.SafeMM-eps || minY < f.SafeMM-eps || maxX > f.WidthMM-f.SafeMM+eps || maxY > f.HeightMM-f.SafeMM+eps {
				return fmt.Errorf("page %s, text %s: outside the safe zone (keep %.1f mm from the edges)", p.ID, e.ID, f.SafeMM)
			}
		}
	}
	return nil
}

// noOverlaps: в шаблоне фото не наезжает на фото, а текст — на текст. Подпись
// поверх фото и стикеры где угодно — можно, так задумывают оформление.
// Повёрнутый текст сравниваем по описанному вокруг него прямоугольнику — с запасом.
func noOverlaps(all []pages.Page, f formats.Format) error {
	const eps = 0.01 // мм: блоки, которые только касаются краями, не пересекаются
	for _, p := range all {
		for i, a := range p.Elements {
			for _, b := range p.Elements[i+1:] {
				if a.Type != b.Type || a.Type == pages.Sticker {
					continue
				}
				ax0, ay0, ax1, ay1 := boundsMM(a, f)
				bx0, by0, bx1, by1 := boundsMM(b, f)
				if ax0 < bx1-eps && bx0 < ax1-eps && ay0 < by1-eps && by0 < ay1-eps {
					return fmt.Errorf("page %s: %s %s overlaps %s", p.ID, a.Type, a.ID, b.ID)
				}
			}
		}
	}
	return nil
}

// boundsMM — границы блока на странице в мм с учётом поворота вокруг центра
// (та же формула, что у предупреждения в редакторе, frontend/src/editor/transform.ts).
func boundsMM(e pages.Element, f formats.Format) (minX, minY, maxX, maxY float64) {
	w, h := e.W/100*f.WidthMM, e.H/100*f.HeightMM
	cx, cy := e.X/100*f.WidthMM+w/2, e.Y/100*f.HeightMM+h/2
	rad := e.Rotation * math.Pi / 180
	hx := (math.Abs(w*math.Cos(rad)) + math.Abs(h*math.Sin(rad))) / 2
	hy := (math.Abs(w*math.Sin(rad)) + math.Abs(h*math.Cos(rad))) / 2
	return cx - hx, cy - hy, cx + hx, cy + hy
}

// List возвращает шаблоны в порядке имён файлов.
func (c *Catalog) List() []Template {
	return c.list
}

func (c *Catalog) Get(id string) (Template, bool) {
	t, ok := c.byID[id]
	return t, ok
}
