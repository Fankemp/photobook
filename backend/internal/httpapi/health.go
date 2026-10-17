package httpapi

import (
	"context"
	"net/http"
	"time"
)

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
	for name, p := range map[string]Pinger{"db": a.DB, "storage": a.Storage} {
		if err := p.Ping(ctx); err != nil {
			a.Log.Error("health check failed", "check", name, "err", err)
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
