-- +goose Up
-- Обложка «в развёртке» у типографии: корешок и загибы на картон.
-- Пока 0 — обложка того же размера, что и страница; цифры даст типография.
ALTER TABLE formats
    ADD COLUMN spine_mm numeric(5,2) NOT NULL DEFAULT 0 CHECK (spine_mm >= 0),
    ADD COLUMN wrap_mm  numeric(5,2) NOT NULL DEFAULT 0 CHECK (wrap_mm >= 0);

-- Печатные PDF заявки: два файла (обложка и блок страниц), собираются в фоне.
-- pdf_key из первой версии ни разу не заполнялся — заменяем двумя ключами.
ALTER TABLE orders
    DROP COLUMN pdf_key,
    ADD COLUMN cover_pdf_key   text,
    ADD COLUMN block_pdf_key   text,
    ADD COLUMN render_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN render_error    text,
    ADD COLUMN rendered_at     timestamptz,
    ADD COLUMN pdf_info        text; -- итог проверки: страницы, размер, встроенные шрифты

CREATE INDEX orders_render_queue_idx ON orders (created_at)
    WHERE block_pdf_key IS NULL AND status <> 'cancelled';

-- +goose Down
DROP INDEX orders_render_queue_idx;
ALTER TABLE orders
    DROP COLUMN pdf_info,
    DROP COLUMN rendered_at,
    DROP COLUMN render_error,
    DROP COLUMN render_attempts,
    DROP COLUMN block_pdf_key,
    DROP COLUMN cover_pdf_key,
    ADD COLUMN pdf_key text;
ALTER TABLE formats DROP COLUMN wrap_mm, DROP COLUMN spine_mm;
