package render

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"
)

// Печатную страницу (/print/…) открывает Chromium сервиса рендера, и ей нужны
// оригиналы фото. Чтобы их не мог получить кто угодно, ссылка подписана:
// HMAC от id заявки и срока действия. Секрет знает только backend.

// PrintSubject — что подписывает ссылка: заявка и версия (снимок), которую печатаем.
func PrintSubject(orderID string, version int) string {
	return orderID + "/v" + strconv.Itoa(version)
}

// Signer подписывает и проверяет ссылки на печатную страницу.
type Signer struct {
	secret []byte
}

func NewSigner(secret []byte) *Signer {
	return &Signer{secret: secret}
}

func (s *Signer) sign(orderID string, exp int64) string {
	mac := hmac.New(sha256.New, s.secret)
	fmt.Fprintf(mac, "%s|%d", orderID, exp)
	return hex.EncodeToString(mac.Sum(nil))
}

// Link — параметры подписи: срок действия (unix-время) и подпись.
func (s *Signer) Link(orderID string, ttl time.Duration, now time.Time) (exp, sig string) {
	e := now.Add(ttl).Unix()
	return strconv.FormatInt(e, 10), s.sign(orderID, e)
}

// Verify — подпись верна и срок не истёк. Сравнение за постоянное время.
func (s *Signer) Verify(orderID, exp, sig string, now time.Time) bool {
	e, err := strconv.ParseInt(exp, 10, 64)
	if err != nil || now.Unix() > e {
		return false
	}
	return hmac.Equal([]byte(sig), []byte(s.sign(orderID, e)))
}
