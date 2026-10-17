// Обращения к Go-бэкенду. Пути относительные (/api/...): в dev их проксирует Vite.
import type { Book, Template, TemplateSummary } from './types.ts'

// Ошибка API с машинным кодом ("book_not_found", "network", ...).
// Текст для человека подбирается по коду из словаря (см. ErrorMessage).
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number) {
    super(`api error: ${code} (HTTP ${status})`)
    this.code = code
    this.status = status
  }
}

export function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('internal', 0)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (err) {
    // Отмена запроса (уход со страницы) — пробрасываем как есть, это не ошибка сети.
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError('network', 0)
  }
  if (!res.ok) {
    // Бэкенд отвечает {"error": "код"}; если тело не JSON (например, прокси
    // не достучался до бэкенда), считаем ошибку внутренней.
    const body = await res.json().catch(() => null)
    const code = typeof body?.error === 'string' ? body.error : 'internal'
    throw new ApiError(code, res.status)
  }
  return res.json() as Promise<T>
}

export function listTemplates(signal?: AbortSignal) {
  return request<TemplateSummary[]>('/api/templates', { signal })
}

export function getTemplate(id: string, signal?: AbortSignal) {
  return request<Template>(`/api/templates/${encodeURIComponent(id)}`, { signal })
}

export function createBook(templateId: string) {
  return request<{ token: string }>('/api/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId }),
  })
}

export function getBook(token: string, signal?: AbortSignal) {
  return request<Book>(`/api/books/${encodeURIComponent(token)}`, { signal })
}
