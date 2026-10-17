// Обращения к Go-бэкенду. Пути относительные (/api/...): в dev их проксирует Vite.

export type Health = {
  status: 'ok' | 'error'
  checks: Record<string, 'ok' | 'error'>
}

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch('/api/health', { signal })
  // 503 — тоже валидный ответ: бэкенд жив, но какая-то зависимость упала.
  if (res.status !== 200 && res.status !== 503) {
    throw new Error(`health: HTTP ${res.status}`)
  }
  return res.json() as Promise<Health>
}
