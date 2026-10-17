-- +goose Up
-- Номер версии для автосохранения: клиент присылает версию, которую видел,
-- и если книгу успели изменить в другой вкладке, сохранение отклоняется,
-- а не затирает чужие правки молча.
ALTER TABLE books ADD COLUMN version integer NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE books DROP COLUMN version;
