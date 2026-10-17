-- +goose Up
-- Заявки клиентов. Пока у книги есть неотменённая заявка, книга закрыта
-- для изменений: печатаем ровно то, что клиент заказал.
CREATE TABLE orders (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number          bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE, -- «заявка №1001» для людей
    book_id         uuid NOT NULL REFERENCES books (id),
    book_version    integer NOT NULL,          -- версия книги в момент заявки
    name            text NOT NULL,
    phone           text NOT NULL,             -- +77001234567
    address         text NOT NULL,
    wanted_date     date NOT NULL,
    comment         text NOT NULL DEFAULT '',
    status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'awaiting_prepayment', 'paid', 'printing', 'delivery', 'done', 'cancelled')),
    price_kzt       integer NOT NULL,          -- цена формата в момент заявки
    pdf_key         text,                      -- печатный PDF (шаг 8)
    -- Уведомление в Telegram через очередь: не отправилось — попробуем ещё.
    notified_at     timestamptz,
    notify_attempts integer NOT NULL DEFAULT 0,
    notify_error    text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Одна действующая заявка на книгу (отменённые не считаются).
CREATE UNIQUE INDEX orders_one_active_per_book ON orders (book_id) WHERE status <> 'cancelled';

CREATE INDEX orders_notify_queue_idx ON orders (created_at) WHERE notified_at IS NULL;

-- История статусов: кто/когда/почему (для админки, шаг 7).
CREATE TABLE order_events (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    status      text NOT NULL,
    note        text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_events_order_id_idx ON order_events (order_id);

-- +goose Down
DROP TABLE order_events;
DROP TABLE orders;
