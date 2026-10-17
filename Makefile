.PHONY: up down logs ps psql migrate-status migrate-up migrate-down test e2e

# Создать .env из шаблона, если его ещё нет.
.env:
	cp .env.example .env

up: .env ## Собрать и запустить всё в фоне
	docker compose up --build -d

down: ## Остановить (данные сохраняются)
	docker compose down

logs: ## Логи всех сервисов
	docker compose logs -f

ps: ## Статус сервисов
	docker compose ps

psql: ## Консоль PostgreSQL
	docker compose exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

migrate-status: ## Какие миграции применены
	docker compose exec backend /app/migrate status

migrate-up: ## Применить новые миграции (сервер делает это и сам при старте)
	docker compose exec backend /app/migrate up

migrate-down: ## Откатить последнюю миграцию
	docker compose exec backend /app/migrate down

test: ## Тесты backend + проверка типов и сборка frontend
	cd backend && go vet ./... && go test ./...
	cd frontend && npm run lint && npm run build

# Браузер (Chromium) в Docker-образе Playwright; первый запуск скачает образ ~3.6 ГБ
# (он же понадобится для печатного PDF). --network host — чтобы видеть localhost.
PLAYWRIGHT_IMAGE := mcr.microsoft.com/playwright:v1.64.1-noble

e2e: ## Сквозной тест в браузере (сервисы должны быть запущены: make up)
	docker run --rm --network host -u $$(id -u):$$(id -g) -e HOME=/tmp \
		-v $(CURDIR)/e2e:/work -w /work $(PLAYWRIGHT_IMAGE) \
		sh -c "npm ci --silent --no-audit --no-fund && node editor.mjs"
