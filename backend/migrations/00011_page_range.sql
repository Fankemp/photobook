-- +goose Up
-- Число страниц книги клиент меняет сам: удаляет и добавляет страницы листами.
--   pages              — сколько страниц у новой книги (столько в шаблонах);
--   min_pages, max_pages — пределы числа страниц (без обложек);
--   page_step          — шаг: число страниц кратно ему (типография печатает
--                        листами, у листа две стороны — шаг 2);
--   price_per_page_kzt — доплата за каждую страницу сверх pages (за каждую
--                        страницу меньше pages — столько же скидки).
ALTER TABLE formats
    ADD COLUMN min_pages integer,
    ADD COLUMN max_pages integer,
    ADD COLUMN page_step integer,
    ADD COLUMN price_per_page_kzt integer NOT NULL DEFAULT 0 CHECK (price_per_page_kzt >= 0);

-- Значения для разработки — заменить на данные типографии (как размеры и цену).
UPDATE formats SET min_pages = 10, max_pages = 20, page_step = 2;

ALTER TABLE formats
    ALTER COLUMN min_pages SET NOT NULL,
    ALTER COLUMN max_pages SET NOT NULL,
    ALTER COLUMN page_step SET NOT NULL,
    ADD CONSTRAINT formats_page_range_check CHECK (
        page_step > 0 AND min_pages > 0
        AND min_pages <= pages AND pages <= max_pages AND pages % page_step = 0);

-- +goose Down
ALTER TABLE formats
    DROP CONSTRAINT formats_page_range_check,
    DROP COLUMN price_per_page_kzt,
    DROP COLUMN page_step,
    DROP COLUMN max_pages,
    DROP COLUMN min_pages;
