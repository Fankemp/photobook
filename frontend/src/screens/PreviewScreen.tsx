import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Link, useParams } from 'react-router'
import { assetImageUrl, getBook } from '../api.ts'
import { PageView } from '../book/PageView.tsx'
import { bookSpreads, findIssues, type Spread } from '../book/spreads.ts'
import { BookIssues } from '../components/BookIssues.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { restoreDoc } from '../editor/draft.ts'
import type { Doc } from '../editor/doc.ts'
import { t } from '../i18n/index.ts'
import { useLoad } from '../lib/useLoad.ts'
import type { Book, Format } from '../types.ts'
import './PreviewScreen.css'

// Превью книги /b/<токен>/preview: как она будет выглядеть после печати —
// по разворотам, пустые рамки не печатаются, видны линия реза и безопасная зона.
export function PreviewScreen() {
  const { token = '' } = useParams()
  const book = useLoad(token, (signal) => getBook(token, signal))

  if (book.status === 'ok') return <BookPreview key={token} book={book.data} />
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

function BookPreview({ book }: { book: Book }) {
  // Если в редакторе остались несохранённые правки (сохранение ещё летит
  // или нет связи), показываем их — превью должно совпадать с редактором.
  const [doc] = useState(() => restoreDoc(book).doc)
  const spreads = useMemo(() => bookSpreads(doc.pages.length), [doc.pages.length])
  const sizes = useMemo(() => new Map(book.assets.map((a) => [a.id, a])), [book.assets])
  const issues = useMemo(() => findIssues(doc.cover, doc.pages, book.format, sizes), [doc, book.format, sizes])
  const imageSrc = useCallback((id: string) => assetImageUrl(book.token, id), [book.token])
  const [index, setIndex] = useState(0)
  const [guides, setGuides] = useState(true)

  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(spreads.length - 1, i))), [spreads.length])

  // Стрелки ← → на клавиатуре листают развороты.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(index - 1)
      if (e.key === 'ArrowRight') go(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, index])

  // Свайп влево/вправо пальцем (или мышью) — следующий/предыдущий разворот.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: PointerEvent) => (swipe.current = { x: e.clientX, y: e.clientY })
  const onPointerUp = (e: PointerEvent) => {
    const s = swipe.current
    swipe.current = null
    if (!s) return
    const dx = e.clientX - s.x
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(index + (dx < 0 ? 1 : -1))
  }

  return (
    <main className="preview">
      <header className="pp-header">
        <Link to={`/b/${book.token}`} className="ed-back" aria-label={t.preview.back}>
          ←
        </Link>
        <h1>{t.preview.title}</h1>
      </header>

      <BookIssues issues={issues} token={book.token} />

      <label className="pp-toggle">
        <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
        {t.preview.guides}
      </label>

      <div className="pp-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <SpreadView spread={spreads[index]} doc={doc} format={book.format} imageSrc={imageSrc} guides={guides} />
      </div>

      <nav className="pp-nav">
        <button className="btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label={t.preview.prev}>
          ‹
        </button>
        <span>{spreadLabel(spreads[index])}</span>
        <button
          className="btn"
          onClick={() => go(index + 1)}
          disabled={index === spreads.length - 1}
          aria-label={t.preview.next}
        >
          ›
        </button>
      </nav>

      {/* Следующий шаг после проверки книги — заявка. Если она уже есть — её статус. */}
      <div className="pp-cta">
        {book.order ? (
          <Link to={`/b/${book.token}/order`}>{t.preview.orderPlaced(book.order.number)}</Link>
        ) : (
          <Link to={`/b/${book.token}/order`} className="btn btn-primary">
            {t.preview.order}
          </Link>
        )}
      </div>

      {guides && (
        <ul className="pp-legend">
          <li>
            <span className="pp-swatch is-cut" />
            {t.preview.legendCut}
          </li>
          <li>
            <span className="pp-swatch is-safe" />
            {t.preview.legendSafe}
          </li>
        </ul>
      )}
    </main>
  )
}

type SpreadProps = {
  spread: Spread
  doc: Doc
  format: Format
  imageSrc: (id: string) => string
  guides: boolean
}

// Разворот: две страницы рядом (или обложка одна). С подсказками каждая
// страница показана с полями вылета и чуть отодвинута от соседней,
// без них — как раскрытая книга, со сгибом посередине.
function SpreadView({ spread, doc, format, imageSrc, guides }: SpreadProps) {
  const pageProps = { format, imageSrc, variant: 'print' as const, showBleed: guides, guides }

  if (spread.kind === 'cover') {
    return (
      <div className="pp-spread is-single">
        <PageView page={doc.cover} {...pageProps} kind="cover" />
      </div>
    )
  }
  const side = (i: number | null) =>
    i === null ? <BlankSide format={format} showBleed={guides} /> : <PageView page={doc.pages[i]} {...pageProps} />

  return (
    <div className={guides ? 'pp-spread is-apart' : 'pp-spread'}>
      <div className="pp-side">{side(spread.left)}</div>
      <div className="pp-side">{side(spread.right)}</div>
    </div>
  )
}

// Пустая сторона разворота: внутренняя сторона обложки (форзац).
function BlankSide({ format, showBleed }: { format: Format; showBleed: boolean }) {
  const extra = showBleed ? 2 * format.bleedMm : 0
  return (
    <div
      className="pp-blank"
      style={{ aspectRatio: `${format.widthMm + extra} / ${format.heightMm + extra}` }}
      aria-label={t.preview.endpaper}
    />
  )
}

function spreadLabel(s: Spread): string {
  if (s.kind === 'cover') return t.book.cover
  const nums = [s.left, s.right].filter((i): i is number => i !== null).map((i) => i + 1)
  return nums.length === 2 ? t.preview.pages(nums[0], nums[1]) : t.book.page(nums[0])
}
