import { useState } from 'react'
import { Link } from 'react-router'
import { assetImageUrl } from '../api.ts'
import { pageLabel, pageOfWords } from '../book/pageLabel.ts'
import { PageView } from '../book/PageView.tsx'
import { HomeMark } from '../components/Site.tsx'
import { t } from '../i18n/index.ts'
import type { Book } from '../types.ts'
import { allPagesOf } from './doc.ts'
import './Editor.css'

// Книга в печати (заказ printing и дальше): вместо редактора — только просмотр
// с понятным сообщением. Автосохранение не запускается, черновик на устройстве
// не трогается, показывается ровно то, что на сервере (то есть в печати).
export function ReadOnlyBook({ book, initialPage = 0 }: { book: Book; initialPage?: number }) {
  const pages = allPagesOf(book)
  const last = pages.length - 1
  const [index, setIndex] = useState(() => Math.max(0, Math.min(last, initialPage)))
  const name = pageLabel(index, last, pageOfWords(book.pages.length))

  return (
    <div className="editor ed-readonly">
      <header className="ed-header">
        <HomeMark label={t.editor.back} />
        <div className="ed-title">
          <h1>{t.editor.title}</h1>
        </div>
        <Link to={`/b/${book.token}/order`} className="btn ed-preview-link">
          {t.editor.orderLink}
        </Link>
      </header>
      <div className="ed-banner" role="status">
        <p>{t.editor.inPrint}</p>
      </div>
      <div className="ed-stage">
        {/* Как на бумаге: пустые рамки не печатаются. */}
        <div className="ed-page">
          <PageView page={pages[index]} format={book.format} imageSrc={(id) => assetImageUrl(book.token, id)} variant="print" />
        </div>
      </div>
      <nav className="ed-pager">
        <button className="btn" onClick={() => setIndex(index - 1)} disabled={index === 0} aria-label={t.editor.prevPage}>
          ‹
        </button>
        <span>{name}</span>
        <button className="btn" onClick={() => setIndex(index + 1)} disabled={index === last} aria-label={t.editor.nextPage}>
          ›
        </button>
      </nav>
    </div>
  )
}
