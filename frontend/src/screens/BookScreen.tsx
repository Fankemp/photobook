import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getBook } from '../api.ts'
import { PagesGrid } from '../book/PagesGrid.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { t } from '../i18n/index.ts'
import { forgetLastBook, saveLastBook } from '../lib/lastBook.ts'
import { useLoad } from '../lib/useLoad.ts'

// Книга клиента по секретной ссылке /b/<токен>. На шаге 3 здесь появится редактор.
export function BookScreen() {
  const { token = '' } = useParams()
  const book = useLoad(token, (signal) => getBook(token, signal))

  // Запоминаем книгу для кнопки «Продолжить» на главной; битую ссылку — забываем.
  useEffect(() => {
    if (book.status === 'ok') saveLastBook(token)
    if (book.status === 'error' && book.error.code === 'book_not_found') forgetLastBook(token)
  }, [book, token])

  return (
    <main className="page">
      {book.status === 'loading' && <p>{t.loading}</p>}
      {book.status === 'error' && (
        <>
          <ErrorMessage error={book.error} />
          <Link to="/">{t.book.toCatalog}</Link>
        </>
      )}
      {book.status === 'ok' && (
        <>
          <h1>{t.book.title}</h1>
          <p className="muted">{t.formatInfo(book.data.format.name, book.data.pages.length)}</p>
          <ShareLink />
          <PagesGrid cover={book.data.cover} pages={book.data.pages} format={book.data.format} />
        </>
      )}
    </main>
  )
}

// Ссылка на книгу — единственный «ключ» к ней (регистрации нет), поэтому
// показываем её на видном месте и даём скопировать в один тап.
function ShareLink() {
  const url = window.location.href
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Буфер обмена недоступен (старый браузер или не HTTPS):
      // текст в поле выделяется по тапу, скопировать можно вручную.
    }
  }

  return (
    <section className="card share">
      <p>{t.book.saveLinkHint}</p>
      <div className="share-row">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t.book.saveLinkHint} />
        <button className="btn" onClick={copy}>
          {copied ? t.book.copied : t.book.copy}
        </button>
      </div>
    </section>
  )
}
