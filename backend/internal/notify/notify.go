// Package notify — отправка уведомлений нам (команде) в Telegram.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// Sender отправляет текст сообщения (HTML-разметка Telegram).
type Sender interface {
	Send(ctx context.Context, html string) error
}

// Telegram — бот, который пишет в наш чат или группу.
// Токен выдаёт @BotFather, chat id — см. README («Telegram»).
type Telegram struct {
	Token  string
	ChatID string
	APIURL string // по умолчанию https://api.telegram.org; в тестах — подменный сервер
	Client *http.Client
}

func (t Telegram) Send(ctx context.Context, html string) error {
	api := t.APIURL
	if api == "" {
		api = "https://api.telegram.org"
	}
	client := t.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	body, _ := json.Marshal(map[string]any{
		"chat_id":                  t.ChatID,
		"text":                     html,
		"parse_mode":               "HTML",
		"disable_web_page_preview": true,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, api+"/bot"+t.Token+"/sendMessage", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		// В ошибке клиента есть URL с токеном бота — в лог его не пускаем.
		return fmt.Errorf("telegram: request failed")
	}
	defer resp.Body.Close()

	var res struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&res)
	if resp.StatusCode != http.StatusOK || !res.OK {
		return fmt.Errorf("telegram: HTTP %d: %s", resp.StatusCode, res.Description)
	}
	return nil
}

// LogSender — для разработки без бота: сообщение просто пишется в лог.
type LogSender struct {
	Log *slog.Logger
}

func (l LogSender) Send(_ context.Context, html string) error {
	l.Log.Info("telegram disabled, message would be", "text", html)
	return nil
}
