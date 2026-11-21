package backgrounds

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadShippedConfig(t *testing.T) {
	r, err := Load("../../../frontend/src/book/backgrounds.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"stripes-wine", "dots-cocoa", "lace-cocoa"} {
		if !r.Has(id) {
			t.Errorf("pattern %q is missing from the shipped config", id)
		}
	}
	if r.Has("nope") {
		t.Error("unknown pattern reported as present")
	}
}

func TestLoadRejectsBadFiles(t *testing.T) {
	for name, cfg := range map[string]string{
		"path outside the folder": `{"backgrounds": [{"id": "x", "name": "X", "file": "../x.svg"}]}`,
		"not an svg":              `{"backgrounds": [{"id": "x", "name": "X", "file": "x.png"}]}`,
		"duplicate id":            `{"backgrounds": [{"id": "x", "name": "X", "file": "x.svg"}, {"id": "x", "name": "Y", "file": "y.svg"}]}`,
	} {
		path := filepath.Join(t.TempDir(), "b.json")
		if err := os.WriteFile(path, []byte(cfg), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(path); err == nil {
			t.Errorf("%s: config accepted", name)
		}
	}
}
