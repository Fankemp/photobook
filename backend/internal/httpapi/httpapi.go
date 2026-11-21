// Package httpapi — HTTP-слой: роуты, разбор запросов, JSON-ответы.
// Бизнес-логика живёт в пакетах модулей (books, templates, ...).
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"photobook/internal/assets"
	"photobook/internal/books"
	"photobook/internal/formats"
	"photobook/internal/orders"
	"photobook/internal/pages"
	"photobook/internal/ratelimit"
	"photobook/internal/render"
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
	Library   pages.Library // шрифты и стикеры — для проверки страниц
	Templates *templates.Catalog
	Books     *books.Store
	Assets    *assets.Service
	Orders    *orders.Service
	Admin     http.Handler   // nil — админка выключена (не задан пароль)
	Signer    *render.Signer // подпись ссылок на печатную страницу
	Log       *slog.Logger
}

type API struct {
	Deps
}

func New(d Deps) http.Handler {
	a := &API{Deps: d}

	// Сколько запросов можно с одного адреса (см. internal/ratelimit) — с запасом
	// для живого человека: книгу создают раз-два, фото грузят пачками до сотни,
	// автосохранение — не чаще раза в 1,5 с, заявка на книгу одна.
	var (
		books   = ratelimit.New(20, time.Hour, 10)
		uploads = ratelimit.New(600, time.Hour, 100)
		saves   = ratelimit.New(120, time.Minute, 60)
		orders  = ratelimit.New(5, time.Hour, 3) // каждая заявка — сообщение в Telegram
		all     = ratelimit.New(1200, time.Minute, 300)
	)
	limit := func(l *ratelimit.Limiter, h http.HandlerFunc) http.Handler { return l.Middleware(h) }

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/templates", a.listTemplates)
	mux.HandleFunc("GET /api/templates/{id}", a.getTemplate)
	mux.Handle("POST /api/books", limit(books, a.createBook))
	mux.HandleFunc("GET /api/books/{token}", a.getBook)
	mux.Handle("PUT /api/books/{token}", limit(saves, a.saveBook))
	mux.Handle("POST /api/books/{token}/assets", limit(uploads, a.startUpload))
	mux.Handle("POST /api/books/{token}/assets/{id}/complete", limit(uploads, a.completeUpload))
	mux.HandleFunc("GET /api/books/{token}/assets/{id}/image", a.assetImage)
	mux.HandleFunc("GET /api/books/{token}/assets", a.listAssets)
	mux.Handle("DELETE /api/books/{token}/assets/{id}", limit(saves, a.removeAsset))
	mux.Handle("POST /api/books/{token}/assets/{id}/restore", limit(saves, a.restoreAsset))
	mux.HandleFunc("GET /api/books/{token}/order", a.getOrder)
	mux.Handle("POST /api/books/{token}/order", limit(orders, a.createOrder))
	mux.HandleFunc("GET /api/print/{order}", a.printData)
	if d.Admin != nil {
		mux.Handle("/admin/", d.Admin)
		mux.Handle("GET /admin", http.RedirectHandler("/admin/", http.StatusMovedPermanently))
	}
	return secureHeaders(all.Middleware(mux))
}

// secureHeaders — заголовки безопасности для всех ответов API и админки:
// браузер не угадывает тип содержимого, страницы нельзя встроить в чужой
// сайт (кликджекинг), в Referer уходит только наш адрес.
func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
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
// Запрос, который отменил сам клиент (ушёл со страницы), — не ошибка сервера.
func (a *API) internalError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
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
