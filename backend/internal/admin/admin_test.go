package admin

import (
	"html"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"photobook/internal/orders"
)

func testHandler() http.Handler {
	return New(Config{User: "admin", Password: "secret"}, Deps{
		TemplateName: func(id string) string { return id },
		Log:          slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

func TestAuthRequired(t *testing.T) {
	h := testHandler()
	for name, set := range map[string]func(*http.Request){
		"no password":    func(*http.Request) {},
		"wrong password": func(r *http.Request) { r.SetBasicAuth("admin", "guess") },
		"wrong user":     func(r *http.Request) { r.SetBasicAuth("root", "secret") },
	} {
		t.Run(name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/admin/", nil)
			set(r)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != http.StatusUnauthorized || !strings.HasPrefix(w.Header().Get("WWW-Authenticate"), "Basic") {
				t.Fatalf("code = %d, want 401 with a Basic challenge", w.Code)
			}
		})
	}
}

// POST со стороннего сайта отклоняется, даже если браузер подставил пароль.
func TestCrossSitePostRejected(t *testing.T) {
	r := httptest.NewRequest("POST", "/admin/orders/1001/status", strings.NewReader("status=cancelled"))
	r.SetBasicAuth("admin", "secret")
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	testHandler().ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("code = %d, want 403", w.Code)
	}
}

// Шаблоны отрисовываются на реальных данных: ошибка в шаблоне ловится здесь.
func TestTemplatesRender(t *testing.T) {
	pages := parsePages()
	sent := time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC) // 14:00 по Алматы
	base := orders.Detail{
		Row: orders.Row{Order: orders.Order{
			Number: 1001, Name: "Айгерим <b>", Phone: "+77001234567", Address: "Алматы", WantedDate: "2026-10-20",
			Comment: "после 18:00", Status: "new", CreatedAt: sent,
		}, BookToken: "TOKEN", TemplateID: "travel-minimal", Pages: 18},
		Events: []orders.Event{{Status: "new", Note: "заявка с сайта", CreatedAt: sent}},
	}
	notified := base
	notified.NotifiedAt = &sent
	failed := base
	failed.NotifyError = "telegram: HTTP 400: chat not found"

	for name, tt := range map[string]struct {
		d    orders.Detail
		want string
	}{
		"in queue": {base, "в очереди"},
		"sent":     {notified, "сообщение отправлено 17.10.2026 14:00"},
		"failed":   {failed, "не отправлено: telegram: HTTP 400: chat not found"},
	} {
		t.Run(name, func(t *testing.T) {
			var sb strings.Builder
			err := pages["detail"].Execute(&sb, map[string]any{
				"O": tt.d, "Template": "Путешествие", "Next": "awaiting_prepayment", "Statuses": orders.Statuses,
				"WhatsAppLink": "https://wa.me/77001234567",
			})
			if err != nil {
				t.Fatal(err)
			}
			raw := sb.String()
			if !strings.Contains(raw, "Айгерим &lt;b&gt;") {
				t.Error("client name is not escaped")
			}
			// Остальное — как увидит человек (html/template пишет «+» как &#43;).
			text := html.UnescapeString(raw)
			for _, want := range []string{"Заявка №1001", "+7 700 123 45 67", "20.10.2026", "Следующий шаг: Ждём аванс", "18 и обложки", tt.want} {
				if !strings.Contains(text, want) {
					t.Errorf("detail page lacks %q", want)
				}
			}
		})
	}

	var sb strings.Builder
	err := pages["list"].Execute(&sb, map[string]any{
		"Filters": []filter{{Value: "active", Label: "В работе", Count: 1, Active: true}},
		"Orders":  []orders.Row{base.Row},
	})
	listText := html.UnescapeString(sb.String())
	if err != nil || !strings.Contains(listText, "№1001") || !strings.Contains(listText, "+7 700 123 45 67 · 18 стр. · нужна к 20.10.2026") {
		t.Fatalf("list page: err=%v\n%s", err, sb.String())
	}
}
