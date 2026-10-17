-- +goose Up
-- Книга клиента. Доступ по секретному токену из ссылки, без регистрации.
CREATE TABLE books (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token           text NOT NULL UNIQUE,
    format_id       text NOT NULL REFERENCES formats (id),
    template_id     text NOT NULL,             -- шаблоны лежат файлами в репозитории, поэтому без FK
    schema_version  integer NOT NULL DEFAULT 1, -- версия формата JSON страниц, чтобы старые книги не ломались
    pages           jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(pages) = 'array'),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE books;
