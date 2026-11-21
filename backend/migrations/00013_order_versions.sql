-- +goose Up
-- Окно правок после заявки и снимки заказа.
--
-- Книгу можно менять, пока заказ new, awaiting_prepayment или paid; с printing
-- и дальше она закрыта. Правки клиента после заявки копятся (book_changed_at),
-- а когда он перестал править — событие в истории, сообщение в Telegram
-- и пересборка PDF (change_settled_at — до какой правки это уже сделано).
ALTER TABLE orders
    ADD COLUMN confirmed_at      timestamptz, -- клиент отметил «Я проверил(а) тексты и фото»
    ADD COLUMN book_changed_at   timestamptz, -- последняя правка книги после заявки (клиентом)
    ADD COLUMN change_settled_at timestamptz, -- правки до этого момента обработаны
    ADD COLUMN pdf_book_version  integer,     -- версия книги, из которой собран текущий PDF
    -- Когда последний раз попросили собрать PDF: если просьба пришла, пока шла
    -- сборка, после неё заявка остаётся в очереди (собранный снимок уже старый).
    ADD COLUMN render_requested_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN render_reason     text NOT NULL DEFAULT 'order'
        CHECK (render_reason IN ('order', 'client_change', 'admin_change', 'rerender'));

-- Старые заявки: книга была закрыта с момента заявки, PDF собран из той же версии.
UPDATE orders SET pdf_book_version = book_version, render_requested_at = created_at;

-- Снимок заказа: копия страниц, формата и шаблона на момент заявки и каждой
-- пересборки PDF. Печатается именно снимок. Снимки не меняются и не удаляются
-- (триггер ниже); единственное, что дописывается, — PDF этой версии, один раз.
CREATE TABLE order_versions (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id         uuid NOT NULL REFERENCES orders (id),
    version          integer NOT NULL,     -- 1 — заявка, дальше по порядку
    reason           text NOT NULL CHECK (reason IN ('order', 'client_change', 'admin_change', 'rerender')),
    book_version     integer NOT NULL,     -- версия книги (books.version) в снимке
    template_id      text NOT NULL,
    template_version text NOT NULL,        -- хеш файла шаблона (пусто — шаблон уже удалён)
    schema_version   integer NOT NULL,     -- версия формата JSON страниц
    format           jsonb NOT NULL,       -- формат целиком (размеры, вылет, PDF) на момент снимка
    cover            jsonb NOT NULL,
    pages            jsonb NOT NULL,
    back_cover       jsonb NOT NULL,
    confirmed_at     timestamptz,          -- подтверждение клиента (галочка), действующее для снимка
    created_at       timestamptz NOT NULL DEFAULT now(),
    -- PDF этой версии (заполняется один раз, когда собран):
    book_pdf_key     text,
    cover_pdf_key    text,
    block_pdf_key    text,
    pdf_info         text,
    rendered_at      timestamptz,
    UNIQUE (order_id, version)
);

-- +goose StatementBegin
CREATE FUNCTION order_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'order_versions: снимок заказа нельзя удалить';
    END IF;
    IF (NEW.order_id, NEW.version, NEW.reason, NEW.book_version, NEW.template_id, NEW.template_version,
        NEW.schema_version, NEW.format, NEW.cover, NEW.pages, NEW.back_cover, NEW.confirmed_at, NEW.created_at)
       IS DISTINCT FROM
       (OLD.order_id, OLD.version, OLD.reason, OLD.book_version, OLD.template_id, OLD.template_version,
        OLD.schema_version, OLD.format, OLD.cover, OLD.pages, OLD.back_cover, OLD.confirmed_at, OLD.created_at) THEN
        RAISE EXCEPTION 'order_versions: снимок заказа нельзя изменить, нужна новая версия';
    END IF;
    IF OLD.rendered_at IS NOT NULL THEN
        RAISE EXCEPTION 'order_versions: PDF версии % уже сохранён', OLD.version;
    END IF;
    RETURN NEW;
END $$;
-- +goose StatementEnd

CREATE TRIGGER order_versions_immutable BEFORE UPDATE OR DELETE ON order_versions
    FOR EACH ROW EXECUTE FUNCTION order_versions_immutable();

-- Снимок для уже существующих заявок — из книги (она была закрыта с заявки).
INSERT INTO order_versions (order_id, version, reason, book_version, template_id, template_version, schema_version,
                            format, cover, pages, back_cover, created_at,
                            book_pdf_key, cover_pdf_key, block_pdf_key, pdf_info, rendered_at)
SELECT o.id, 1, 'order', b.version, b.template_id, '', b.schema_version,
       jsonb_build_object('id', f.id, 'name', f.name, 'widthMm', f.width_mm, 'heightMm', f.height_mm,
           'bleedMm', f.bleed_mm, 'safeMm', f.safe_mm, 'pages', f.pages, 'minPages', f.min_pages,
           'maxPages', f.max_pages, 'pageStep', f.page_step, 'minDpi', f.min_dpi, 'targetDpi', f.target_dpi,
           'priceKzt', f.price_kzt, 'pricePerPageKzt', f.price_per_page_kzt, 'spineMm', f.spine_mm,
           'wrapMm', f.wrap_mm, 'pdfMode', f.pdf_mode, 'pdfOrder', f.pdf_order),
       b.cover, b.pages, b.back_cover, o.created_at,
       o.book_pdf_key, o.cover_pdf_key, o.block_pdf_key, o.pdf_info, o.rendered_at
FROM orders o JOIN books b ON b.id = o.book_id JOIN formats f ON f.id = b.format_id;

-- Очередь сообщений в Telegram об изменениях книги после заявки
-- (о новой заявке — как раньше, через orders.notified_at).
CREATE TABLE order_notices (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id     uuid NOT NULL REFERENCES orders (id),
    kind         text NOT NULL CHECK (kind IN ('book_changed')),
    book_version integer NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    sent_at      timestamptz,
    attempts     integer NOT NULL DEFAULT 0,
    error        text
);

CREATE INDEX order_notices_queue_idx ON order_notices (created_at) WHERE sent_at IS NULL;

-- +goose Down
DROP TABLE order_notices;
DROP TABLE order_versions;
DROP FUNCTION order_versions_immutable();
ALTER TABLE orders
    DROP COLUMN render_reason,
    DROP COLUMN render_requested_at,
    DROP COLUMN pdf_book_version,
    DROP COLUMN change_settled_at,
    DROP COLUMN book_changed_at,
    DROP COLUMN confirmed_at;
