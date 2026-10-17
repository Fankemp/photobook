import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { getBook } from '../api.ts'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { Editor } from '../editor/Editor.tsx'
import { t } from '../i18n/index.ts'
import { forgetLastBook, saveLastBook } from '../lib/lastBook.ts'
import { useLoad } from '../lib/useLoad.ts'

// Книга клиента по секретной ссылке /b/<токен>: загружаем и открываем редактор.
export function BookScreen() {
  const { token = '' } = useParams()
  const book = useLoad(token, (signal) => getBook(token, signal))

  // Запоминаем книгу для кнопки «Продолжить» на главной; битую ссылку — забываем.
  useEffect(() => {
    if (book.status === 'ok') saveLastBook(token)
    if (book.status === 'error' && book.error.code === 'book_not_found') forgetLastBook(token)
  }, [book, token])

  if (book.status === 'ok') {
    // key: другая книга — новый редактор с чистым состоянием.
    return <Editor key={token} book={book.data} />
  }
  return (
    <main className="page">
      {book.status === 'loading' && <p>{t.loading}</p>}
      {book.status === 'error' && (
        <>
          <ErrorMessage error={book.error} />
          <Link to="/">{t.book.toCatalog}</Link>
        </>
      )}
    </main>
  )
}
