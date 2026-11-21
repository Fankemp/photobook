import { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { getBook } from '../api.ts'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { Editor } from '../editor/Editor.tsx'
import { ReadOnlyBook } from '../editor/ReadOnlyBook.tsx'
import { t } from '../i18n/index.ts'
import { forgetLastBook, saveLastBook } from '../lib/lastBook.ts'
import { bookLocked } from '../lib/orderStatus.ts'
import { useLoad } from '../lib/useLoad.ts'

// Книга клиента по секретной ссылке /b/<токен>: загружаем и открываем редактор.
// После заявки книгу можно менять, пока заказ не в печати; потом — только просмотр.
export function BookScreen() {
  const { token = '' } = useParams()
  const [search] = useSearchParams()
  const book = useLoad(token, (signal) => getBook(token, signal))

  // Запоминаем книгу для кнопки «Продолжить» на главной; битую ссылку — забываем.
  useEffect(() => {
    if (book.status === 'ok') saveLastBook(token)
    if (book.status === 'error' && book.error.code === 'book_not_found') forgetLastBook(token)
  }, [book, token])

  if (book.status === 'ok' && bookLocked(book.data.order)) {
    return <ReadOnlyBook book={book.data} initialPage={Number(search.get('page')) || 0} />
  }
  if (book.status === 'ok') {
    // key: другая книга — новый редактор с чистым состоянием.
    return <Editor key={token} book={book.data} initialPage={Number(search.get('page')) || 0} />
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
