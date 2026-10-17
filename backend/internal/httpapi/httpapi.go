// Package httpapi — HTTP-слой: роуты, разбор запросов, JSON-ответы.
// Бизнес-логика живёт в пакетах модулей (books, templates, ...).
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"photobook/internal/assets"
	"photobook/internal/books"
	"photobook/internal/fonts"
	"photobook/internal/formats"
	"photobook/internal/templates"
)

// Pinger — всё, что умеет сказать «я жив»: база, хранилище.
type Pinger interface {
	Ping(ctx context.Context) error
}

type Deps struct {
	DB        Pinger
	Storage   Pinger
	Formats   *formats.Store
	Fonts     *fonts.Registry
	Templates *templates.Catalog
	Books     *books.Store
	Assets    *assets.Service
	Log       *slog.Logger
}

type API struct {
	Deps
}

func New(d Deps) http.Handler {
	a := &API{Deps: d}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/templates", a.listTemplates)
	mux.HandleFunc("GET /api/templates/{id}", a.getTemplate)
	mux.HandleFunc("POST /api/books", a.createBook)
	mux.HandleFunc("GET /api/books/{token}", a.getBook)
	mux.HandleFunc("PUT /api/books/{token}", a.saveBook)
	mux.HandleFunc("POST /api/books/{token}/assets", a.startUpload)
	mux.HandleFunc("POST /api/books/{token}/assets/{id}/complete", a.completeUpload)
	mux.HandleFunc("GET /api/books/{token}/assets/{id}/image", a.assetImage)
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError отвечает кодом ошибки, например {"error":"book_not_found"}.
// Текст для человека подбирает фронтенд по этому коду (из словаря).
func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

// internalError пишет подробности в лог, а клиенту — только общий код.
func (a *API) internalError(w http.ResponseWriter, r *http.Request, err error) {
	a.Log.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "internal")
}

// readJSON разбирает тело запроса не больше 1 МБ и без неизвестных полей.
func readJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}
