// Package config читает настройки сервиса из переменных окружения.
// Секреты (пароли, ключи) приходят только отсюда, в коде их нет.
package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr       string
	DatabaseURL    string
	TemplatesDir   string
	Production     bool   // APP_ENV=production: строгие проверки паролей при запуске
	FontsConfig    string // fonts.json — общий конфиг шрифтов с фронтендом
	StickersConfig string // stickers.json — общий конфиг стикеров с фронтендом
	// Адреса сайта, с которых браузер может загружать файлы прямо в хранилище (CORS).
	AppOrigins []string
	// Адрес сайта для ссылок в уведомлениях («Превью книги» в Telegram).
	AppBaseURL string
	// За сколько дней минимум можно выбрать желаемую дату (время на печать).
	OrderMinLeadDays int
	Telegram         TelegramConfig
	// Админка: вход по логину и паролю (HTTP Basic Auth). Пустой пароль — админка выключена.
	AdminUser     string
	AdminPassword string
	Render        RenderConfig
	S3            S3Config
}

// RenderConfig — сборка печатных PDF. Пустой RENDER_URL — сборка выключена
// (например, при локальном go run без сервиса рендера).
type RenderConfig struct {
	ServiceURL   string // RENDER_URL, например http://render:3000
	PrintBaseURL string // PRINT_BASE_URL: адрес сайта для сервиса рендера, например http://frontend:5173
	CMYK         bool   // PDF_CMYK=true — перевести PDF в CMYK через Ghostscript
}

// TelegramConfig — бот для уведомлений о заявках. Пустой токен — бот выключен,
// сообщения пишутся в лог (удобно при разработке).
type TelegramConfig struct {
	Token  string
	ChatID string
	APIURL string
}

// S3Config — любое S3-совместимое хранилище (локально RustFS).
type S3Config struct {
	Endpoint  string // host:port без схемы, как его видит backend, например "s3:9000"
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
	Region    string

	// Адрес хранилища, как его видит браузер клиента. На него указывают
	// presigned-ссылки для загрузки и просмотра фото. В Docker отличается
	// от Endpoint: backend ходит в "s3:9000", а браузер — в "localhost:9000".
	PublicEndpoint string
	PublicUseSSL   bool
}

func Load() (Config, error) {
	var missing []string
	required := func(key string) string {
		v := os.Getenv(key)
		if v == "" {
			missing = append(missing, key)
		}
		return v
	}

	cfg := Config{
		HTTPAddr:    getenv("HTTP_ADDR", ":8080"),
		DatabaseURL: required("DATABASE_URL"),
		// По умолчанию — папка templates/ в корне репозитория (для go run из backend/).
		TemplatesDir:   getenv("TEMPLATES_DIR", "../templates"),
		FontsConfig:    getenv("FONTS_CONFIG", "../frontend/src/book/fonts.json"),
		StickersConfig: getenv("STICKERS_CONFIG", "../frontend/src/book/stickers.json"),
		AppOrigins:     strings.Split(getenv("APP_ORIGINS", "http://localhost:5173"), ","),
		AppBaseURL:     getenv("APP_BASE_URL", "http://localhost:5173"),
		AdminUser:      getenv("ADMIN_USER", "admin"),
		AdminPassword:  os.Getenv("ADMIN_PASSWORD"),
		Render: RenderConfig{
			ServiceURL:   os.Getenv("RENDER_URL"),
			PrintBaseURL: getenv("PRINT_BASE_URL", "http://frontend:5173"),
			CMYK:         getenv("PDF_CMYK", "false") == "true",
		},
		Telegram: TelegramConfig{
			Token:  os.Getenv("TELEGRAM_BOT_TOKEN"),
			ChatID: os.Getenv("TELEGRAM_CHAT_ID"),
			APIURL: os.Getenv("TELEGRAM_API_URL"),
		},
		S3: S3Config{
			Endpoint:  required("S3_ENDPOINT"),
			AccessKey: required("S3_ACCESS_KEY"),
			SecretKey: required("S3_SECRET_KEY"),
			Bucket:    required("S3_BUCKET"),
			UseSSL:    getenv("S3_USE_SSL", "false") == "true",
			Region:    getenv("S3_REGION", "us-east-1"),
		},
	}
	cfg.S3.PublicEndpoint = getenv("S3_PUBLIC_ENDPOINT", cfg.S3.Endpoint)
	cfg.S3.PublicUseSSL = getenv("S3_PUBLIC_USE_SSL", fmt.Sprint(cfg.S3.UseSSL)) == "true"

	lead, err := strconv.Atoi(getenv("ORDER_MIN_LEAD_DAYS", "3"))
	if err != nil || lead < 0 {
		return Config{}, fmt.Errorf("ORDER_MIN_LEAD_DAYS must be a non-negative number")
	}
	cfg.OrderMinLeadDays = lead
	if cfg.Telegram.Token != "" && cfg.Telegram.ChatID == "" {
		missing = append(missing, "TELEGRAM_CHAT_ID")
	}

	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required env vars: %s", strings.Join(missing, ", "))
	}
	cfg.Production = os.Getenv("APP_ENV") == "production"
	if cfg.Production {
		if err := checkProduction(cfg); err != nil {
			return Config{}, err
		}
	}
	return cfg, nil
}

// Пароли из .env.example — для разработки. В боевом режиме с ними сервер не запустится.
var examplePasswords = map[string]bool{"photobook": true, "photobooksecret": true}

// checkProduction — в боевом режиме (APP_ENV=production) не запускаемся
// со слабыми паролями и без HTTPS: лучше упасть при запуске, чем открыть
// базу или админку паролем из примера.
func checkProduction(cfg Config) error {
	var problems []string
	if cfg.AdminPassword != "" && len(cfg.AdminPassword) < 16 {
		problems = append(problems, "ADMIN_PASSWORD must be at least 16 characters")
	}
	if examplePasswords[cfg.S3.SecretKey] || len(cfg.S3.SecretKey) < 16 {
		problems = append(problems, "S3_SECRET_KEY must be at least 16 characters and not the example one")
	}
	if u, err := url.Parse(cfg.DatabaseURL); err == nil {
		if pass, _ := u.User.Password(); examplePasswords[pass] || len(pass) < 16 {
			problems = append(problems, "the database password must be at least 16 characters and not the example one")
		}
	}
	if !strings.HasPrefix(cfg.AppBaseURL, "https://") {
		problems = append(problems, "APP_BASE_URL must be https://")
	}
	if len(problems) > 0 {
		return fmt.Errorf("APP_ENV=production: %s", strings.Join(problems, "; "))
	}
	return nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
