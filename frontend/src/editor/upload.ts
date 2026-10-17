import { ApiError, completeUpload, putFile, startUpload } from '../api.ts'

export const ACCEPT = 'image/jpeg,image/png'
const MAX_BYTES = 25 * 1024 * 1024 // как на сервере (assets.MaxSizeBytes)

// Проверка до загрузки: сразу сказать «не тот файл», а не ждать отказа сервера.
// Возвращает код ошибки для словаря или null.
export function checkFile(file: File): string | null {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return 'unsupported_type'
  if (file.size > MAX_BYTES) return 'file_too_large'
  return null
}

export type Size = { width: number; height: number }

// Размеры фото так, как его показывает браузер, то есть с учётом поворота
// из EXIF (фото с телефона часто хранятся «лёжа» с пометкой «повернуть»).
export function readImageSize(url: string): Promise<Size> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new ApiError('bad_image', 0))
    img.src = url
  })
}

// Загрузка в три шага (см. api.ts). Возвращает id фото.
export async function uploadPhoto(token: string, file: File, size: Size, onProgress: (f: number) => void) {
  const { assetId, uploadUrl } = await startUpload(token, file.type, file.size)
  await putFile(uploadUrl, file, onProgress)
  await completeUpload(token, assetId, size.width, size.height)
  return assetId
}
