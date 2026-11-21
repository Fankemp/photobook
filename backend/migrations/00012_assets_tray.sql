-- +goose Up
-- Лоток «Мои фото»: все фото книги, раскладываются по рамкам без повторной загрузки.
-- sha256 — хеш файла (присылает браузер): одно и то же фото не загружаем дважды.
-- taken_at — дата съёмки из EXIF (DateTimeOriginal, местное время камеры, без
-- часового пояса): автораскладка идёт по ней, без неё — по порядку загрузки.
-- removed_at — клиент удалил фото из лотка. Файл и запись остаются (можно
-- отменить удаление, а «Отменить» в редакторе может вернуть фото в рамку);
-- уберёт их будущая фоновая уборка фото, на которые никто не ссылается.
ALTER TABLE assets
    ADD COLUMN sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    ADD COLUMN taken_at timestamp,
    ADD COLUMN removed_at timestamptz;

CREATE INDEX assets_book_sha256 ON assets (book_id, sha256) WHERE sha256 IS NOT NULL;

-- +goose Down
DROP INDEX assets_book_sha256;
ALTER TABLE assets DROP COLUMN sha256, DROP COLUMN taken_at, DROP COLUMN removed_at;
