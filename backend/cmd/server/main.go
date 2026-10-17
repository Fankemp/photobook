// Сервер photobook: HTTP API. При старте применяет миграции, создаёт бакет
// и загружает шаблоны (с проверкой).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"photobook/internal/assets"
	"photobook/internal/books"
	"photobook/internal/config"
	"photobook/internal/db"
	"photobook/internal/formats"
	"photobook/internal/httpapi"
	"photobook/internal/storage"
	"photobook/internal/templates"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool, log); err != nil {
		return err
	}

	store, err := storage.New(cfg.S3)
	if err != nil {
		return err
	}
	if err := store.EnsureBucket(ctx, cfg.AppOrigins); err != nil {
		return err
	}

	formatStore := formats.NewStore(pool)
	fmts, err := formatStore.All(ctx)
	if err != nil {
		return err
	}
	catalog, err := templates.LoadDir(cfg.TemplatesDir, fmts)
	if err != nil {
		return err
	}
	log.Info("templates loaded", "count", len(catalog.List()), "dir", cfg.TemplatesDir)

	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpapi.New(httpapi.Deps{
			DB:        pool,
			Storage:   store,
			Formats:   formatStore,
			Templates: catalog,
			Books:     books.NewStore(pool),
			Assets:    assets.NewService(pool, store),
			Log:       log,
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Info("listening", "addr", cfg.HTTPAddr)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}

	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
