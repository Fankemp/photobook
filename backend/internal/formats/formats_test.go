package formats

import (
	"strings"
	"testing"
)

// Формат как в миграциях: 20 страниц у новой книги, можно 10…20 листами по 2.
func testFormat() Format {
	return Format{ID: "f", Pages: 20, MinPages: 10, MaxPages: 20, PageStep: 2, PriceKZT: 15000, PDFMode: "single", PDFOrder: "front,pages,back"}
}

func TestPageCountOK(t *testing.T) {
	f := testFormat()
	for n, want := range map[int]bool{
		10: true, 12: true, 18: true, 20: true,
		8:  false, // меньше минимума
		22: false, // больше максимума
		11: false, // не кратно шагу
		19: false,
		0:  false,
	} {
		if got := f.PageCountOK(n); got != want {
			t.Errorf("PageCountOK(%d) = %v, want %v", n, got, want)
		}
	}
}

func TestPrice(t *testing.T) {
	f := testFormat()
	if got := f.Price(20); got != 15000 {
		t.Errorf("price at default pages = %d, want 15000", got)
	}
	if got := f.Price(16); got != 15000 {
		t.Errorf("no per-page price: 16 pages cost %d, want 15000", got)
	}
	f.PricePerPageKZT = 500
	if got := f.Price(16); got != 13000 {
		t.Errorf("16 pages = 15000 − 4×500 = 13000, got %d", got)
	}
	f.MaxPages = 30
	if got := f.Price(24); got != 17000 {
		t.Errorf("24 pages = 15000 + 4×500 = 17000, got %d", got)
	}
	f.PriceKZT = 0
	if got := f.Price(10); got != 0 {
		t.Errorf("price never goes below zero, got %d", got)
	}
}

func TestValidatePages(t *testing.T) {
	if err := testFormat().Validate(); err != nil {
		t.Fatalf("valid format: %v", err)
	}
	for name, mod := range map[string]func(*Format){
		"pages above max":      func(f *Format) { f.MaxPages = 18 },
		"pages below min":      func(f *Format) { f.MinPages = 22; f.MaxPages = 24 },
		"pages not a multiple": func(f *Format) { f.PageStep = 3 },
		"zero step":            func(f *Format) { f.PageStep = 0 },
	} {
		f := testFormat()
		mod(&f)
		if err := f.Validate(); err == nil || !strings.Contains(err.Error(), "min_pages") {
			t.Errorf("%s: error = %v, want page range error", name, err)
		}
	}
}
