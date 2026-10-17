-- +goose Up
-- Обложка хранится отдельно от внутренних страниц: у формата pages = число
-- страниц без обложки, а размеры обложки у типографии обычно другие.
-- Книг ещё нет ни в одной базе, поэтому NOT NULL без значения по умолчанию.
ALTER TABLE books
    ADD COLUMN cover jsonb NOT NULL CHECK (jsonb_typeof(cover) = 'object');

-- +goose Down
ALTER TABLE books DROP COLUMN cover;
