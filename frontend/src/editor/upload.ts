import { completeUpload, putFile, startUpload } from '../api.ts'
import type { AssetInfo } from '../types.ts'
import { readTakenAt } from './exif.ts'
import config from './uploads.json'

// Ограничения загрузки — общий конфиг с backend (uploads.json): размер файла,
// фото в книге, форматы. Только фронтенду: сколько файлов за раз, сколько
// загружать параллельно и сколько раз повторять при сбое.
export const LIMITS = {
  maxFileMb: config.maxFileMb,
  maxFilesPerBatch: config.maxFilesPerBatch,
  maxPerBook: config.maxPerBook,
  parallel: config.parallel,
  retries: config.retries,
}
const TYPES: Record<string, string> = config.types

// Окно выбора файлов: любые фото (на телефоне — галерея с выбором нескольких),
// плюс .heic/.heif явно — на Windows браузер иначе может их не показать.
export const ACCEPT = 'image/*,.heic,.heif'

// Тип файла. Для HEIC браузеры на Windows и Linux часто не знают типа
// (пустая строка) — определяем по расширению.
export function fileType(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type
  const ext = file.name.toLowerCase().split('.').pop()
  return ext === 'heic' ? 'image/heic' : ext === 'heif' ? 'image/heif' : ''
}

// Проверка до загрузки: сразу сказать «не тот файл», а не ждать отказа сервера.
// Возвращает код ошибки для словаря или null.
export function checkFile(file: File): string | null {
  if (!TYPES[fileType(file)]) return 'unsupported_type'
  if (file.size > LIMITS.maxFileMb * 1024 * 1024) return 'file_too_large'
  return null
}

export type Size = { width: number; height: number }

const PREVIEW_PX = 1024 // локальное превью по длинной стороне

// Локальное превью: уменьшенная копия фото (JPEG до 1024 px) и размеры
// оригинала так, как его показывает браузер — с учётом поворота из EXIF
// (фото с телефона часто хранятся «лёжа» с пометкой «повернуть»).
// Уменьшаем, потому что фото в лотке может быть 60 и больше: в полном размере
// (12 Мп — около 48 МБ памяти каждое) телефон бы не справился.
// null — браузер не умеет открыть файл (HEIC в Chrome): размеры узнает сервер.
export async function localPreview(file: File): Promise<(Size & { url: string }) | null> {
  const src = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const size = { width: img.naturalWidth, height: img.naturalHeight }
    const scale = Math.min(1, PREVIEW_PX / Math.max(size.width, size.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(size.width * scale))
    canvas.height = Math.max(1, Math.round(size.height * scale))
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    return blob ? { url: URL.createObjectURL(blob), ...size } : null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(src)
  }
}

// HEIC/HEIF открывает не всякий браузер — это не ошибка файла.
export const isHeif = (file: File) => fileType(file) === 'image/heic' || fileType(file) === 'image/heif'

// SHA-256 файла — чтобы не загружать одно фото дважды. Браузер даёт его только
// на https и localhost; без него сравниваем имя и размер (см. uploadQueue.ts).
export async function fileHash(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type Uploaded = { info: AssetInfo; duplicate: boolean }

// Загрузка в три шага (см. api.ts). size — размеры, если браузер смог открыть
// фото (HEIC открывают не все — тогда размеры узнает сервер).
// Если такое же фото в книге уже есть, сервер так и скажет — файл не грузим.
export async function uploadPhoto(token: string, file: File, size: Size | null, sha256: string | null, onProgress: (f: number) => void): Promise<Uploaded> {
  const type = fileType(file)
  const takenAt = await readTakenAt(file)
  const start = await startUpload(token, { contentType: type, size: file.size, sha256: sha256 ?? undefined, takenAt: takenAt ?? undefined })
  if (start.duplicate || !start.uploadUrl) {
    return { info: { id: start.assetId, width: 0, height: 0, viewable: true }, duplicate: true }
  }
  await putFile(start.uploadUrl, file, type, onProgress)
  const info = await completeUpload(token, start.assetId, size?.width ?? 0, size?.height ?? 0)
  return { info: { ...info, sha256: sha256 ?? undefined, takenAt: info.takenAt ?? takenAt ?? undefined }, duplicate: false }
}
