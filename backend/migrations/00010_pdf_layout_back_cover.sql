-- +goose Up
-- Как собирать печатный PDF — настройка формата, а не кода:
--   pdf_mode  single — один файл book.pdf; split — cover.pdf (обложки) и block.pdf (страницы);
--   pdf_order порядок частей: front — передняя обложка, pages — страницы, back — задняя обложка.
ALTER TABLE formats
    ADD COLUMN pdf_mode  text NOT NULL DEFAULT 'single' CHECK (pdf_mode IN ('single', 'split')),
    ADD COLUMN pdf_order text NOT NULL DEFAULT 'front,pages,back'
        CHECK (pdf_order ~ '^(front|pages|back)(,(front|pages|back))*$' AND pdf_order LIKE '%pages%');

-- Задняя обложка — отдельная страница книги. У существующих книг — пустая,
-- с фоном передней обложки.
ALTER TABLE books ADD COLUMN back_cover jsonb;
UPDATE books SET back_cover = jsonb_build_object(
    'id', 'back',
    'background', coalesce(cover -> 'background', '"#ffffff"'::jsonb),
    'elements', '[]'::jsonb);
ALTER TABLE books
    ALTER COLUMN back_cover SET NOT NULL,
    ADD CONSTRAINT books_back_cover_check CHECK (jsonb_typeof(back_cover) = 'object');

-- Один файл (single) — свой ключ. Очередь сборки теперь по rendered_at:
-- «не собрано» не зависит от того, сколько файлов в режиме.
ALTER TABLE orders ADD COLUMN book_pdf_key text;
DROP INDEX orders_render_queue_idx;
CREATE INDEX orders_render_queue_idx ON orders (created_at) WHERE rendered_at IS NULL AND status <> 'cancelled';

-- +goose Down
DROP INDEX orders_render_queue_idx;
CREATE INDEX orders_render_queue_idx ON orders (created_at) WHERE block_pdf_key IS NULL AND status <> 'cancelled';
ALTER TABLE orders DROP COLUMN book_pdf_key;
ALTER TABLE books DROP COLUMN back_cover;
ALTER TABLE formats DROP COLUMN pdf_order, DROP COLUMN pdf_mode;
