import type { Format, Page } from '../types.ts'
import { t } from '../i18n/index.ts'
import { PageView } from './PageView.tsx'

// Сетка: обе обложки и все страницы книги/шаблона с подписями.
type Props = { cover: Page; pages: Page[]; backCover: Page; format: Format }

export function PagesGrid({ cover, pages, backCover, format }: Props) {
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
      <li className="grid-item">
        <PageView page={backCover} format={format} />
        <span className="muted">{t.book.backCover}</span>
      </li>
    </ul>
  )
}
