// Package migrations вшивает SQL-миграции в бинарник.
// Новая миграция = новый файл NNNNN_name.sql с блоками "-- +goose Up" и "-- +goose Down".
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
