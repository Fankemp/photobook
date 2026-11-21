import { t } from '../i18n/index.ts'

// Номер страницы во всей книге: 0 — обложка, last — задняя обложка, между ними
// внутренние страницы 1…N (так же нумеруют редактор ?page=N, превью и заявка).
// Раньше это условие было переписано в каждом экране; теперь одно место.
export type PageWords = { cover: string; back: string; page: (n: number) => string }

export function pageLabel(index: number, last: number, words: PageWords): string {
  if (index === 0) return words.cover
  if (index === last) return words.back
  return words.page(index)
}

// Наборы слов для разных мест интерфейса.
export const PAGE_NAMES: PageWords = { cover: t.book.cover, back: t.book.backCover, page: t.book.page } // «Страница 3»
export const PAGE_LINKS: PageWords = { cover: t.preview.coverLink, back: t.preview.backLink, page: t.preview.pageLink } // «стр. 3»
export const PAGE_SHORT: PageWords = { cover: t.editor.coverShort, back: t.editor.backShort, page: String } // лента миниатюр
// «Страница 3 из 16» — total внутренних страниц.
export const pageOfWords = (total: number): PageWords => ({ ...PAGE_NAMES, page: (n) => t.editor.pageOf(n, total) })
