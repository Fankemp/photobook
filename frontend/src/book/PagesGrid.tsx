import type { Format, Page } from '../types.ts'
import { t } from '../i18n/index.ts'
import { PageView } from './PageView.tsx'

// Сетка: обе обложки и все страницы книги/шаблона с подписями.
// imageSrc и variant — как у PageView (на странице шаблона: примеры фото, вид «как на бумаге»).
type Props = {
  cover: Page
  pages: Page[]
  backCover: Page
  format: Format
  imageSrc?: (assetId: string) => string
  variant?: 'screen' | 'print'
}

export function PagesGrid({ cover, pages, backCover, format, imageSrc, variant }: Props) {
  return (
    <ul className="grid">
      <li className="grid-item">
        <PageView page={cover} format={format} imageSrc={imageSrc} variant={variant} />
        <span className="muted">{t.book.cover}</span>
      </li>
      {pages.map((page, i) => (
        <li key={page.id} className="grid-item">
          <PageView page={page} format={format} imageSrc={imageSrc} variant={variant} />
          <span className="muted">{t.book.page(i + 1)}</span>
        </li>
      ))}
      <li className="grid-item">
        <PageView page={backCover} format={format} imageSrc={imageSrc} variant={variant} />
        <span className="muted">{t.book.backCover}</span>
      </li>
    </ul>
  )
}
