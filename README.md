# Photobook

Сервис подарочных фотокниг. Описание продукта, правила и план работ — в [CLAUDE.md](CLAUDE.md).

Готово:
- **шаг 1 — каркас**: Go-бэкенд, React-фронтенд, PostgreSQL, S3-хранилище, миграции, health-check;
- **шаг 2 — книга и шаблоны**: каталог шаблонов → просмотр шаблона → создание книги → книга по секретной ссылке `/b/<токен>`.

## Что нужно

- Docker с Docker Compose v2
- Для запуска без Docker и для `make test`: Go 1.27+ и Node.js 20.19+ (или 22.12+)

> Если у вас Go старее (например, 1.22), команды `go` в папке `backend/` сами скачают
> нужную версию (механизм `GOTOOLCHAIN`). Но лучше обновить Go: 1.22 уже не получает
> исправлений безопасности.

## Запуск

```bash
make up        # первый раз создаст .env из .env.example, соберёт и запустит всё
make ps        # статус сервисов: postgres, s3, backend должны быть (healthy)
make logs      # логи (Ctrl+C — выйти)
make down      # остановить; данные БД и файлов сохраняются в docker volumes
```

Без `make`: `cp .env.example .env && docker compose up --build -d`.

## Как проверить, что всё работает

| Что | Где | Ожидаемо |
|---|---|---|
| Каталог | http://localhost:5173 | три шаблона с обложками |
| Создание книги | открыть шаблон → «Создать книгу по этому шаблону» | адрес вида `/b/ABCD…` (26 символов), ссылка и кнопка «Копировать» |
| Возврат к книге | снова открыть http://localhost:5173 | плашка «Продолжить мою книгу» |
| API | `curl localhost:8080/api/health` | `{"status":"ok","checks":{"db":"ok","storage":"ok"}}` |
| Консоль хранилища | http://localhost:9001/rustfs/console/ | вход по `S3_ACCESS_KEY` / `S3_SECRET_KEY` из `.env`, виден бакет `photobook` |
| База | `make psql`, затем `\dt` | таблицы `books`, `formats`, `goose_db_version` |
| Миграции | `make migrate-status` | все миграции `applied` |

Если зависимость недоступна, `/api/health` отвечает `503` и пишет, какая именно (`"storage":"error"`).

## Сервисы

| Сервис | Порт (только localhost) | Что это |
|---|---|---|
| `frontend` | 5173 | Vite dev-сервер, hot reload. `/api/*` проксирует на backend |
| `backend` | 8080 | Go API. При старте применяет миграции и создаёт бакет |
| `postgres` | 5432 | PostgreSQL 18 |
| `s3` | 9000 (API), 9001 (консоль) | [RustFS](https://github.com/rustfs/rustfs) — S3-совместимое хранилище |

Порты меняются в `.env`, если заняты.

**Почему RustFS, а не MinIO:** MinIO с 2025 года не публикует бесплатные Docker-образы.
Бэкенд работает с хранилищем только по протоколу S3, поэтому RustFS можно заменить
на любой другой S3 (SeaweedFS, облачный S3) правкой сервиса `s3` в `docker-compose.yml`.

## Разработка

**Frontend** — правки в `frontend/src` сразу видны в браузере.
Если поменяли `package.json`: `docker compose restart frontend`.

**Backend и шаблоны** — после правок пересобрать: `docker compose up --build -d backend`.
Или запустить локально против Postgres и S3 из Docker:

```bash
cd backend
export DATABASE_URL="postgres://photobook:photobook@localhost:5432/photobook?sslmode=disable"
export S3_ENDPOINT=localhost:9000 S3_ACCESS_KEY=photobook S3_SECRET_KEY=photobooksecret S3_BUCKET=photobook
export HTTP_ADDR=:8081   # 8080 занят контейнером backend
# TEMPLATES_DIR по умолчанию ../templates — для запуска из backend/ ничего задавать не нужно
go run ./cmd/server
```

**Тесты:** `make test` (Go-тесты + линтер и сборка фронтенда; один раз перед этим `cd frontend && npm install`).

### Шаблоны

Лежат в [templates/](templates/), один JSON-файл = один шаблон. Формат и правила — в
[templates/README.md](templates/README.md). Сервер проверяет все шаблоны при старте и не
запустится с битым файлом; `make test` проверяет их без запуска.

### API

| Метод и путь | Что делает |
|---|---|
| `GET /api/health` | состояние сервиса и зависимостей |
| `GET /api/templates` | каталог: шаблоны без внутренних страниц, но с обложкой и форматом |
| `GET /api/templates/{id}` | шаблон целиком |
| `POST /api/books` `{"templateId": "…"}` | создать книгу по шаблону → `201 {"token": "…"}` |
| `GET /api/books/{token}` | книга (обложка, страницы) вместе с форматом |

Ошибки приходят как `{"error": "код"}` (`template_not_found`, `book_not_found`, `bad_request`,
`internal`); текст для человека фронтенд берёт из словаря по коду.

### Миграции

Файлы лежат в `backend/migrations/`, применяются автоматически при старте сервера
([goose](https://github.com/pressly/goose)). Новая миграция — новый файл со следующим номером:

```sql
-- backend/migrations/00003_assets.sql
-- +goose Up
CREATE TABLE assets (...);

-- +goose Down
DROP TABLE assets;
```

Ручное управление: `make migrate-status`, `make migrate-up`, `make migrate-down` (откат последней).

### Сбросить данные

```bash
docker compose down -v   # ВНИМАНИЕ: удаляет базу и все загруженные файлы
```

## Структура

```
backend/
  cmd/server/         точка входа HTTP-сервера
  cmd/migrate/        ручное управление миграциями
  internal/config/    настройки из переменных окружения
  internal/db/        подключение к Postgres, запуск миграций
  internal/storage/   клиент S3
  internal/pages/     формат страницы (JSON) и его проверка
  internal/formats/   форматы книг из таблицы formats
  internal/templates/ загрузка и проверка шаблонов
  internal/books/     книги: создание по шаблону, токен, чтение
  internal/httpapi/   HTTP-роуты
  migrations/         SQL-миграции (вшиваются в бинарник)
templates/            шаблоны книг (JSON)
frontend/
  src/i18n/ru.ts      все строки интерфейса
  src/api.ts          запросы к бэкенду
  src/types.ts        типы данных API (повторяют Go-структуры)
  src/book/PageView   единый компонент отрисовки страницы
  src/screens/        экраны: каталог, шаблон, книга
  src/App.tsx         карта адресов (роуты)
docker-compose.yml    локальное окружение
.env.example          шаблон настроек и секретов
```

## Настройки (переменные окружения backend)

| Переменная | Пример | |
|---|---|---|
| `HTTP_ADDR` | `:8080` | адрес HTTP-сервера (по умолчанию `:8080`) |
| `DATABASE_URL` | `postgres://user:pass@host:5432/db?sslmode=disable` | обязательна |
| `S3_ENDPOINT` | `s3:9000` | host:port без схемы, обязательна |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | | обязательны |
| `S3_BUCKET` | `photobook` | создаётся при старте, если нет |
| `S3_USE_SSL` | `false` | `true` для HTTPS-хранилища |
| `TEMPLATES_DIR` | `/app/templates` | папка шаблонов (по умолчанию `../templates`) |
