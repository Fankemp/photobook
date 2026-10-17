import type { Format, Page } from '../types.ts'
import { isLowDpi, type ImageSize } from './dpi.ts'

// Разворот в превью: обложка отдельно или две внутренние страницы рядом.
// left/right — индексы в массиве pages (0 — это «Страница 1»), null — пустая сторона.
export type Spread = { kind: 'cover' } | { kind: 'pages'; left: number | null; right: number | null }

// Раскладка как у большинства фотокниг в твёрдой обложке: страница 1 справа
// (слева — внутренняя сторона обложки), дальше парами 2–3, 4–5…, последняя
// чётная страница — слева. Если у типографии окажется иначе — менять здесь.
export function bookSpreads(pageCount: number): Spread[] {
  const out: Spread[] = [{ kind: 'cover' }]
  if (pageCount === 0) return out
  out.push({ kind: 'pages', left: null, right: 0 })
  for (let i = 1; i < pageCount; i += 2) {
    out.push({ kind: 'pages', left: i, right: i + 1 < pageCount ? i + 1 : null })
  }
  return out
}

// Что мешает напечатать книгу хорошо. Номера страниц: 0 — обложка, 1..N — страницы.
export type BookIssues = { lowDpi: number[]; emptySlots: number[] }

export function hasIssues(issues: BookIssues) {
  return issues.lowDpi.length > 0 || issues.emptySlots.length > 0
}

export function findIssues(cover: Page, pages: Page[], format: Format, sizes: Map<string, ImageSize>): BookIssues {
  const issues: BookIssues = { lowDpi: [], emptySlots: [] }
  ;[cover, ...pages].forEach((page, n) => {
    let low = false
    let empty = false
    for (const el of page.elements) {
      if (el.type !== 'photo_slot') continue
      const size = el.assetId ? sizes.get(el.assetId) : undefined
      if (!el.assetId) empty = true
      else if (size && isLowDpi(el, format, size)) low = true
    }
    if (low) issues.lowDpi.push(n)
    if (empty) issues.emptySlots.push(n)
  })
  return issues
}
