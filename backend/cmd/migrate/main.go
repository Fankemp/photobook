// Ручное управление миграциями (сервер и так применяет их при старте).
//
//	migrate status — какие миграции применены
//	migrate up     — применить все новые
//	migrate down   — откатить последнюю
package main

import (
	"context"
	"fmt"
	"os"

	"photobook/internal/db"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}

func run() error {
	cmd := "status"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL is not set")
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	m, err := db.NewMigrator(pool)
	if err != nil {
		return err
	}

	switch cmd {
	case "status":
		statuses, err := m.Status(ctx)
		if err != nil {
			return err
		}
		for _, s := range statuses {
			applied := ""
			if !s.AppliedAt.IsZero() {
				applied = s.AppliedAt.Format("2006-01-02 15:04:05")
			}
			fmt.Printf("%-8s %-30s %s\n", s.State, s.Source.Path, applied)
		}
	case "up":
		results, err := m.Up(ctx)
		if err != nil {
			return err
		}
		if len(results) == 0 {
			fmt.Println("nothing to apply")
		}
		for _, r := range results {
			fmt.Printf("applied %s (%s)\n", r.Source.Path, r.Duration)
		}
	case "down":
		r, err := m.Down(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("rolled back %s (%s)\n", r.Source.Path, r.Duration)
	default:
		return fmt.Errorf("unknown command %q (use status, up or down)", cmd)
	}
	return nil
}
