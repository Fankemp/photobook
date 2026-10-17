package assets

import "testing"

func TestOrientedSize(t *testing.T) {
	tests := []struct {
		name               string
		rawW, rawH, tw, th int
		wantW, wantH       int
	}{
		{"landscape, no rotation", 4000, 3000, 1600, 1200, 4000, 3000},
		{"phone portrait stored lying (EXIF 6)", 4000, 3000, 1200, 1600, 3000, 4000},
		{"portrait, no rotation", 3000, 4000, 1200, 1600, 3000, 4000},
		{"square", 2000, 2000, 1600, 1600, 2000, 2000},
		{"small, not upscaled", 300, 200, 300, 200, 300, 200},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w, h := orientedSize(tt.rawW, tt.rawH, tt.tw, tt.th)
			if w != tt.wantW || h != tt.wantH {
				t.Fatalf("got %dx%d, want %dx%d", w, h, tt.wantW, tt.wantH)
			}
		})
	}
}
