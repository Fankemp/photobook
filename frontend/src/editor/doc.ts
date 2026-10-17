import type { Page, PageElement, PhotoSlotElement, TextElement } from '../types.ts'

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
  let id: string
  do {
    id = USER_TEXT_PREFIX + Math.random().toString(36).slice(2, 8)
  } while (page.elements.some((e) => e.id === id))
  return {
    type: 'text',
    id,
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
