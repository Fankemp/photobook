// Package ratelimit — ограничение частоты запросов с одного адреса: чтобы
// нельзя было засыпать сервис книгами, загрузками и особенно заявками
// (каждая заявка — сообщение в Telegram).
//
// На каждый IP — своё «ведро жетонов» (golang.org/x/time/rate): запрос берёт
// жетон, жетоны понемногу пополняются; пусто — ответ 429. Локальные и
// внутренние адреса (разработка, тесты, make share через Vite) не ограничиваются:
// в боевом режиме запросы приходят через Caddy с настоящим адресом клиента.
package ratelimit

import (
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Limiter — ведра жетонов по ключу (обычно IP).
type Limiter struct {
	every time.Duration // как часто добавляется один жетон
	burst int           // сколько жетонов помещается в ведро (запросов подряд)

	mu      sync.Mutex
	buckets map[string]*bucket
	now     func() time.Time // подменяется в тестах
}

type bucket struct {
	lim  *rate.Limiter
	seen time.Time
}

// New: в среднем perPeriod запросов за period, подряд — до burst.
func New(perPeriod int, period time.Duration, burst int) *Limiter {
	return &Limiter{every: period / time.Duration(perPeriod), burst: burst, buckets: map[string]*bucket{}, now: time.Now}
}

func (l *Limiter) get(key string) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b, ok := l.buckets[key]
	if !ok {
		// Заодно выбрасываем давно не виденные адреса, чтобы карта не росла.
		if len(l.buckets) > 10_000 {
			for k, old := range l.buckets {
				if now.Sub(old.seen) > time.Hour {
					delete(l.buckets, k)
				}
			}
		}
		b = &bucket{lim: rate.NewLimiter(rate.Every(l.every), l.burst)}
		l.buckets[key] = b
	}
	b.seen = now
	return b.lim
}

// Allow — можно ли выполнить запрос (и взять жетон).
func (l *Limiter) Allow(key string) bool {
	return l.get(key).AllowN(l.now(), 1)
}

// Blocked — жетонов нет (не тратит жетон): для «слишком много неудачных попыток».
func (l *Limiter) Blocked(key string) bool {
	return l.get(key).TokensAt(l.now()) < 1
}

// RetryAfter — через сколько секунд появится жетон (для заголовка Retry-After).
func (l *Limiter) RetryAfter() int {
	return max(1, int(l.every.Seconds()+0.999))
}

// ClientIP — адрес клиента. Если запрос пришёл от своего прокси (локальный
// или внутренний адрес — Caddy, Vite), берём последний адрес из X-Forwarded-For:
// его дописал наш прокси, клиент подделать его не может (прокси перезаписывает
// чужой заголовок). Иначе — адрес соединения.
func ClientIP(r *http.Request) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remote, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	remote = remote.Unmap()
	if internal(remote) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if ip, err := netip.ParseAddr(strings.TrimSpace(parts[len(parts)-1])); err == nil {
				return ip.Unmap()
			}
		}
	}
	return remote
}

// internal — локальный или внутренний адрес: такие запросы не ограничиваем.
func internal(ip netip.Addr) bool {
	return !ip.IsValid() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

// Middleware — ограничить обработчик: при превышении 429 {"error":"too_many_requests"}.
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := ClientIP(r)
		if !internal(ip) && !l.Allow(ip.String()) {
			TooMany(w, l.RetryAfter())
			return
		}
		next.ServeHTTP(w, r)
	})
}

// TooMany — ответ 429 в формате ошибок API.
func TooMany(w http.ResponseWriter, retryAfter int) {
	w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(`{"error":"too_many_requests"}`))
}

// Internal — не ограничивать ли этот адрес (для своих проверок, например в админке).
func Internal(ip netip.Addr) bool { return internal(ip) }
