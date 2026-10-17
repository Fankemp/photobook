// Package config читает настройки сервиса из переменных окружения.
// Секреты (пароли, ключи) приходят только отсюда, в коде их нет.
package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	HTTPAddr     string
	DatabaseURL  string
	TemplatesDir string
	// Адреса сайта, с которых браузер может загружать файлы прямо в хранилище (CORS).
	AppOrigins []string
	S3         S3Config
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
		TemplatesDir: getenv("TEMPLATES_DIR", "../templates"),
		AppOrigins:   strings.Split(getenv("APP_ORIGINS", "http://localhost:5173"), ","),
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

	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required env vars: %s", strings.Join(missing, ", "))
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
