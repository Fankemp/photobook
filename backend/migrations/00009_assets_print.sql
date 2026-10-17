-- +goose Up
-- Печатная копия фото, если оригинал хранится «лёжа» с пометкой EXIF «повернуть»
-- (так часто снимают телефоны). Chromium такие фото в PDF не кладёт как JPEG,
-- а разжимает — страница вырастает до десятков мегабайт. Копия уже повёрнута;
-- остальные фото печатаются прямо из оригинала.
ALTER TABLE assets ADD COLUMN print_key text;

-- +goose Down
ALTER TABLE assets DROP COLUMN print_key;
