import { useState } from 'react'
import { Link } from 'react-router'
import { isLowDpi, type ImageSize } from '../book/dpi.ts'
import { PAGE_NAMES, pageLabel } from '../book/pageLabel.ts'
import { PageView } from '../book/PageView.tsx'
import { allPagesOf, type Doc } from '../editor/doc.ts'
import { nearCutLine } from '../editor/transform.ts'
import { t } from '../i18n/index.ts'
import type { Format } from '../types.ts'

type Props = {
  doc: Doc
  format: Format
  token: string
  sizes: Map<string, ImageSize>
  imageSrc: (id: string) => string
  confirmed: boolean
  onConfirm: (confirmed: boolean) => void
}

// Шаг «Проверьте книгу» перед заявкой: клиент листает все страницы по порядку
// (обложка → страницы → задняя обложка) и на каждой видит подписи, пустые
// рамки и предупреждения. Галочку «Я проверил(а)…» можно поставить, только
// пролистав книгу до конца; без неё заявку не отправить (проверяет и сервер).
export function BookReview({ doc, format, token, sizes, imageSrc, confirmed, onConfirm }: Props) {
  const all = allPagesOf(doc)
  const [index, setIndex] = useState(0)
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]))
  const [overflow, setOverflow] = useState<Record<string, boolean>>({}) // текст не влезает (сообщает PageView)
  const page = all[index]
  const last = all.length - 1

  function go(i: number) {
    setIndex(i)
    setSeen((s) => new Set(s).add(i))
  }

  // Замечания по странице — те же правила, что в редакторе и превью.
  const slots = page.elements.filter((el) => el.type === 'photo_slot')
  const empty = slots.filter((el) => !el.assetId).length
  const low = slots.some((el) => {
    const size = el.assetId ? sizes.get(el.assetId) : undefined
    return !!size && size.width > 0 && isLowDpi(el, format, size)
  })
  const texts = page.elements.filter((el) => el.type === 'text')
  const nearCut = texts.some((el) => el.text.trim() !== '' && nearCutLine(el, format))
  const tooLong = texts.some((el) => overflow[`${page.id}/${el.id}`])
  const notes = [
    empty > 0 && t.review.emptySlots(empty),
    low && t.review.lowDpi,
    nearCut && t.review.nearCut,
    tooLong && t.review.overflow,
  ].filter((n): n is string => !!n)

  const name = pageLabel(index, last, PAGE_NAMES)
  const allSeen = seen.size === all.length

  return (
    <section className="card order-review" aria-labelledby="review-title">
      <h2 id="review-title">{t.review.title}</h2>
      <p className="muted">{t.review.intro}</p>

      <div className="order-review-head">
        <strong>{name}</strong>
        <span className="muted">{t.review.seen(seen.size, all.length)}</span>
      </div>
      <div className="order-review-page">
        <PageView
          page={page}
          format={format}
          imageSrc={imageSrc}
          onTextFit={(elId, fits) => setOverflow((o) => (o[`${page.id}/${elId}`] === !fits ? o : { ...o, [`${page.id}/${elId}`]: !fits }))}
        />
      </div>
      <nav className="order-review-nav">
        <button type="button" className="btn" onClick={() => go(index - 1)} disabled={index === 0}>
          {t.review.prev}
        </button>
        <span className="muted">
          {index + 1} / {all.length}
        </span>
        <button type="button" className={index < last ? 'btn btn-accent' : 'btn'} onClick={() => go(index + 1)} disabled={index === last}>
          {t.review.next}
        </button>
      </nav>

      {notes.length > 0 ? (
        <ul className="order-review-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : (
        <p className="order-review-ok">{t.review.allGood}</p>
      )}

      <div className="order-review-texts">
        <p>{texts.length > 0 ? t.review.texts : t.review.noTexts}</p>
        {texts.length > 0 && (
          <ul>
            {texts.map((el) => (
              <li key={el.id} className={el.text.trim() ? undefined : 'muted'}>
                {el.text.trim() ? `«${el.text}»` : t.review.emptyText}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="order-review-links">
        <Link to={`/b/${token}?page=${index}`}>{t.review.fix}</Link>
        <Link to={`/b/${token}/texts`}>{t.review.allTexts}</Link>
      </p>

      <label className="order-confirm">
        <input type="checkbox" checked={confirmed} disabled={!allSeen} onChange={(e) => onConfirm(e.target.checked)} />
        {t.review.confirm}
      </label>
      {!allSeen && <p className="muted order-hint">{t.review.confirmLocked}</p>}
    </section>
  )
}
