import type { Format, Page } from '../types.ts'
import { t } from '../i18n/index.ts'
import { PageView } from './PageView.tsx'

// Сетка: обложка и все страницы книги/шаблона с подписями.
export function PagesGrid({ cover, pages, format }: { cover: Page; pages: Page[]; format: Format }) {
  return (
    <ul className="grid">
      <li className="grid-item">
        <PageView page={cover} format={format} />
        <span className="muted">{t.book.cover}</span>
      </li>
      {pages.map((page, i) => (
        <li key={page.id} className="grid-item">
          <PageView page={page} format={format} />
          <span className="muted">{t.book.page(i + 1)}</span>
        </li>
      ))}
    </ul>
  )
}
