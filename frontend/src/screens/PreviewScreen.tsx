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
import { Flipbook, type Leaf } from '../landing/Flipbook.tsx'
import type { Book, Format, Page } from '../types.ts'
import './PreviewScreen.css'

// Превью книги /b/<токен>/preview, два режима:
//  - «Книга» — свою книгу можно полистать, как настоящую (тот же Flipbook, что на главной);
//  - «Для печати» — развороты с полями вылета, линией реза и безопасной зоной.
// В обоих пустые рамки не печатаются — видно ровно то, что выйдет из типографии.
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
  const issues = useMemo(() => findIssues(doc, book.format, sizes), [doc, book.format, sizes])
  const imageSrc = useCallback((id: string) => assetImageUrl(book.token, id), [book.token])
  const [mode, setMode] = useState<'book' | 'print'>('book')
  const [index, setIndex] = useState(0)
  const [guides, setGuides] = useState(true)

  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(spreads.length - 1, i))), [spreads.length])

  // Стрелки ← → на клавиатуре листают развороты (в режиме «Для печати»).
  useEffect(() => {
    if (mode !== 'print') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(index - 1)
      if (e.key === 'ArrowRight') go(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, index, mode])

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

      <BookIssues issues={issues} token={book.token} pageCount={doc.pages.length} />

      <div className="pp-modes" role="group" aria-label={t.preview.mode}>
        <button aria-pressed={mode === 'book'} onClick={() => setMode('book')}>
          {t.preview.modeBook}
        </button>
        <button aria-pressed={mode === 'print'} onClick={() => setMode('print')}>
          {t.preview.modePrint}
        </button>
      </div>

      {mode === 'book' ? (
        <div className="pp-book">
          <BookView doc={doc} format={book.format} imageSrc={imageSrc} />
        </div>
      ) : (
        <>
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
        </>
      )}

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

      {mode === 'print' && guides && (
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

// Книга целиком, как в руках: обложка; страницы на листах (лицевая сторона
// справа, оборотная слева); форзацы — пустая бумага изнутри обложек; в конце
// книга закрывается задней обложкой вверх.
function BookView({ doc, format, imageSrc }: { doc: Doc; format: Format; imageSrc: (id: string) => string }) {
  const leaves = useMemo(() => {
    const blank = (id: string): Page => ({ id, background: '#ffffff', elements: [] })
    const p = doc.pages
    const list: Leaf[] = [{ front: doc.cover, back: blank('inside-front') }]
    for (let i = 0; i < p.length; i += 2) list.push({ front: p[i], back: p[i + 1] ?? blank('inside-back') })
    // Задняя обложка — последний «лист»: изнутри форзац (если он ещё не на обороте
    // последней страницы), снаружи — сама обложка.
    list.push({ front: blank('inside-back-2'), back: doc.backCover })
    return list
  }, [doc])

  const n = doc.pages.length
  const label = (turned: number) => {
    if (turned === 0) return t.book.cover
    if (turned === leaves.length) return t.book.backCover
    const nums = [2 * turned - 2, 2 * turned - 1].filter((x) => x >= 1 && x <= n)
    return nums.length === 2 ? t.preview.pages(nums[0], nums[1]) : nums.length === 1 ? t.book.page(nums[0]) : t.preview.endpaper
  }

  return <Flipbook leaves={leaves} last={null} format={format} imageSrc={imageSrc} label={label} autoOpen={false} />
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

  if (spread.kind === 'cover' || spread.kind === 'back') {
    return (
      <div className="pp-spread is-single">
        <PageView page={spread.kind === 'cover' ? doc.cover : doc.backCover} {...pageProps} kind="cover" />
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
  if (s.kind === 'back') return t.book.backCover
  const nums = [s.left, s.right].filter((i): i is number => i !== null).map((i) => i + 1)
  return nums.length === 2 ? t.preview.pages(nums[0], nums[1]) : t.book.page(nums[0])
}
