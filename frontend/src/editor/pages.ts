import { pageHasContent } from '../book/spreads.ts'
import type { Format, Page, PageElement } from '../types.ts'
import type { Doc } from './doc.ts'

// Страницы блока клиент удаляет и добавляет листами по format.pageStep штук:
// у листа две стороны, и при шаге 2 вместе уходят, например, страницы 5 и 6.
// Так число страниц всегда кратно шагу, как требует типография, и «неправильной»
// книги не бывает ни в автосохранении, ни в заявке, ни в PDF. Пределы —
// format.minPages…maxPages; все числа — из формата, не из кода.
// Обложки сюда не входят: они не удаляются и не считаются.

// Лист, на котором стоит страница index (с 0): страницы [start, end).
export function leafOf(index: number, step: number): { start: number; end: number } {
  const start = Math.floor(index / step) * step
  return { start, end: start + step }
}

export const canRemove = (count: number, f: Format) => count - f.pageStep >= f.minPages
export const canAdd = (count: number, f: Format) => count + f.pageStep <= f.maxPages

// Есть ли на странице то, что жалко потерять (фото, текст, стикер) — тогда перед
// удалением спрашиваем.
export const hasContent = pageHasContent

// Что удалили и откуда — чтобы «Отменить» вернул страницы на то же место.
export type Removed = { at: number; pages: Page[] }

export function removeLeaf(doc: Doc, index: number, step: number): { doc: Doc; removed: Removed } {
  const { start, end } = leafOf(index, step)
  const stop = Math.min(end, doc.pages.length)
  return {
    doc: { ...doc, pages: [...doc.pages.slice(0, start), ...doc.pages.slice(stop)] },
    removed: { at: start, pages: doc.pages.slice(start, stop) },
  }
}

export function restoreLeaf(doc: Doc, r: Removed): Doc {
  const at = Math.min(r.at, doc.pages.length)
  return { ...doc, pages: [...doc.pages.slice(0, at), ...r.pages, ...doc.pages.slice(at)] }
}

// Новый id страницы, которого ещё нет в книге (сервер требует уникальные id).
function newPageId(taken: Set<string>): string {
  let id: string
  do {
    id = 'pg-' + Math.random().toString(36).slice(2, 8)
  } while (taken.has(id))
  taken.add(id)
  return id
}

// Новая страница — устройство страницы-образца без содержимого: тот же фон,
// те же рамки для фото (пустые) и места для подписей из шаблона (пустые).
// Стикеры и текст, добавленный клиентом (id с «ut-»), не копируются.
export function blankCopy(p: Page, id: string): Page {
  return {
    id,
    background: p.background,
    elements: p.elements.flatMap((el): PageElement[] => {
      if (el.type === 'photo_slot') return [{ ...el, assetId: null, crop: { zoom: 1, offsetX: 0, offsetY: 0 } }]
      if (el.type === 'text' && !el.id.startsWith('ut-')) return [{ ...el, text: '' }]
      return []
    }),
  }
}

// Вставить лист (pageStep новых страниц) на место at: страницы — копии
// устройства образцов (по кругу, если образцов меньше шага).
export function insertLeaf(doc: Doc, at: number, step: number, samples: Page[]): Doc {
  const taken = new Set([doc.cover.id, doc.backCover.id, ...doc.pages.map((p) => p.id)])
  const fresh = Array.from({ length: step }, (_, i) => blankCopy(samples[i % samples.length], newPageId(taken)))
  return { ...doc, pages: [...doc.pages.slice(0, at), ...fresh, ...doc.pages.slice(at)] }
}

// Ближайшие допустимые числа страниц: после удаления листа и после добавления.
export function nextCounts(count: number, f: Format): { down: number | null; up: number | null } {
  return {
    down: canRemove(count, f) ? count - f.pageStep : null,
    up: canAdd(count, f) ? count + f.pageStep : null,
  }
}
