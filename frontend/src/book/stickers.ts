import config from './stickers.json'

// Стикеры — наши SVG-рисунки в frontend/public/stickers (начальный набор рисует
// tools/stickers/generate.py). Список — в stickers.json, общий с backend: он
// проверяет, что стикер в книге существует. Добавить стикер = положить SVG
// и добавить строку в конфиг. Удалять стикер из конфига нельзя, пока он есть
// в шаблонах и книгах: такие книги перестанут сохраняться.
//
// SVG — вектор: на печати стикер чёткий при любом размере, в PDF остаётся вектором.

export type StickerInfo = {
  id: string
  name: string // как видит пользователь (подпись для экранного диктора)
  file: string // путь внутри /stickers
  aspect: number // ширина / высота рисунка
}

export type StickerSet = { id: string; name: string; stickers: StickerInfo[] }

export const STICKER_SETS = config.sets as StickerSet[]

const byId = new Map(STICKER_SETS.flatMap((set) => set.stickers.map((s) => [s.id, s] as const)))

export function stickerById(id: string): StickerInfo | undefined {
  return byId.get(id)
}

export function stickerUrl(s: StickerInfo): string {
  return `/stickers/${s.file}`
}
