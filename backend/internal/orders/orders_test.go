package orders

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"photobook/internal/notify"
)

func TestNormalizePhone(t *testing.T) {
	for in, want := range map[string]string{
		"+7 700 123 45 67":   "+77001234567",
		"8 (700) 123-45-67":  "+77001234567",
		"87001234567":        "+77001234567",
		"77001234567":        "+77001234567",
		"+7(727)2501010":     "+77272501010",
		"700 123 45 67":      "", // без кода страны — неоднозначно
		"+1 202 555 0100":    "",
		"+7 700 123 45 67 8": "",
		"+7 700 abc":         "",
		"":                   "",
	} {
		got, ok := NormalizePhone(in)
		if (want == "") == ok || got != want {
			t.Errorf("NormalizePhone(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
}

func TestValidate(t *testing.T) {
	s := &Service{minLeadDays: 3}
	// 17 октября 2026, 23:30 в Алматы — ещё 17-е, хотя по UTC уже вечер.
	now := time.Date(2026, 10, 17, 23, 30, 0, 0, Almaty)
	ok := Input{Name: " Айгерим ", Phone: "8 700 123 45 67", Address: "Алматы, Абая 10, кв. 5", WantedDate: "2026-10-20", Confirmed: true}

	got, err := s.Validate(ok, now)
	if err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
	if got.Name != "Айгерим" || got.Phone != "+77001234567" {
		t.Errorf("not normalized: %+v", got)
	}

	for name, tt := range map[string]struct {
		mutate func(*Input)
		code   string
	}{
		"empty name":        {func(i *Input) { i.Name = "  " }, "invalid_name"},
		"bad phone":         {func(i *Input) { i.Phone = "12345" }, "invalid_phone"},
		"short address":     {func(i *Input) { i.Address = "дом" }, "invalid_address"},
		"too early":         {func(i *Input) { i.WantedDate = "2026-10-19" }, "invalid_date"},
		"not a date":        {func(i *Input) { i.WantedDate = "20.10.2026" }, "invalid_date"},
		"more than a year":  {func(i *Input) { i.WantedDate = "2027-11-01" }, "invalid_date"},
		"very long comment": {func(i *Input) { i.Comment = strings.Repeat("я", 1001) }, "invalid_comment"},
		"no confirmation":   {func(i *Input) { i.Confirmed = false }, "not_confirmed"}, // галочка «проверил(а)» обязательна
	} {
		t.Run(name, func(t *testing.T) {
			in := ok
			tt.mutate(&in)
			_, err := s.Validate(in, now)
			var ve ValidationError
			if !errors.As(err, &ve) || ve.Code != tt.code {
				t.Fatalf("error = %v, want %s", err, tt.code)
			}
		})
	}
}

func TestNewOrderMessage(t *testing.T) {
	msg := NewOrderMessage(Message{
		Number: 1001, Name: "<b>Хакер</b> & Ко", Phone: "+77001234567", Address: "Алматы",
		WantedDate: time.Date(2026, 10, 25, 0, 0, 0, 0, Almaty), PriceKZT: 15000,
		TemplateName: "Путешествие", FormatName: "Квадрат 20×20 см", Pages: 20,
		BookToken: "ABC", BaseURL: "https://example.kz/",
	})
	for _, want := range []string{
		"<b>Новая заявка №1001</b>",
		"Имя: &lt;b&gt;Хакер&lt;/b&gt; &amp; Ко", // то, что ввёл клиент, экранировано
		"Телефон: +7 700 123 45 67",
		"Желаемая дата: 25.10.2026",
		"Книга: Путешествие, Квадрат 20×20 см, 20 стр.",
		"Сумма: 15\u00a0000\u00a0₸",
		`<a href="https://example.kz/b/ABC/preview">`,
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("message lacks %q:\n%s", want, msg)
		}
	}
	if strings.Contains(msg, "Комментарий") {
		t.Error("empty comment should be omitted")
	}
}

func TestTelegramSend(t *testing.T) {
	var got map[string]any
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&got)
		if got["chat_id"] == "bad" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"ok":false,"description":"Bad Request: chat not found"}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	tg := notify.Telegram{Token: "123:abc", ChatID: "-100500", APIURL: srv.URL}
	if err := tg.Send(context.Background(), "<b>hi</b>"); err != nil {
		t.Fatal(err)
	}
	if path != "/bot123:abc/sendMessage" || got["chat_id"] != "-100500" || got["parse_mode"] != "HTML" || got["text"] != "<b>hi</b>" {
		t.Errorf("unexpected request: %s %v", path, got)
	}

	tg.ChatID = "bad"
	err := tg.Send(context.Background(), "x")
	if err == nil || !strings.Contains(err.Error(), "chat not found") {
		t.Fatalf("error = %v, want Telegram's description", err)
	}
	if strings.Contains(err.Error(), "123:abc") {
		t.Fatal("bot token leaked into the error")
	}
}

func TestBookChangedMessage(t *testing.T) {
	msg := BookChangedMessage(1042, 7, "https://sakta.kz/")
	for _, want := range []string{"Клиент изменил книгу в заказе №1042", "Версия книги 7", `href="https://sakta.kz/admin/orders/1042"`} {
		if !strings.Contains(msg, want) {
			t.Errorf("message has no %q:\n%s", want, msg)
		}
	}
}

func TestPDFCurrent(t *testing.T) {
	now := time.Now()
	v := func(n int) *int { return &n }
	for _, tt := range []struct {
		name string
		row  Row
		want bool
	}{
		{"built from the current book", Row{BookVersionNow: 5, PDFBookVersion: v(5), RenderedAt: &now}, true},
		{"book changed after the build", Row{BookVersionNow: 6, PDFBookVersion: v(5), RenderedAt: &now}, false},
		{"rebuild requested", Row{BookVersionNow: 5, PDFBookVersion: v(5)}, false},
		{"never built", Row{BookVersionNow: 5}, false},
	} {
		if got := tt.row.PDFCurrent(); got != tt.want {
			t.Errorf("%s: PDFCurrent = %v, want %v", tt.name, got, tt.want)
		}
	}
}
