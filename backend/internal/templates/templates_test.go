package templates

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"photobook/internal/fonts"
	"photobook/internal/formats"
	"photobook/internal/pages"
	"photobook/internal/stickers"
)

// Формат как в миграции 00001 — тестам не нужна база.
var testFormats = map[string]formats.Format{
	"square-200": {ID: "square-200", WidthMM: 200, HeightMM: 200, BleedMM: 3, SafeMM: 5, Pages: 20, MinDPI: 200, TargetDPI: 300},
}

// Все шаблоны из репозитория должны проходить проверку: битый шаблон
// ловится здесь, а не при старте сервера.
func TestShippedTemplatesAreValid(t *testing.T) {
	// Настоящие конфиги шрифтов и стикеров: шаблон не должен ссылаться на то, чего нет.
	fontReg, err := fonts.Load("../../../frontend/src/book/fonts.json")
	if err != nil {
		t.Fatal(err)
	}
	stickerReg, err := stickers.Load("../../../frontend/src/book/stickers.json")
	if err != nil {
		t.Fatal(err)
	}
	c, err := LoadDir("../../../templates", testFormats, pages.Library{Fonts: fontReg, Stickers: stickerReg})
	if err != nil {
		t.Fatal(err)
	}
	if len(c.List()) == 0 {
		t.Fatal("no templates loaded")
	}
	for _, tpl := range c.List() {
		if got, ok := c.Get(tpl.ID); !ok || got.ID != tpl.ID {
			t.Errorf("Get(%q) failed", tpl.ID)
		}
	}
}

func TestLoadDirErrors(t *testing.T) {
	cover := `"cover": {"id": "cover", "background": "#ffffff", "elements": []}`
	onePage := `"pages": [{"id": "p1", "background": "#ffffff", "elements": []}]`
	oneFormat := map[string]formats.Format{"f1": {ID: "f1", Pages: 1, WidthMM: 200, HeightMM: 200, SafeMM: 5}}
	textAt := func(x int) string {
		return `{"type": "text", "id": "t1", "x": ` + strconv.Itoa(x) + `, "y": 40, "w": 50, "h": 10, "text": "", "font": "lora", "size": 12, "align": "left"}`
	}
	pageWith := func(el string) string {
		return `"pages": [{"id": "p1", "background": "#ffffff", "elements": [` + el + `]}]`
	}
	photoAt := func(id string, x int) string {
		return `{"type": "photo_slot", "id": "` + id + `", "x": ` + strconv.Itoa(x) + `, "y": 10, "w": 40, "h": 40}`
	}
	textWithID := func(id string, x int) string {
		return strings.Replace(textAt(x), `"id": "t1"`, `"id": "`+id+`"`, 1)
	}
	heart := `{"type": "sticker", "id": "st1", "x": 30, "y": 30, "w": 20, "h": 20, "stickerId": "love-heart"}`
	tpl := func(page string) string {
		return `{"schemaVersion": 1, "id": "ok", "name": "Ok", "occasion": "other", "formatId": "f1", ` + cover + `, ` + page + `}`
	}

	tests := []struct {
		name    string
		file    string
		wantErr string
	}{
		{"valid", `{"schemaVersion": 1, "id": "ok", "name": "Ok", "occasion": "other", "formatId": "f1", ` + cover + `, ` + onePage + `}`, ""},
		{"unknown field", `{"schemaVersion": 1, "id": "ok", "nmae": "typo"}`, "unknown field"},
		{"old schema", `{"schemaVersion": 99, "id": "ok", "name": "Ok", "occasion": "other", "formatId": "f1", ` + cover + `, ` + onePage + `}`, "schemaVersion"},
		{"bad id", `{"schemaVersion": 1, "id": "Bad Id", "name": "Ok", "occasion": "other", "formatId": "f1", ` + cover + `, ` + onePage + `}`, "lowercase"},
		{"unknown occasion", `{"schemaVersion": 1, "id": "ok", "name": "Ok", "occasion": "party", "formatId": "f1", ` + cover + `, ` + onePage + `}`, "occasion"},
		{"unknown format", `{"schemaVersion": 1, "id": "ok", "name": "Ok", "occasion": "other", "formatId": "nope", ` + cover + `, ` + onePage + `}`, "formatId"},
		{"wrong page count", `{"schemaVersion": 1, "id": "ok", "name": "Ok", "occasion": "other", "formatId": "f1", ` + cover + `, "pages": []}`, "needs exactly 1"},
		{"text inside safe zone", `{"schemaVersion": 1, "id": "ok", "name": "Ok", "occasion": "other", "formatId": "f1", ` + cover + `, ` + pageWith(textAt(10)) + `}`, ""},
		// Блок 100×20 мм у верхнего края (10 мм) прямо — внутри, повёрнутый на 30° — углом в зоне реза.
		{"text near the top, straight", `{"schemaVersion": 1, "id": "ok", "name": "Ok", "occasion": "other", "formatId": "f1", ` + cover + `, ` + pageWith(strings.Replace(textAt(10), `"y": 40`, `"y": 5`, 1)) + `}`, ""},
		{"text near the top, rotated", `{"schemaVersion": 1, "id": "ok", "name": "Ok", "occasion": "other", "formatId": "f1", ` + cover + `, ` + pageWith(strings.Replace(textAt(10), `"y": 40`, `"y": 5, "rotation": 30`, 1)) + `}`, "safe zone"},
		{"text too close to the edge", `{"schemaVersion": 1, "id": "ok", "name": "Ok", "occasion": "other", "formatId": "f1", ` + cover + `, ` + pageWith(textAt(1)) + `}`, "safe zone"},
		{"photos side by side", tpl(pageWith(photoAt("s1", 5) + `, ` + photoAt("s2", 45))), ""},
		{"photos overlap", tpl(pageWith(photoAt("s1", 5) + `, ` + photoAt("s2", 40))), "photo_slot s1 overlaps s2"},
		{"texts overlap", tpl(pageWith(textWithID("t1", 10) + `, ` + textWithID("t2", 40))), "text t1 overlaps t2"},
		{"caption over a photo, sticker on top", tpl(pageWith(photoAt("s1", 5) + `, ` + textAt(10) + `, ` + heart)), ""},
		{"unknown font", `{"schemaVersion": 1, "id": "ok", "name": "Ok", "occasion": "other", "formatId": "f1", ` + cover + `, ` + pageWith(strings.Replace(textAt(10), "lora", "comic-sans", 1)) + `}`, "fonts config"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "t.json"), []byte(tt.file), 0o644); err != nil {
				t.Fatal(err)
			}
			_, err := LoadDir(dir, oneFormat, pages.Library{Fonts: fonts.New(fonts.Font{ID: "lora", Bold: true}), Stickers: stickers.New(stickers.Sticker{ID: "love-heart"})})
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}
