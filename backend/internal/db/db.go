// Package db — подключение к PostgreSQL и миграции схемы.
package db

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"

	"photobook/migrations"
)

// Connect открывает пул соединений и проверяет, что база отвечает.
func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return pool, nil
}

// NewMigrator возвращает goose-провайдер поверх SQL-файлов, вшитых в бинарник.
// Session locker берёт advisory lock в Postgres, чтобы два процесса
// не применяли миграции одновременно.
func NewMigrator(pool *pgxpool.Pool) (*goose.Provider, error) {
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return nil, fmt.Errorf("create migration locker: %w", err)
	}
	// goose работает через database/sql; OpenDBFromPool оборачивает наш пул,
	// закрывать полученный *sql.DB не нужно — пул закрывается отдельно.
	return goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migrations.FS,
		goose.WithSessionLocker(locker))
}

// Migrate применяет все ещё не применённые миграции.
func Migrate(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) error {
	m, err := NewMigrator(pool)
	if err != nil {
		return err
	}
	results, err := m.Up(ctx)
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	for _, r := range results {
		log.Info("migration applied", "file", r.Source.Path, "duration", r.Duration)
	}
	return nil
}
