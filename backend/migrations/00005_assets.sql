-- +goose Up
-- Фото, загруженные в книгу. Файл кладёт в хранилище сам браузер по presigned URL,
-- поэтому запись создаётся заранее (pending) и подтверждается после загрузки (uploaded).
CREATE TABLE assets (
    id            uuid PRIMARY KEY,
    book_id       uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded')),
    original_key  text NOT NULL UNIQUE,   -- оригинал для печати
    thumb_key     text,                   -- миниатюра для экрана (шаг 4)
    content_type  text NOT NULL,
    size_bytes    bigint,
    width_px      integer,                -- с учётом поворота (EXIF), как фото видит человек
    height_px     integer,
    created_at    timestamptz NOT NULL DEFAULT now(),
    uploaded_at   timestamptz
);

CREATE INDEX assets_book_id_idx ON assets (book_id);

-- +goose Down
DROP TABLE assets;
