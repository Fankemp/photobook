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
	S3           S3Config
}

// S3Config — любое S3-совместимое хранилище (локально RustFS).
type S3Config struct {
	Endpoint  string // host:port без схемы, например "s3:9000"
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
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
		S3: S3Config{
			Endpoint:  required("S3_ENDPOINT"),
			AccessKey: required("S3_ACCESS_KEY"),
			SecretKey: required("S3_SECRET_KEY"),
			Bucket:    required("S3_BUCKET"),
			UseSSL:    getenv("S3_USE_SSL", "false") == "true",
		},
	}
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
