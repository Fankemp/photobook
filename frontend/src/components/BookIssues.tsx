import { Link } from 'react-router'
import { hasIssues, type BookIssues as Issues } from '../book/spreads.ts'
import { t } from '../i18n/index.ts'

// Что стоит поправить перед печатью: пустые рамки и маленькие фото.
// Номера страниц — ссылки сразу на нужную страницу в редакторе.
// Используется в превью и на странице заявки.
// pageCount — страниц блока: номер pageCount+1 — задняя обложка.
export function BookIssues({ issues, token, pageCount }: { issues: Issues; token: string; pageCount: number }) {
  if (!hasIssues(issues)) {
    return <p className="book-ready">{t.preview.ready}</p>
  }
  return (
    <section className="book-issues">
      {issues.lowDpi.length > 0 && (
        <IssueLine text={t.preview.lowDpi} pages={issues.lowDpi} token={token} back={pageCount + 1} />
      )}
      {issues.emptySlots.length > 0 && (
        <IssueLine text={t.preview.emptySlots} pages={issues.emptySlots} token={token} back={pageCount + 1} />
      )}
    </section>
  )
}

// Первые несколько страниц ссылками, остальные — числом: на телефоне длинный
// список занял бы пол-экрана.
const MAX_LINKS = 6

function IssueLine({ text, pages, token, back }: { text: string; pages: number[]; token: string; back: number }) {
  const rest = pages.length - MAX_LINKS
  return (
    <p>
      {text}{' '}
      {pages.slice(0, MAX_LINKS).map((n, i) => (
        <span key={n}>
          {i > 0 && ', '}
          <Link to={`/b/${token}?page=${n}`}>
            {n === 0 ? t.preview.coverLink : n === back ? t.preview.backLink : t.preview.pageLink(n)}
          </Link>
        </span>
      ))}
      {rest > 0 && ` ${t.preview.more(rest)}`}
    </p>
  )
}
