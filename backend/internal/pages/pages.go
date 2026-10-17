// Package pages — формат страницы книги (единый JSON для редактора, превью и PDF).
//
// Координаты элементов — проценты от страницы по линии реза (0–100), поэтому
// одинаково работают на любом экране и в PDF. Вылет за край добавляет рендер.
package pages

import (
	"encoding/json"
	"fmt"
	"regexp"
)

// SchemaVersion — текущая версия формата JSON страниц. Меняется, когда формат
// меняется несовместимо; книга хранит версию, с которой была создана.
const SchemaVersion = 1

type Page struct {
	ID         string    `json:"id"`
	Background string    `json:"background"`
	Elements   []Element `json:"elements"`
}

type ElementType string

const (
	PhotoSlot ElementType = "photo_slot"
	Text      ElementType = "text"
	Sticker   ElementType = "sticker"
)

// Element — один элемент страницы. Поля, которые есть только у части типов,
// сделаны указателями или omitempty, чтобы в JSON не попадало лишнее.
type Element struct {
	Type ElementType `json:"type"`
	ID   string      `json:"id"`
	X    float64     `json:"x"`
	Y    float64     `json:"y"`
	W    float64     `json:"w"`
	H    float64     `json:"h"`

	// photo_slot
	AssetID *string `json:"assetId,omitempty"`
	Crop    *Crop   `json:"crop,omitempty"`

	// text
	Text  *string `json:"text,omitempty"`
	Font  string  `json:"font,omitempty"`
	Size  float64 `json:"size,omitempty"` // кегль в пунктах на напечатанной странице
	Color string  `json:"color,omitempty"`
	Align string  `json:"align,omitempty"`
	Bold  bool    `json:"bold,omitempty"`

	// sticker
	StickerID string  `json:"stickerId,omitempty"`
	Rotation  float64 `json:"rotation,omitempty"`
}

type Crop struct {
	Zoom    float64 `json:"zoom"`
	OffsetX float64 `json:"offsetX"`
	OffsetY float64 `json:"offsetY"`
}

var colorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// Допуск на погрешность дробных процентов (например, 33.34 + 66.67).
const eps = 0.01

// Validate проверяет одну страницу: геометрию, обязательные поля по типам,
// уникальность id элементов.
func (p Page) Validate() error {
	if p.ID == "" {
		return fmt.Errorf("page id is empty")
	}
	if p.Background != "" && !colorRe.MatchString(p.Background) {
		return fmt.Errorf("page %s: background %q is not #rrggbb", p.ID, p.Background)
	}
	seen := map[string]bool{}
	for i, e := range p.Elements {
		if e.ID == "" {
			return fmt.Errorf("page %s: element #%d has empty id", p.ID, i)
		}
		if seen[e.ID] {
			return fmt.Errorf("page %s: duplicate element id %q", p.ID, e.ID)
		}
		seen[e.ID] = true
		if err := e.validate(); err != nil {
			return fmt.Errorf("page %s, element %s: %w", p.ID, e.ID, err)
		}
	}
	return nil
}

func (e Element) validate() error {
	if e.X < 0 || e.Y < 0 || e.W <= 0 || e.H <= 0 || e.X+e.W > 100+eps || e.Y+e.H > 100+eps {
		return fmt.Errorf("geometry x=%v y=%v w=%v h=%v is outside the page (0–100)", e.X, e.Y, e.W, e.H)
	}
	switch e.Type {
	case PhotoSlot:
		if e.Crop != nil && e.Crop.Zoom < 1 {
			return fmt.Errorf("crop zoom must be >= 1")
		}
	case Text:
		if e.Text == nil {
			return fmt.Errorf("text is missing")
		}
		if e.Font == "" {
			return fmt.Errorf("font is empty")
		}
		if e.Size <= 0 {
			return fmt.Errorf("size must be > 0")
		}
		if e.Color != "" && !colorRe.MatchString(e.Color) {
			return fmt.Errorf("color %q is not #rrggbb", e.Color)
		}
		switch e.Align {
		case "left", "center", "right":
		default:
			return fmt.Errorf("align %q must be left, center or right", e.Align)
		}
	case Sticker:
		if e.StickerID == "" {
			return fmt.Errorf("stickerId is empty")
		}
	default:
		return fmt.Errorf("unknown type %q", e.Type)
	}
	return nil
}

// ValidateAll проверяет набор страниц (обложка + внутренние) и уникальность id страниц.
func ValidateAll(all []Page) error {
	seen := map[string]bool{}
	for _, p := range all {
		if err := p.Validate(); err != nil {
			return err
		}
		if seen[p.ID] {
			return fmt.Errorf("duplicate page id %q", p.ID)
		}
		seen[p.ID] = true
	}
	return nil
}

// Clone делает глубокую копию через JSON: книга получает свои страницы,
// независимые от шаблона.
func Clone[T any](v T) (T, error) {
	var out T
	b, err := json.Marshal(v)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(b, &out)
	return out, err
}
