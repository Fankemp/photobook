import type { Page, PhotoSlotElement } from '../types.ts'

// Содержимое книги, которое правит редактор и сохраняет автосохранение.
export type Doc = { cover: Page; pages: Page[] }

// Адрес слота: страница + элемент. id страниц уникальны в книге (это проверяет backend).
export type SlotRef = { pageId: string; elId: string }

export const slotKey = (s: SlotRef) => `${s.pageId}/${s.elId}`

export const sameSlot = (a: SlotRef | null, b: SlotRef) => a?.pageId === b.pageId && a.elId === b.elId

export function findSlot(doc: Doc, ref: SlotRef): PhotoSlotElement | undefined {
  const page = ref.pageId === doc.cover.id ? doc.cover : doc.pages.find((p) => p.id === ref.pageId)
  const el = page?.elements.find((e) => e.id === ref.elId)
  return el?.type === 'photo_slot' ? el : undefined
}

// Неизменяемое обновление: меняется только нужная страница, остальные
// остаются теми же объектами (поэтому memo в PageView их не перерисовывает).
export function updateSlot(doc: Doc, ref: SlotRef, fn: (el: PhotoSlotElement) => PhotoSlotElement): Doc {
  const updatePage = (p: Page): Page =>
    p.id !== ref.pageId
      ? p
      : { ...p, elements: p.elements.map((e) => (e.id === ref.elId && e.type === 'photo_slot' ? fn(e) : e)) }

  return ref.pageId === doc.cover.id
    ? { ...doc, cover: updatePage(doc.cover) }
    : { ...doc, pages: doc.pages.map(updatePage) }
}
