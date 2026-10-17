# Собирается из корня репозитория (см. docker-compose.yml), чтобы в образ
# попали код backend, папка templates/ и конфиг шрифтов (общий с фронтендом).

# Сборка: статические бинарники без CGO.
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

# Запуск: маленький образ; wget из busybox нужен для healthcheck в compose,
# vips-tools (libvips) — для миниатюр фото.
FROM alpine:3.24
RUN apk add --no-cache vips-tools && adduser -D -H app
COPY --from=build /out/ /app/
COPY templates/ /app/templates/
COPY frontend/src/book/fonts.json frontend/src/book/stickers.json /app/
ENV TEMPLATES_DIR=/app/templates FONTS_CONFIG=/app/fonts.json STICKERS_CONFIG=/app/stickers.json
USER app
EXPOSE 8080
ENTRYPOINT ["/app/server"]
