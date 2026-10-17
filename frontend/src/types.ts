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
  pdfMode: 'single' | 'split' // печатный PDF: один файл или обложки и страницы отдельно
  pdfOrder: string // порядок частей PDF: front,pages,back
}

// Координаты — проценты от страницы по линии реза (0–100). Текст клиент двигает
// свободно, и его блок может частично выходить за страницу (x < 0 или x + w > 100).
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
  rotation?: number // градусы по часовой стрелке вокруг центра блока, −180…180; нет — 0
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

export type Template = TemplateSummary & { pages: Page[]; backCover: Page }

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
  cover: Page // передняя обложка
  pages: Page[] // страницы блока
  backCover: Page // задняя обложка
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
export type PrintData = { format: Format; cover: Page; pages: Page[]; backCover: Page; images: Record<string, string> }
