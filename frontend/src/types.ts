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
  spineMm: number // корешок обложки (пока 0)
  wrapMm: number // загиб обложки на картон с каждой стороны (пока 0)
}

// Координаты — проценты от страницы по линии реза (0–100).
type ElementBase = {
  id: string
  x: number
  y: number
  w: number
  h: number
}

// Кадр фото в слоте, подробности — в book/crop.ts.
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

// Загруженное фото. Размеры — с учётом поворота, как фото видит человек.
export type AssetInfo = { id: string; width: number; height: number }

export type Book = {
  token: string
  templateId: string
  formatId: string
  schemaVersion: number
  version: number // растёт при каждом сохранении; см. автосохранение
  format: Format
  assets: AssetInfo[]
  order: { number: number; status: OrderStatus } | null // есть заявка — книга закрыта для изменений
  cover: Page
  pages: Page[]
  createdAt: string
  updatedAt: string
}

export type OrderStatus = 'new' | 'awaiting_prepayment' | 'paid' | 'printing' | 'delivery' | 'done' | 'cancelled'

export type Order = {
  number: number
  name: string
  phone: string // +77001234567
  address: string
  wantedDate: string // YYYY-MM-DD
  comment: string
  status: OrderStatus
  priceKzt: number
  createdAt: string
}

// Для страницы заявки: заявка (если уже есть) или данные для формы.
export type OrderInfo = { order: Order | null; minWantedDate: string; priceKzt: number }

export type OrderForm = Pick<Order, 'name' | 'phone' | 'address' | 'wantedDate' | 'comment'> & { version: number }

// Данные для печатной страницы (/print/…): книга и ссылки на оригиналы фото.
export type PrintData = { format: Format; cover: Page; pages: Page[]; images: Record<string, string> }
