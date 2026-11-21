// Обращения к Go-бэкенду. Пути относительные (/api/...): в dev их проксирует Vite.
import type { AssetInfo, Book, Order, OrderForm, OrderInfo, PrintData, Template, TemplateSummary } from './types.ts'

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

export type SaveBookBody = Pick<Book, 'version' | 'cover' | 'pages' | 'backCover'>

// keepalive: запрос доживёт, даже если вкладку закрывают (тело до 64 КБ).
export function saveBook(token: string, body: SaveBookBody, keepalive = false) {
  return request<{ version: number; updatedAt: string }>(`/api/books/${encodeURIComponent(token)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  })
}

// Загрузка фото: 1) просим ссылку, 2) кладём файл прямо в хранилище,
// 3) подтверждаем. Подробнее — backend/internal/assets.
// sha256 и takenAt (дата съёмки) необязательны. duplicate — такое фото в книге
// уже есть (assetId — его id), загружать файл не нужно.
export function startUpload(token: string, body: { contentType: string; size: number; sha256?: string; takenAt?: string }) {
  return request<{ assetId: string; uploadUrl?: string; duplicate?: boolean }>(`/api/books/${encodeURIComponent(token)}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function completeUpload(token: string, assetId: string, width: number, height: number) {
  return request<AssetInfo>(`/api/books/${encodeURIComponent(token)}/assets/${assetId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ width, height }),
  })
}

// fetch не умеет сообщать прогресс отправки, поэтому здесь XMLHttpRequest.
export function putFile(url: string, file: File, contentType: string, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError('upload_failed', xhr.status)))
    xhr.onerror = () => reject(new ApiError('upload_failed', 0))
    xhr.send(file)
  })
}

// Фото книги (лоток «Мои фото»).
export function listAssets(token: string) {
  return request<AssetInfo[]>(`/api/books/${encodeURIComponent(token)}/assets`)
}

// Удалить фото из лотка и вернуть его («Отменить»). Файл остаётся в хранилище.
export async function removeAsset(token: string, assetId: string, removed: boolean) {
  const path = `/api/books/${encodeURIComponent(token)}/assets/${assetId}`
  let res: Response
  try {
    res = await fetch(removed ? path : `${path}/restore`, { method: removed ? 'DELETE' : 'POST' })
  } catch {
    throw new ApiError('network', 0)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(typeof body?.error === 'string' ? body.error : 'internal', res.status)
  }
}

// Постоянный адрес картинки: backend перенаправит на временную ссылку в хранилище.
export function assetImageUrl(token: string, assetId: string) {
  return `/api/books/${encodeURIComponent(token)}/assets/${assetId}/image`
}

export function getOrderInfo(token: string, signal?: AbortSignal) {
  return request<OrderInfo>(`/api/books/${encodeURIComponent(token)}/order`, { signal })
}

export function createOrder(token: string, form: OrderForm) {
  return request<Order>(`/api/books/${encodeURIComponent(token)}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  })
}

// Данные для печатной страницы; query — подпись ссылки (exp, sig) от backend.
export function getPrintData(orderId: string, query: string, signal?: AbortSignal) {
  return request<PrintData>(`/api/print/${encodeURIComponent(orderId)}?${query}`, { signal })
}
