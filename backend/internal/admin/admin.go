// Package admin — простая админка для команды: список заявок, смена статуса,
// скачивание печатного PDF. Обычные HTML-страницы (html/template) под паролем
// (HTTP Basic Auth), без JavaScript: формы отправляются браузером как есть.
package admin

import (
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"time"

	"photobook/internal/orders"
	"photobook/internal/storage"
)

//go:embed templates/*.html
var templatesFS embed.FS

type Config struct {
	User     string
	Password string
}

type Deps struct {
	Orders       *orders.Service
	Storage      *storage.Storage
	TemplateName func(id string) string
	RenderWake   func() // разбудить сборку PDF (после «Пересобрать»)
	Log          *slog.Logger
}

type handler struct {
	Deps
	cfg   Config
	pages map[string]*template.Template
}

// New собирает админку по адресам /admin/…
func New(cfg Config, d Deps) http.Handler {
	h := &handler{Deps: d, cfg: cfg, pages: parsePages()}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin/{$}", h.list)
	mux.HandleFunc("GET /admin/orders/{number}", h.detail)
	mux.HandleFunc("POST /admin/orders/{number}/status", h.changeStatus)
	mux.HandleFunc("GET /admin/orders/{number}/pdf/{part}", h.pdf)
	mux.HandleFunc("POST /admin/orders/{number}/render", h.rerender)

	// Защита от подделки запросов (CSRF): браузер сам подставляет пароль Basic Auth
	// в любой запрос к нашему адресу, даже со стороннего сайта. CrossOriginProtection
	// отклоняет POST, пришедшие не с наших страниц (по заголовку Sec-Fetch-Site).
	var csrf http.CrossOriginProtection
	return h.auth(csrf.Handler(mux))
}

// parsePages разбирает шаблоны страниц: каждая страница = layout.html + свой файл.
// Ошибка в шаблоне — паника при старте сервера (и в тесте), а не у команды в браузере.
func parsePages() map[string]*template.Template {
	pages := map[string]*template.Template{}
	for _, name := range []string{"list", "detail"} {
		pages[name] = template.Must(template.New("layout.html").Funcs(funcs).
			ParseFS(templatesFS, "templates/layout.html", "templates/"+name+".html"))
	}
	return pages
}

// auth — пароль через HTTP Basic Auth: браузер сам покажет окно ввода и запомнит его.
// Сравнение — за постоянное время (по хешам), чтобы по скорости ответа нельзя
// было подбирать пароль посимвольно.
func (h *handler) auth(next http.Handler) http.Handler {
	wantUser := sha256.Sum256([]byte(h.cfg.User))
	wantPass := sha256.Sum256([]byte(h.cfg.Password))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		u := sha256.Sum256([]byte(user))
		p := sha256.Sum256([]byte(pass))
		if !ok || subtle.ConstantTimeCompare(u[:], wantUser[:])&subtle.ConstantTimeCompare(p[:], wantPass[:]) != 1 {
			if ok {
				time.Sleep(500 * time.Millisecond) // неверный пароль — отвечаем медленно, подбор дорожает
			}
			w.Header().Set("WWW-Authenticate", `Basic realm="Photobook admin", charset="UTF-8"`)
			http.Error(w, "Нужен пароль администратора", http.StatusUnauthorized)
			return
		}
		// Тут телефоны и адреса клиентов: не кэшировать и не индексировать.
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Robots-Tag", "noindex")
		next.ServeHTTP(w, r)
	})
}

type filter struct {
	Value  string
	Label  string
	Count  int
	Active bool
}

func (h *handler) list(w http.ResponseWriter, r *http.Request) {
	current := r.URL.Query().Get("status")
	if current == "" {
		current = "active"
	}
	var statuses []string
	switch {
	case current == "active":
		statuses = orders.Active
	case current == "all":
		statuses = nil
	case slices.Contains(orders.Statuses, current):
		statuses = []string{current}
	default:
		http.Error(w, "Неизвестный фильтр", http.StatusBadRequest)
		return
	}

	counts, err := h.Orders.Counts(r.Context())
	if err != nil {
		h.fail(w, err)
		return
	}
	activeCount, allCount := 0, 0
	for st, n := range counts {
		allCount += n
		if slices.Contains(orders.Active, st) {
			activeCount += n
		}
	}
	filters := []filter{{Value: "active", Label: "В работе", Count: activeCount}}
	for _, st := range orders.Statuses {
		filters = append(filters, filter{Value: st, Label: statusNames[st], Count: counts[st]})
	}
	filters = append(filters, filter{Value: "all", Label: "Все", Count: allCount})
	for i := range filters {
		filters[i].Active = filters[i].Value == current
	}

	list, err := h.Orders.List(r.Context(), statuses, 200)
	if err != nil {
		h.fail(w, err)
		return
	}
	h.render(w, "list", map[string]any{"Filters": filters, "Orders": list})
}

func (h *handler) detail(w http.ResponseWriter, r *http.Request) {
	d, ok := h.order(w, r)
	if !ok {
		return
	}
	h.render(w, "detail", map[string]any{
		"O":            d,
		"Template":     h.TemplateName(d.TemplateID),
		"Next":         orders.NextStatus[d.Status],
		"Statuses":     orders.Statuses,
		"Saved":        r.URL.Query().Has("saved"),
		"Rerender":     r.URL.Query().Has("rerender"),
		"Error":        r.URL.Query().Get("error"),
		"WhatsAppLink": "https://wa.me/" + d.Phone[1:], // +77001234567 → 77001234567
	})
}

// changeStatus — после POST перенаправляем на страницу заявки (POST→redirect→GET),
// чтобы обновление страницы не отправило форму второй раз.
func (h *handler) changeStatus(w http.ResponseWriter, r *http.Request) {
	number, err := strconv.ParseInt(r.PathValue("number"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	back := fmt.Sprintf("/admin/orders/%d", number)
	err = h.Orders.ChangeStatus(r.Context(), number, r.FormValue("status"), r.FormValue("note"))
	switch {
	case errors.Is(err, orders.ErrNotFound):
		http.NotFound(w, r)
	case errors.Is(err, orders.ErrBadStatus):
		http.Redirect(w, r, back+"?error="+url.QueryEscape("Выберите статус."), http.StatusSeeOther)
	case errors.Is(err, orders.ErrBadNote):
		http.Redirect(w, r, back+"?error="+url.QueryEscape("Заметка длиннее 500 символов."), http.StatusSeeOther)
	case errors.Is(err, orders.ErrAlreadyOrdered):
		http.Redirect(w, r, back+"?error="+url.QueryEscape("По этой книге уже есть другая действующая заявка."), http.StatusSeeOther)
	case err != nil:
		h.fail(w, err)
	default:
		h.Log.Info("order status changed", "number", number, "status", r.FormValue("status"))
		http.Redirect(w, r, back+"?saved", http.StatusSeeOther)
	}
}

// pdf отдаёт печатный PDF (cover — обложка, block — страницы) через временную
// ссылку в хранилище. Имя файла при скачивании: photobook-1001-cover.pdf.
func (h *handler) pdf(w http.ResponseWriter, r *http.Request) {
	d, ok := h.order(w, r)
	if !ok {
		return
	}
	part := r.PathValue("part")
	key := map[string]string{"cover": d.CoverPDFKey, "block": d.BlockPDFKey}[part]
	if key == "" {
		http.Error(w, "PDF для этой заявки ещё не собран", http.StatusNotFound)
		return
	}
	link, err := h.Storage.PresignDownload(r.Context(), key, fmt.Sprintf("photobook-%d-%s.pdf", d.Number, part), 15*time.Minute)
	if err != nil {
		h.fail(w, err)
		return
	}
	http.Redirect(w, r, link, http.StatusFound)
}

// rerender — собрать PDF заново (после правок шаблона, рендера или по просьбе типографии).
func (h *handler) rerender(w http.ResponseWriter, r *http.Request) {
	number, err := strconv.ParseInt(r.PathValue("number"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if err := h.Orders.ResetRender(r.Context(), number); errors.Is(err, orders.ErrNotFound) {
		http.NotFound(w, r)
		return
	} else if err != nil {
		h.fail(w, err)
		return
	}
	if h.RenderWake != nil {
		h.RenderWake()
	}
	http.Redirect(w, r, fmt.Sprintf("/admin/orders/%d?rerender", number), http.StatusSeeOther)
}

func (h *handler) order(w http.ResponseWriter, r *http.Request) (orders.Detail, bool) {
	number, err := strconv.ParseInt(r.PathValue("number"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return orders.Detail{}, false
	}
	d, err := h.Orders.GetByNumber(r.Context(), number)
	if errors.Is(err, orders.ErrNotFound) {
		http.NotFound(w, r)
		return orders.Detail{}, false
	}
	if err != nil {
		h.fail(w, err)
		return orders.Detail{}, false
	}
	return d, true
}

func (h *handler) render(w http.ResponseWriter, page string, data map[string]any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := h.pages[page].Execute(w, data); err != nil {
		h.Log.Error("admin render failed", "page", page, "err", err)
	}
}

func (h *handler) fail(w http.ResponseWriter, err error) {
	h.Log.Error("admin request failed", "err", err)
	http.Error(w, "Внутренняя ошибка, подробности в логе", http.StatusInternalServerError)
}

// Названия статусов для команды (клиент видит свои формулировки во фронтенде).
var statusNames = map[string]string{
	"new":                 "Новая",
	"awaiting_prepayment": "Ждём аванс",
	"paid":                "Аванс получен",
	"printing":            "Печать",
	"delivery":            "Доставка",
	"done":                "Выполнена",
	"cancelled":           "Отменена",
}

var funcs = template.FuncMap{
	"statusName": func(s string) string { return statusNames[s] },
	"phone":      orders.FormatPhone,
	"tenge":      orders.FormatTenge,
	// Даты — по времени Алматы. Принимает и time.Time, и *time.Time (пустое — прочерк).
	"datetime": func(v any) string {
		switch t := v.(type) {
		case time.Time:
			return t.In(orders.Almaty).Format("02.01.2006 15:04")
		case *time.Time:
			if t != nil {
				return t.In(orders.Almaty).Format("02.01.2006 15:04")
			}
		}
		return "—"
	},
	"date": func(iso string) string {
		d, err := time.Parse("2006-01-02", iso)
		if err != nil {
			return iso
		}
		return d.Format("02.01.2006")
	},
}
