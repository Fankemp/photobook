package stickers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Настоящий конфиг из репозитория: загружается, и у каждого стикера есть файл.
func TestShippedConfig(t *testing.T) {
	r, err := Load("../../../frontend/src/book/stickers.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(r.byID) == 0 {
		t.Fatal("no stickers loaded")
	}
	for id, s := range r.byID {
		if _, err := os.Stat(filepath.Join("../../../frontend/public/stickers", s.File)); err != nil {
			t.Errorf("sticker %s: %v", id, err)
		}
	}
}

func TestLoadErrors(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		wantErr string
	}{
		{"empty", `{"sets": []}`, "empty"},
		{"bad id", `{"sets": [{"id": "a", "stickers": [{"id": "Heart", "file": "a/heart.svg", "aspect": 1}]}]}`, "lowercase"},
		{"duplicate", `{"sets": [{"id": "a", "stickers": [
			{"id": "heart", "file": "a/heart.svg", "aspect": 1},
			{"id": "heart", "file": "a/heart2.svg", "aspect": 1}]}]}`, "duplicate"},
		{"path outside", `{"sets": [{"id": "a", "stickers": [{"id": "heart", "file": "../heart.svg", "aspect": 1}]}]}`, "set/name.svg"},
		{"not svg", `{"sets": [{"id": "a", "stickers": [{"id": "heart", "file": "a/heart.png", "aspect": 1}]}]}`, "set/name.svg"},
		{"no aspect", `{"sets": [{"id": "a", "stickers": [{"id": "heart", "file": "a/heart.svg"}]}]}`, "aspect"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "stickers.json")
			if err := os.WriteFile(path, []byte(tt.config), 0o644); err != nil {
				t.Fatal(err)
			}
			_, err := Load(path)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}
