// Package storage — клиент S3-совместимого хранилища для фото и PDF.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/cors"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"photobook/internal/config"
)

var ErrNotFound = errors.New("object not found")

type Storage struct {
	client  *minio.Client // для запросов самого backend
	presign *minio.Client // только для подписи ссылок, которые откроет браузер
	bucket  string
}

func New(cfg config.S3Config) (*Storage, error) {
	client, err := newClient(cfg.Endpoint, cfg.UseSSL, cfg)
	if err != nil {
		return nil, err
	}
	presign, err := newClient(cfg.PublicEndpoint, cfg.PublicUseSSL, cfg)
	if err != nil {
		return nil, err
	}
	return &Storage{client: client, presign: presign, bucket: cfg.Bucket}, nil
}

func newClient(endpoint string, useSSL bool, cfg config.S3Config) (*minio.Client, error) {
	c, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: useSSL,
		// Регион задан явно: подпись ссылки — локальное вычисление, и клиент
		// не должен ради неё ходить в хранилище (публичный адрес backend'у
		// внутри Docker недоступен).
		Region: cfg.Region,
		// Self-hosted S3 по умолчанию понимает только адреса вида host/bucket/key,
		// а не bucket.host/key.
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return nil, fmt.Errorf("create s3 client for %s: %w", endpoint, err)
	}
	return c, nil
}

// EnsureBucket создаёт бакет, если его ещё нет, и разрешает браузеру
// с адресов сайта загружать и читать файлы напрямую (CORS).
func (s *Storage) EnsureBucket(ctx context.Context, appOrigins []string) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("check bucket %q: %w", s.bucket, err)
	}
	if !exists {
		if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{}); err != nil {
			return fmt.Errorf("create bucket %q: %w", s.bucket, err)
		}
	}
	rules := cors.NewConfig([]cors.Rule{{
		AllowedOrigin: appOrigins,
		AllowedMethod: []string{http.MethodGet, http.MethodPut, http.MethodHead},
		AllowedHeader: []string{"*"},
		ExposeHeader:  []string{"ETag"},
		MaxAgeSeconds: 3600,
	}})
	if err := s.client.SetBucketCors(ctx, s.bucket, rules); err != nil {
		return fmt.Errorf("set bucket cors: %w", err)
	}
	return nil
}

// Ping проверяет, что хранилище отвечает и бакет на месте.
func (s *Storage) Ping(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("bucket %q not found", s.bucket)
	}
	return nil
}

// PresignPut — ссылка, по которой браузер загрузит файл методом PUT.
// PresignPut — ссылка, по которой браузер загрузит в хранилище ровно size байт.
// Размер входит в подпись (заголовок Content-Length, его браузер ставит сам по
// файлу): файл другого размера хранилище отклонит. Без этого по ссылке можно
// было бы залить сколько угодно — проверка при подтверждении была бы уже после.
func (s *Storage) PresignPut(ctx context.Context, key string, size int64, ttl time.Duration) (string, error) {
	h := http.Header{}
	h.Set("Content-Length", strconv.FormatInt(size, 10))
	u, err := s.presign.PresignHeader(ctx, http.MethodPut, s.bucket, key, ttl, nil, h)
	if err != nil {
		return "", fmt.Errorf("presign put %s: %w", key, err)
	}
	return u.String(), nil
}

// PresignGet — временная ссылка на просмотр файла.
func (s *Storage) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	u, err := s.presign.PresignedGetObject(ctx, s.bucket, key, ttl, nil)
	if err != nil {
		return "", fmt.Errorf("presign get %s: %w", key, err)
	}
	return u.String(), nil
}

// PresignGetInternal — временная ссылка с внутренним адресом хранилища (s3:9000):
// для сервиса рендера внутри Docker-сети. Браузер клиента по ней не откроет.
func (s *Storage) PresignGetInternal(ctx context.Context, key string, ttl time.Duration) (string, error) {
	u, err := s.client.PresignedGetObject(ctx, s.bucket, key, ttl, nil)
	if err != nil {
		return "", fmt.Errorf("presign internal get %s: %w", key, err)
	}
	return u.String(), nil
}

// PresignDownload — временная ссылка, по которой браузер скачает файл
// под именем filename (а не откроет его во вкладке).
func (s *Storage) PresignDownload(ctx context.Context, key, filename string, ttl time.Duration) (string, error) {
	params := url.Values{"response-content-disposition": {fmt.Sprintf(`attachment; filename="%s"`, filename)}}
	u, err := s.presign.PresignedGetObject(ctx, s.bucket, key, ttl, params)
	if err != nil {
		return "", fmt.Errorf("presign download %s: %w", key, err)
	}
	return u.String(), nil
}

type ObjectInfo struct {
	Size        int64
	ContentType string
}

func (s *Storage) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	info, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if minio.ToErrorResponse(err).StatusCode == http.StatusNotFound {
			return ObjectInfo{}, ErrNotFound
		}
		return ObjectInfo{}, fmt.Errorf("stat %s: %w", key, err)
	}
	return ObjectInfo{Size: info.Size, ContentType: info.ContentType}, nil
}

// Open открывает файл на чтение. Закрыть — задача вызывающего.
func (s *Storage) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", key, err)
	}
	return obj, nil
}

// Download скачивает файл из хранилища в локальный файл path.
func (s *Storage) Download(ctx context.Context, key, path string) error {
	if err := s.client.FGetObject(ctx, s.bucket, key, path, minio.GetObjectOptions{}); err != nil {
		return fmt.Errorf("download %s: %w", key, err)
	}
	return nil
}

// Upload кладёт локальный файл path в хранилище под ключом key.
func (s *Storage) Upload(ctx context.Context, key, path, contentType string) error {
	_, err := s.client.FPutObject(ctx, s.bucket, key, path, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return fmt.Errorf("upload %s: %w", key, err)
	}
	return nil
}

func (s *Storage) Remove(ctx context.Context, key string) error {
	if err := s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("remove %s: %w", key, err)
	}
	return nil
}
