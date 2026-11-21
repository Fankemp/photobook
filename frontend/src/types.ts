// Типы данных API. Повторяют Go-структуры (backend/internal/pages, formats, templates, books).

export type Format = {
  id: string
  name: string
  widthMm: number
  heightMm: number
  bleedMm: number
  safeMm: number
  // Страницы блока (без обложек): pages — у новой книги; клиент меняет число
  // сам, листами по pageStep, от minPages до maxPages (см. editor/pages.ts).
  pages: number
  minPages: number
  maxPages: number
  pageStep: number
  minDpi: number
  targetDpi: number
  priceKzt: number // цена книги с pages страниц
  pricePerPageKzt: number // доплата за страницу сверх pages (меньше страниц — скидка)
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
  shape?: 'heart' // форма рамки; нет поля — прямоугольник
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
  background: string // цвет страницы (и вылета)
  backgroundImage?: string // узор поверх цвета — id из book/backgrounds.json
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

// Загруженное фото (лоток «Мои фото»), в порядке загрузки. Размеры — с учётом
// поворота, как фото видит человек.
export type AssetInfo = {
  id: string
  width: number
  height: number
  takenAt?: string // дата съёмки из EXIF, «2023-07-15T14:22:01»
  sha256?: string // хеш файла — не загружать одно фото дважды
  removed?: boolean // удалено из лотка; страницы ещё могут на него ссылаться
  viewable: boolean // картинку уже можно показать (у HEIC — когда готова миниатюра)
}

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

// confirmed — галочка «Я проверил(а) тексты и фото»: без неё сервер заявку не примет.
export type OrderForm = Pick<Order, 'name' | 'phone' | 'address' | 'wantedDate' | 'comment'> & { version: number; confirmed: boolean }

// Данные для печатной страницы (/print/…): книга и ссылки на оригиналы фото.
export type PrintData = { format: Format; cover: Page; pages: Page[]; backCover: Page; images: Record<string, string> }
