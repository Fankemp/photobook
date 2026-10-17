#!/usr/bin/env bash
# Временный доступ к локальному сайту из интернета — показать сайт кому-то
# (например, на тест). Cloudflare Quick Tunnel: бесплатно, без аккаунта,
# ссылка случайная и меняется при каждом запуске. Компьютер должен быть включён.
#
# Туннелей два: сайт (порт 5173) и хранилище фото (9000) — браузер загружает
# фото прямо в хранилище, поэтому ему тоже нужен публичный адрес.
# Закрыть доступ: make unshare.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=cloudflare/cloudflared:2026.9.3
SITE_PORT=$(grep -s '^FRONTEND_PORT=' .env | cut -d= -f2-); SITE_PORT=${SITE_PORT:-5173}
S3_PORT=$(grep -s '^S3_PORT=' .env | cut -d= -f2-); S3_PORT=${S3_PORT:-9000}

tunnel_url() { # имя контейнера → его публичный адрес (пусто, если туннеля нет)
  docker logs "$1" 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 || true
}

start_tunnel() { # имя, локальный порт → печатает публичный адрес
  # Туннель уже открыт — используем его: ссылка у тех, кому её отправили, не меняется.
  if [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ] && [ -n "$(tunnel_url "$1")" ]; then
    tunnel_url "$1"
    return
  fi
  docker rm -f "$1" >/dev/null 2>&1 || true
  docker run -d --name "$1" --network host "$IMAGE" tunnel --no-autoupdate --url "http://localhost:$2" >/dev/null
  for _ in $(seq 1 60); do
    url=$(tunnel_url "$1")
    if [ -n "$url" ]; then echo "$url"; return; fi
    sleep 1
  done
  echo "не удалось открыть туннель $1, см.: docker logs $1" >&2
  exit 1
}

echo "Открываю туннели (до минуты)…"
SITE=$(start_tunnel photobook-tunnel-site "$SITE_PORT")
S3=$(start_tunnel photobook-tunnel-s3 "$S3_PORT")

# Публичные адреса — в .env отдельным блоком: так их сохранит любой перезапуск
# backend (make up, пересборка), пока доступ открыт. make unshare блок удалит.
sed -i '/^# >>> make share/,/^# <<< make share/d' .env
cat >> .env <<ENV
# >>> make share (временный доступ из интернета; удалит make unshare)
SHARE_SITE_URL=$SITE
SHARE_S3_HOST=${S3#https://}
SHARE_S3_SSL=true
# <<< make share
ENV

# Backend перезапускается с публичными адресами: ссылки на фото — на туннель
# хранилища, загрузка из браузера разрешена с адреса сайта (CORS).
docker compose up -d backend >/dev/null 2>&1
for _ in $(seq 1 60); do curl -sf "localhost:${BACKEND_PORT:-8080}/api/health" >/dev/null && break; sleep 1; done

# Туннелю нужно несколько секунд, чтобы адрес заработал по всему миру.
for _ in $(seq 1 30); do curl -sf -o /dev/null "$SITE/" && break; sleep 2; done

cat <<MSG

Сайт открыт из интернета:

    $SITE

Отправьте эту ссылку. Работает, пока включён компьютер и запущен make up.
После перезагрузки компьютера туннели закрыты: снова make share (ссылка будет новой) или make unshare.
Админка (только для вас): $SITE/admin/  — логин admin, пароль ADMIN_PASSWORD из .env.
Закрыть доступ: make unshare
MSG
