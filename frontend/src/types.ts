// Типы данных API. Повторяют Go-структуры (backend/internal/pages, formats, templates, books).

export type Format = {
  id: string
  name: string
  widthMm: number
  heightMm: number
  bleedMm: number
  safeMm: number
  pages: number // внутренние страницы, без обложки
  minDpi: number
  targetDpi: number
  priceKzt: number
}

// Координаты — проценты от страницы по линии реза (0–100).
type ElementBase = {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export type Crop = { zoom: number; offsetX: number; offsetY: number }

export type PhotoSlotElement = ElementBase & {
  type: 'photo_slot'
  assetId?: string | null // нет поля или null — слот пустой
  crop?: Crop
}

export type TextElement = ElementBase & {
  type: 'text'
  text: string
  font: string // id шрифта
  size: number // кегль в пунктах на напечатанной странице
  color?: string
  align: 'left' | 'center' | 'right'
  bold?: boolean
}

export type StickerElement = ElementBase & {
  type: 'sticker'
  stickerId: string
  rotation?: number
}

// Discriminated union: TypeScript по полю type понимает, какие ещё поля есть у элемента.
export type PageElement = PhotoSlotElement | TextElement | StickerElement

export type Page = {
  id: string
  background: string
  elements: PageElement[]
}

export type TemplateSummary = {
  id: string
  name: string
  occasion: string
  preview?: string
  format: Format
  pageCount: number
  cover: Page
}

export type Template = TemplateSummary & { pages: Page[] }

export type Book = {
  token: string
  templateId: string
  formatId: string
  schemaVersion: number
  format: Format
  cover: Page
  pages: Page[]
  createdAt: string
  updatedAt: string
}
