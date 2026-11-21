import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { getBook } from '../api.ts'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { allPagesOf } from '../editor/doc.ts'
import { restoreDoc } from '../editor/draft.ts'
import { t } from '../i18n/index.ts'
import { useLoad } from '../lib/useLoad.ts'
import type { Book } from '../types.ts'
import './OrderScreen.css'

// «Все подписи книги»: тексты всех страниц списком — проверить опечатки разом.
// Страница — ссылка в редактор на неё (/b/<токен>?page=N).
export function TextsScreen() {
  const { token = '' } = useParams()
  const book = useLoad(token, (signal) => getBook(token, signal))
  return (
    <main className="page order texts">
      <header className="pp-header">
        <Link to={`/b/${token}/order`} className="ed-back" aria-label={t.texts.back}>
          ←
        </Link>
        <h1>{t.texts.title}</h1>
      </header>
      {book.status === 'loading' && <p>{t.loading}</p>}
      {book.status === 'error' && <ErrorMessage error={book.error} />}
      {book.status === 'ok' && <TextsList book={book.data} />}
    </main>
  )
}

function TextsList({ book }: { book: Book }) {
  // Книга как в редакторе на этом устройстве (с несохранённым черновиком).
  const pages = useMemo(() => allPagesOf(restoreDoc(book).doc), [book])
  const last = pages.length - 1
  const withTexts = pages
    .map((p, i) => ({ i, texts: p.elements.filter((el) => el.type === 'text') }))
    .filter((p) => p.texts.length > 0)

  if (withTexts.length === 0) return <p className="muted">{t.texts.none}</p>
  return (
    <>
      <p className="muted">{t.texts.intro}</p>
      <ol className="texts-list">
        {withTexts.map(({ i, texts }) => (
          <li key={i}>
            <Link to={`/b/${book.token}?page=${i}`} className="texts-page">
              {i === 0 ? t.book.cover : i === last ? t.book.backCover : t.book.page(i)}
            </Link>
            <ul>
              {texts.map((el) => (
                <li key={el.id} className={el.text.trim() ? undefined : 'muted'} lang="ru">
                  {el.text.trim() ? el.text : t.texts.empty}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </>
  )
}
