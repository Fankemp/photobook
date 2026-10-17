-- +goose Up
-- Миниатюры делает фоновый обработчик. Попытки и последняя ошибка нужны,
-- чтобы битый файл не обрабатывался бесконечно, а причину было видно в базе.
ALTER TABLE assets
    ADD COLUMN thumb_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN thumb_error    text;

-- Очередь на миниатюры: загруженные фото без миниатюры.
CREATE INDEX assets_thumb_queue_idx ON assets (uploaded_at)
    WHERE status = 'uploaded' AND thumb_key IS NULL;

-- +goose Down
DROP INDEX assets_thumb_queue_idx;
ALTER TABLE assets DROP COLUMN thumb_error, DROP COLUMN thumb_attempts;
