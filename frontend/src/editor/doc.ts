import type { StickerInfo } from '../book/stickers.ts'
import type { Format, Page, PageElement, PhotoSlotElement, StickerElement, TextElement } from '../types.ts'

// Содержимое книги, которое правит редактор и сохраняет автосохранение:
// передняя обложка, страницы блока, задняя обложка.
export type Doc = { cover: Page; pages: Page[]; backCover: Page }

// Все страницы по порядку: передняя обложка, страницы, задняя обложка.
export const allPagesOf = (doc: Doc): Page[] => [doc.cover, ...doc.pages, doc.backCover]

// Адрес элемента: страница + элемент. id страниц уникальны в книге (это проверяет backend).
export type ElRef = { pageId: string; elId: string }
export type SlotRef = ElRef

export const elKey = (r: ElRef) => `${r.pageId}/${r.elId}`
export const slotKey = elKey

export const sameEl = (a: ElRef | null, b: ElRef) => a?.pageId === b.pageId && a.elId === b.elId
export const sameSlot = sameEl

// Текст, добавленный клиентом (а не из шаблона): его можно двигать по предустановленным местам.
export const USER_TEXT_PREFIX = 'ut-'
const STICKER_PREFIX = 'st-'

// Не больше элементов на странице — как pages.MaxElementsPerPage на сервере
// (лишнее сервер не сохранит). Кнопки «добавить» на полной странице выключены.
export const MAX_ELEMENTS_PER_PAGE = 50

// Новый id элемента, которого ещё нет на странице.
function newElementId(page: Page, prefix: string): string {
  let id: string
  do {
    id = prefix + Math.random().toString(36).slice(2, 8)
  } while (page.elements.some((e) => e.id === id))
  return id
}

export function findPage(doc: Doc, pageId: string): Page | undefined {
  return allPagesOf(doc).find((p) => p.id === pageId)
}

export function findElement(doc: Doc, ref: ElRef): PageElement | undefined {
  return findPage(doc, ref.pageId)?.elements.find((e) => e.id === ref.elId)
}

export function findSlot(doc: Doc, ref: ElRef): PhotoSlotElement | undefined {
  const el = findElement(doc, ref)
  return el?.type === 'photo_slot' ? el : undefined
}

// Неизменяемое обновление: меняется только нужная страница, остальные
// остаются теми же объектами (поэтому memo в PageView их не перерисовывает).
function updatePage(doc: Doc, pageId: string, fn: (p: Page) => Page): Doc {
  if (pageId === doc.cover.id) return { ...doc, cover: fn(doc.cover) }
  if (pageId === doc.backCover.id) return { ...doc, backCover: fn(doc.backCover) }
  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? fn(p) : p)) }
}

export function updateSlot(doc: Doc, ref: ElRef, fn: (el: PhotoSlotElement) => PhotoSlotElement): Doc {
  return updatePage(doc, ref.pageId, (p) => ({
    ...p,
    elements: p.elements.map((e) => (e.id === ref.elId && e.type === 'photo_slot' ? fn(e) : e)),
  }))
}

export function updateText(doc: Doc, ref: ElRef, fn: (el: TextElement) => TextElement): Doc {
  return updatePage(doc, ref.pageId, (p) => ({
    ...p,
    elements: p.elements.map((e) => (e.id === ref.elId && e.type === 'text' ? fn(e) : e)),
  }))
}

export function updateSticker(doc: Doc, ref: ElRef, fn: (el: StickerElement) => StickerElement): Doc {
  return updatePage(doc, ref.pageId, (p) => ({
    ...p,
    elements: p.elements.map((e) => (e.id === ref.elId && e.type === 'sticker' ? fn(e) : e)),
  }))
}

export function addElement(doc: Doc, pageId: string, el: PageElement): Doc {
  return updatePage(doc, pageId, (p) => ({ ...p, elements: [...p.elements, el] }))
}

export function removeElement(doc: Doc, ref: ElRef): Doc {
  return updatePage(doc, ref.pageId, (p) => ({ ...p, elements: p.elements.filter((e) => e.id !== ref.elId) }))
}

// Места для добавленного текста (в процентах страницы, внутри безопасной зоны).
// Свободного перетаскивания в MVP нет — только эти три положения.
export const TEXT_POSITIONS = { top: 8, middle: 45, bottom: 82 } as const
export type TextPosition = keyof typeof TEXT_POSITIONS
const TEXT_BOX = { x: 8, w: 84, h: 10 }

// Новый текстовый блок внизу страницы. Шрифт и цвет берём у текста,
// который уже есть на странице или на обложке, — чтобы вписался в шаблон.
export function newTextElement(doc: Doc, page: Page): TextElement {
  const sample = [...page.elements, ...doc.cover.elements].find((e): e is TextElement => e.type === 'text')
  return {
    type: 'text',
    id: newElementId(page, USER_TEXT_PREFIX),
    ...TEXT_BOX,
    y: TEXT_POSITIONS.bottom,
    text: '',
    font: sample?.font ?? 'montserrat',
    size: 14,
    color: sample?.color ?? '#000000',
    align: 'center',
  }
}

// Какое из трёх мест ближе всего к текущему положению блока.
export function textPosition(el: TextElement): TextPosition {
  let best: TextPosition = 'bottom'
  for (const pos of Object.keys(TEXT_POSITIONS) as TextPosition[]) {
    if (Math.abs(el.y - TEXT_POSITIONS[pos]) < Math.abs(el.y - TEXT_POSITIONS[best])) best = pos
  }
  return best
}

// ---------- Стикеры ----------
// В отличие от фото и текста, стикер двигается свободно (это украшение, а не
// раскладка страницы). Координаты, как у всех элементов, — проценты страницы;
// блок стикера всегда целиком на странице (это проверяет и сервер).

// Размер стикера — ширина в процентах ширины страницы.
export const STICKER_WIDTH = { min: 8, max: 60, initial: 26 } as const

type Box = { x: number; y: number; w: number; h: number }

const round2 = (v: number) => Math.round(v * 100) / 100
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

// Блок стикера шириной w (%) с центром в (cx, cy), сдвинутый внутрь страницы.
// Высота — по пропорциям рисунка (aspect = ширина / высота) и страницы:
// на неквадратном формате стикер не сплющится.
export function stickerBox(cx: number, cy: number, w: number, aspect: number, format: Format): Box {
  let h = (w * format.widthMm) / (format.heightMm * aspect)
  if (h > 100) {
    w = (w * 100) / h
    h = 100
  }
  w = round2(w)
  h = round2(h)
  return { x: round2(clamp(cx - w / 2, 0, 100 - w)), y: round2(clamp(cy - h / 2, 0, 100 - h)), w, h }
}

// Пропорции стикера: из набора, а если его там нет — по текущему блоку.
function aspectOf(el: StickerElement, sticker: StickerInfo | undefined, format: Format): number {
  return sticker?.aspect ?? (el.w * format.widthMm) / (el.h * format.heightMm)
}

// Новый стикер — в центре страницы; следующие чуть сдвинуты, чтобы не лечь
// ровно друг на друга.
export function newStickerElement(page: Page, sticker: StickerInfo, format: Format): StickerElement {
  const shift = (page.elements.filter((e) => e.type === 'sticker').length % 5) * 6
  return {
    type: 'sticker',
    id: newElementId(page, STICKER_PREFIX),
    ...stickerBox(50 + shift, 50 + shift, STICKER_WIDTH.initial, sticker.aspect, format),
    stickerId: sticker.id,
    rotation: 0,
  }
}

// Сдвинуть левый верхний угол в (x, y), не выходя за страницу.
export function moveSticker(el: StickerElement, x: number, y: number): StickerElement {
  return { ...el, x: round2(clamp(x, 0, 100 - el.w)), y: round2(clamp(y, 0, 100 - el.h)) }
}

// Новая ширина с тем же центром.
export function resizeSticker(el: StickerElement, w: number, sticker: StickerInfo | undefined, format: Format): StickerElement {
  const aspect = aspectOf(el, sticker, format)
  return { ...el, ...stickerBox(el.x + el.w / 2, el.y + el.h / 2, w, aspect, format) }
}

// Поворот в градусах (−180…180). Около нуля «прилипает» к ровному положению.
export function rotateSticker(el: StickerElement, deg: number): StickerElement {
  const r = clamp(Math.round(deg), -180, 180)
  return { ...el, rotation: Math.abs(r) <= 3 ? 0 : r }
}
