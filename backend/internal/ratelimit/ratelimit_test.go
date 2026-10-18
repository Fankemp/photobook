package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestBucket(t *testing.T) {
	l := New(10, time.Hour, 3) // 10 в час, подряд — 3
	clock := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	l.now = func() time.Time { return clock }

	for i := range 3 {
		if !l.Allow("1.2.3.4") {
			t.Fatalf("request %d within the burst was refused", i+1)
		}
	}
	if l.Allow("1.2.3.4") {
		t.Fatal("4th request in a row passed, burst is 3")
	}
	if !l.Allow("5.6.7.8") {
		t.Fatal("another address must have its own bucket")
	}
	clock = clock.Add(6 * time.Minute) // 10 в час — жетон раз в 6 минут
	if !l.Allow("1.2.3.4") {
		t.Fatal("a token must come back after 6 minutes")
	}
	if !l.Blocked("1.2.3.4") {
		t.Fatal("Blocked must report an empty bucket")
	}
}

func TestClientIP(t *testing.T) {
	for _, tt := range []struct {
		remote, xff, want string
	}{
		{"203.0.113.5:4000", "", "203.0.113.5"},
		{"203.0.113.5:4000", "198.51.100.1", "203.0.113.5"},          // клиент сам прислал заголовок — не верим
		{"172.18.0.3:4000", "198.51.100.1", "198.51.100.1"},          // от Caddy в Docker-сети — верим
		{"127.0.0.1:4000", "10.0.0.9, 198.51.100.2", "198.51.100.2"}, // берём то, что дописал наш прокси
		{"172.18.0.3:4000", "", "172.18.0.3"},
	} {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = tt.remote
		if tt.xff != "" {
			r.Header.Set("X-Forwarded-For", tt.xff)
		}
		if got := ClientIP(r).String(); got != tt.want {
			t.Errorf("remote %s, xff %q: got %s, want %s", tt.remote, tt.xff, got, tt.want)
		}
	}
}

func TestMiddleware(t *testing.T) {
	l := New(1, time.Hour, 2)
	h := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	call := func(remote, xff string) int {
		r := httptest.NewRequest(http.MethodPost, "/api/books", nil)
		r.RemoteAddr = remote
		r.Header.Set("X-Forwarded-For", xff)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	codes := []int{call("172.18.0.3:1", "198.51.100.7"), call("172.18.0.3:1", "198.51.100.7"), call("172.18.0.3:1", "198.51.100.7")}
	if codes[0] != 200 || codes[1] != 200 || codes[2] != http.StatusTooManyRequests {
		t.Fatalf("codes = %v, want 200 200 429", codes)
	}
	for range 5 {
		if code := call("127.0.0.1:1", ""); code != 200 {
			t.Fatalf("local requests are not limited, got %d", code)
		}
	}
}
