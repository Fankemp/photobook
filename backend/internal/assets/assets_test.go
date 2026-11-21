package assets

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseHeader(t *testing.T) {
	out := `photo.heic: 4032x3024 uchar, 3 bands, srgb, heifload
width: 4032
height: 3024
orientation: 6
exif-ifd2-DateTimeOriginal: 2023:07:15 14:22:01 (2023:07:15 14:22:01, ASCII, 20 components, 20 bytes)
`
	h, err := parseHeader(out)
	if err != nil {
		t.Fatal(err)
	}
	if h.Width != 4032 || h.Height != 3024 || h.Orientation != 6 {
		t.Fatalf("got %+v", h)
	}
	want := time.Date(2023, 7, 15, 14, 22, 1, 0, time.UTC)
	if h.TakenAt == nil || !h.TakenAt.Equal(want) {
		t.Fatalf("taken at = %v, want %v", h.TakenAt, want)
	}

	h, err = parseHeader("width: 800\nheight: 600\n")
	if err != nil || h.Orientation != 1 || h.TakenAt != nil {
		t.Fatalf("PNG without EXIF: %+v, %v", h, err)
	}
	if _, err := parseHeader("vips: no such file"); err == nil {
		t.Fatal("output without size must be an error")
	}
}

func TestPrintCopyQuality(t *testing.T) {
	for _, tt := range []struct {
		typ         string
		orientation int
		want        int
	}{
		{"image/jpeg", 1, 0},
		{"image/jpeg", 6, uprightQuality},
		{"image/png", 1, 0},
		{"image/heic", 1, heifQuality}, // Chromium не печатает HEIC — нужна копия всегда
		{"image/heif", 1, heifQuality},
	} {
		if got := printCopyQuality(tt.typ, tt.orientation); got != tt.want {
			t.Errorf("%s orientation %d: got %d, want %d", tt.typ, tt.orientation, got, tt.want)
		}
	}
}

func TestLoadLimits(t *testing.T) {
	l, err := LoadLimits("../../../frontend/src/editor/uploads.json")
	if err != nil {
		t.Fatal(err)
	}
	if l.MaxBytes() < 10<<20 || l.Types["image/heic"] == "" || l.Types["image/jpeg"] != "jpg" {
		t.Fatalf("unexpected limits from the shared config: %+v", l)
	}

	bad := filepath.Join(t.TempDir(), "uploads.json")
	if err := os.WriteFile(bad, []byte(`{"maxFileMb": 0, "maxPerBook": 10, "types": {"image/jpeg": "jpg"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadLimits(bad); err == nil {
		t.Fatal("maxFileMb 0 must be rejected")
	}
}
