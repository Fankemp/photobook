-- +goose Up
-- Формат книги: размеры и параметры печати. Код берёт их отсюда, а не из констант.
CREATE TABLE formats (
    id          text PRIMARY KEY,              -- читаемый slug, на него ссылаются шаблоны
    name        text NOT NULL,
    width_mm    numeric(6,2) NOT NULL CHECK (width_mm > 0),
    height_mm   numeric(6,2) NOT NULL CHECK (height_mm > 0),
    bleed_mm    numeric(5,2) NOT NULL CHECK (bleed_mm >= 0),
    safe_mm     numeric(5,2) NOT NULL CHECK (safe_mm >= 0),
    pages       integer      NOT NULL CHECK (pages > 0),   -- без обложки
    min_dpi     integer      NOT NULL CHECK (min_dpi > 0), -- ниже — предупреждение на слоте
    target_dpi  integer      NOT NULL CHECK (target_dpi >= min_dpi),
    price_kzt   integer      NOT NULL CHECK (price_kzt >= 0),
    created_at  timestamptz  NOT NULL DEFAULT now()
);

-- Значения для разработки. Заменить на данные типографии (размеры и цену).
INSERT INTO formats (id, name, width_mm, height_mm, bleed_mm, safe_mm, pages, min_dpi, target_dpi, price_kzt)
VALUES ('square-200', 'Квадрат 20×20 см', 200, 200, 3, 5, 20, 200, 300, 0);

-- +goose Down
DROP TABLE formats;
