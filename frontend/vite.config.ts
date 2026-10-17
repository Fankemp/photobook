import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Запросы /api/* и /admin/* dev-сервер Vite пересылает на Go-бэкенд, поэтому фронт и API
// живут на одном адресе и CORS не нужен. В Docker бэкенд доступен по имени
// сервиса (задаётся в docker-compose), при локальном запуске — на localhost.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // слушать все интерфейсы, иначе из Docker-контейнера не достучаться
    port: 5173,
    strictPort: true,
    // Vite по умолчанию пускает только localhost и IP-адреса. Добавляем:
    // frontend — так сайт открывает сервис рендера внутри Docker;
    // .trycloudflare.com — временная ссылка из интернета (make share).
    allowedHosts: ['frontend', '.trycloudflare.com'],
    proxy: {
      '/api': apiTarget,
      '/admin': apiTarget, // админка — HTML-страницы, которые отдаёт сам Go-сервер
    },
  },
})
