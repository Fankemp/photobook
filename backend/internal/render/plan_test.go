package render

import (
	"strings"
	"testing"

	"photobook/internal/formats"
)

func kinds(f fileSpec) string {
	var out []string
	for _, s := range f.Sheets {
		if s.Kind == "page" {
			out = append(out, "p"+string(rune('0'+s.Page)))
		} else {
			out = append(out, s.Kind)
		}
	}
	return strings.Join(out, " ")
}

func TestPlan(t *testing.T) {
	sheet := Sheet{WidthMM: 200, HeightMM: 200, BleedMM: 3}
	order := []string{"front", "pages", "back"}

	single := Plan("single", order, 3, sheet)
	if len(single) != 1 || single[0].Name != "book" || kinds(single[0]) != "front p0 p1 p2 back" {
		t.Fatalf("single = %+v", single)
	}

	split := Plan("split", order, 3, sheet)
	if len(split) != 2 || split[0].Name != "cover" || kinds(split[0]) != "front back" ||
		split[1].Name != "block" || kinds(split[1]) != "p0 p1 p2" {
		t.Fatalf("split = %+v", split)
	}

	// Порядок — из формата: например, сначала задняя обложка.
	custom := Plan("single", []string{"back", "pages", "front"}, 2, sheet)
	if kinds(custom[0]) != "back p0 p1 front" {
		t.Fatalf("custom order = %s", kinds(custom[0]))
	}

	// Без обложек в порядке — в split только block.pdf.
	onlyPages := Plan("split", []string{"pages"}, 2, sheet)
	if len(onlyPages) != 1 || onlyPages[0].Name != "block" {
		t.Fatalf("pages only = %+v", onlyPages)
	}

	// Загиб увеличивает только листы обложки.
	sheet.WrapMM = 15
	withWrap := Plan("single", order, 1, sheet)[0].Sheets
	if withWrap[0].W != 236 || withWrap[1].W != 206 || withWrap[2].W != 236 {
		t.Fatalf("sizes with wrap = %v %v %v", withWrap[0].W, withWrap[1].W, withWrap[2].W)
	}
}

func TestDescribe(t *testing.T) {
	sheets := Plan("single", []string{"front", "pages", "back"}, 20, Sheet{WidthMM: 200, HeightMM: 200, BleedMM: 3})[0].Sheets
	if got := describe(sheets); got != "передняя обложка, страницы 1–20, задняя обложка" {
		t.Errorf("describe = %q", got)
	}
	if got := sizes(sheets); got != "206×206" {
		t.Errorf("sizes = %q", got)
	}
}

func TestFormatOrder(t *testing.T) {
	for in, wantErr := range map[string]bool{
		"front,pages,back":  false,
		"pages":             false,
		" back , pages ":    false,
		"front,back":        true, // без страниц
		"front,pages,pages": true,
		"front,inside":      true,
	} {
		_, err := formats.Format{ID: "f", PDFMode: "single", PDFOrder: in}.Order()
		if (err != nil) != wantErr {
			t.Errorf("Order(%q) error = %v, want error %v", in, err, wantErr)
		}
	}
	if _, err := (formats.Format{ID: "f", PDFMode: "both", PDFOrder: "pages"}).Order(); err == nil {
		t.Error("unknown pdf_mode accepted")
	}
}
