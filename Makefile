.PHONY: up down logs ps psql migrate-status migrate-up migrate-down test

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
