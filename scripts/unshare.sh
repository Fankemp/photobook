#!/usr/bin/env bash
# Закрыть временный доступ из интернета (см. share.sh) и вернуть локальные адреса.
set -euo pipefail
cd "$(dirname "$0")/.."
docker rm -f photobook-tunnel-site photobook-tunnel-s3 >/dev/null 2>&1 || true
docker compose up -d backend >/dev/null 2>&1
echo "Доступ из интернета закрыт, сайт снова только на http://localhost:5173"
