package books

import (
	"testing"

	"photobook/internal/pages"
	"photobook/internal/templates"
)

func TestNewFromTemplate(t *testing.T) {
	text := "Заголовок"
	tpl := templates.Template{
		ID: "tpl", FormatID: "f1",
		Cover: pages.Page{ID: "cover", Elements: []pages.Element{{Type: pages.Text, ID: "t1", Text: &text}}},
		Pages: []pages.Page{{ID: "p1"}},
	}

	b, err := NewFromTemplate(tpl)
	if err != nil {
		t.Fatal(err)
	}
	if !ValidToken(b.Token) {
		t.Errorf("token %q does not match the expected format", b.Token)
	}
	if b.TemplateID != "tpl" || b.FormatID != "f1" || b.SchemaVersion != pages.SchemaVersion {
		t.Errorf("unexpected book metadata: %+v", b)
	}

	// Книга не должна делить память с шаблоном.
	*b.Cover.Elements[0].Text = "изменено"
	if text != "Заголовок" {
		t.Error("editing the book changed the template")
	}

	other, _ := NewFromTemplate(tpl)
	if other.Token == b.Token {
		t.Error("two books got the same token")
	}
}

func TestValidToken(t *testing.T) {
	for token, want := range map[string]bool{
		"ABCDEFGHIJKLMNOPQRSTUVWXYZ": true,
		"ABCDEFGHIJKLMNOPQRSTUVWX27": true,
		"abcdefghijklmnopqrstuvwxyz": false, // только заглавные
		"ABCDEFGHIJKLMNOPQRSTUVWX01": false, // 0 и 1 нет в base32
		"ABC":                        false,
		"":                           false,
	} {
		if got := ValidToken(token); got != want {
			t.Errorf("ValidToken(%q) = %v, want %v", token, got, want)
		}
	}
}
