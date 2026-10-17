// Package httpapi — HTTP-роуты сервиса.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// Pinger — всё, что умеет сказать «я жив»: база, хранилище.
type Pinger interface {
	Ping(ctx context.Context) error
}

type API struct {
	db      Pinger
	storage Pinger
	log     *slog.Logger
}

func New(db, storage Pinger, log *slog.Logger) http.Handler {
	a := &API{db: db, storage: storage, log: log}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	return mux
}

type healthResponse struct {
	Status string            `json:"status"` // "ok" или "error"
	Checks map[string]string `json:"checks"`
}

// health проверяет зависимости. Ответ 200, если всё работает, иначе 503.
// Текст ошибки только в логах: эндпоинт публичный.
func (a *API) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	resp := healthResponse{Status: "ok", Checks: map[string]string{}}
	for name, p := range map[string]Pinger{"db": a.db, "storage": a.storage} {
		if err := p.Ping(ctx); err != nil {
			a.log.Error("health check failed", "check", name, "err", err)
			resp.Checks[name] = "error"
			resp.Status = "error"
			continue
		}
		resp.Checks[name] = "ok"
	}

	code := http.StatusOK
	if resp.Status != "ok" {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, resp)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
