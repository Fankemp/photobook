package pages

import (
	"strings"
	"testing"
)

func ptr[T any](v T) *T { return &v }

func validText() Element {
	return Element{Type: Text, ID: "t1", X: 10, Y: 80, W: 80, H: 15,
		Text: ptr(""), Font: "lora", Size: 14, Align: "center"}
}

func TestPageValidate(t *testing.T) {
	tests := []struct {
		name    string
		page    Page
		wantErr string // пусто — ошибки быть не должно
	}{
		{"valid page", Page{ID: "p1", Background: "#ffffff", Elements: []Element{
			{Type: PhotoSlot, ID: "s1", X: 0, Y: 0, W: 100, H: 100},
			validText(),
			{Type: Sticker, ID: "st1", X: 50, Y: 10, W: 20, H: 20, StickerID: "heart-01"},
		}}, ""},
		{"rounding tolerance", Page{ID: "p1", Elements: []Element{
			{Type: PhotoSlot, ID: "s1", X: 33.34, Y: 0, W: 66.67, H: 100},
		}}, ""},
		{"empty page id", Page{}, "page id is empty"},
		{"bad background", Page{ID: "p1", Background: "white"}, "background"},
		{"duplicate element id", Page{ID: "p1", Elements: []Element{
			{Type: PhotoSlot, ID: "s1", W: 10, H: 10},
			{Type: PhotoSlot, ID: "s1", W: 10, H: 10},
		}}, "duplicate element id"},
		{"outside page", Page{ID: "p1", Elements: []Element{
			{Type: PhotoSlot, ID: "s1", X: 50, W: 60, H: 10},
		}}, "outside the page"},
		{"zero size", Page{ID: "p1", Elements: []Element{
			{Type: PhotoSlot, ID: "s1", W: 0, H: 10},
		}}, "outside the page"},
		{"unknown type", Page{ID: "p1", Elements: []Element{
			{Type: "video", ID: "v1", W: 10, H: 10},
		}}, "unknown type"},
		{"text without text field", Page{ID: "p1", Elements: []Element{
			func() Element { e := validText(); e.Text = nil; return e }(),
		}}, "text is missing"},
		{"text bad align", Page{ID: "p1", Elements: []Element{
			func() Element { e := validText(); e.Align = "justify"; return e }(),
		}}, "align"},
		{"zoom below 1", Page{ID: "p1", Elements: []Element{
			{Type: PhotoSlot, ID: "s1", W: 10, H: 10, Crop: &Crop{Zoom: 0.5}},
		}}, "zoom"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.page.Validate()
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

func TestValidateAllDuplicatePageID(t *testing.T) {
	err := ValidateAll([]Page{{ID: "p1"}, {ID: "p1"}})
	if err == nil || !strings.Contains(err.Error(), "duplicate page id") {
		t.Fatalf("error = %v, want duplicate page id", err)
	}
}

func TestCloneIsIndependent(t *testing.T) {
	orig := []Page{{ID: "p1", Elements: []Element{validText()}}}
	cp, err := Clone(orig)
	if err != nil {
		t.Fatal(err)
	}
	*cp[0].Elements[0].Text = "changed"
	if *orig[0].Elements[0].Text != "" {
		t.Fatal("changing the clone changed the original")
	}
}
