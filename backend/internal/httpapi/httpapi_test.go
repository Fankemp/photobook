package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) error { return f.err }

func TestHealth(t *testing.T) {
	down := fakePinger{err: errors.New("connection refused")}
	tests := []struct {
		name        string
		db, storage Pinger
		wantCode    int
		wantStatus  string
		wantChecks  map[string]string
	}{
		{"all ok", fakePinger{}, fakePinger{}, http.StatusOK, "ok",
			map[string]string{"db": "ok", "storage": "ok"}},
		{"db down", down, fakePinger{}, http.StatusServiceUnavailable, "error",
			map[string]string{"db": "error", "storage": "ok"}},
		{"storage down", fakePinger{}, down, http.StatusServiceUnavailable, "error",
			map[string]string{"db": "ok", "storage": "error"}},
	}

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			New(tt.db, tt.storage, log).ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))

			if rec.Code != tt.wantCode {
				t.Fatalf("code = %d, want %d", rec.Code, tt.wantCode)
			}
			var got healthResponse
			if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if got.Status != tt.wantStatus {
				t.Errorf("status = %q, want %q", got.Status, tt.wantStatus)
			}
			for k, want := range tt.wantChecks {
				if got.Checks[k] != want {
					t.Errorf("checks[%s] = %q, want %q", k, got.Checks[k], want)
				}
			}
		})
	}
}

func TestHealthRejectsPost(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	rec := httptest.NewRecorder()
	New(fakePinger{}, fakePinger{}, log).ServeHTTP(rec, httptest.NewRequest("POST", "/api/health", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("code = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
