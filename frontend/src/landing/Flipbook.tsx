import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type TransitionEvent } from 'react'
import { PageView } from '../book/PageView.tsx'
import { CropMarks } from '../components/Site.tsx'
import { t } from '../i18n/index.ts'
import type { Format, Page } from '../types.ts'
import './Flipbook.css'

// Лист книги: лицевая сторона лежит справа, оборотная после переворота — слева.
export type Leaf = { front: Page; back: Page }

type Props = {
  leaves: Leaf[]
  last: Page // страница справа под всеми листами — видна, когда перевёрнуто всё
  format: Format
  imageSrc: (assetId: string) => string
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Книга, которую можно листать, — витрина на главной. Страницы рисует тот же
// PageView, что редактор и печать, поэтому это честный вид будущей книги.
//
// Как устроено (классическая книжка на CSS 3D): все листы лежат на правой
// половине разворота и поворачиваются вокруг корешка (rotateY −180°). У листа
// две стороны, у каждой backface-visibility: hidden — видна та, что к нам.
// Порядок наложения задаёт z-index: справа сверху — ближний неперевёрнутый
// лист, слева — последний перевёрнутый; лист в движении — поверх всех.
//
// Анимация одна: закрытая книга раскрывается при загрузке (если человек не
// просил меньше движения — тогда книга сразу открыта). Дальше листает сам:
// кнопками, тапом по правой/левой половине или свайпом.
export function Flipbook({ leaves, last, format, imageSrc }: Props) {
  const [turned, setTurned] = useState(() => (reducedMotion() ? 1 : 0)) // перевёрнуто листов; 0 — закрыта
  const [flipping, setFlipping] = useState<number | null>(null)
  const interacted = useRef(false)
  const swipe = useRef<{ x: number; swiped: boolean } | null>(null)

  function turnTo(next: number) {
    if (next < 0 || next > leaves.length || next === turned) return
    if (!reducedMotion()) setFlipping(next > turned ? turned : next)
    setTurned(next)
  }
  const forward = () => turnTo(turned + 1)
  const backward = () => turnTo(turned - 1)

  useEffect(() => {
    if (reducedMotion()) return
    const timer = setTimeout(() => {
      if (interacted.current) return
      setFlipping(0)
      setTurned(1)
    }, 900)
    return () => clearTimeout(timer)
  }, [])

  // Тап: закрытую книгу — открыть; по правой половине — дальше, по левой — назад.
  function onClick(e: MouseEvent<HTMLDivElement>) {
    interacted.current = true
    if (swipe.current?.swiped) return
    const r = e.currentTarget.getBoundingClientRect()
    if (turned === 0 || e.clientX - r.left > r.width / 2) forward()
    else backward()
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    interacted.current = true
    swipe.current = { x: e.clientX, swiped: false }
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const s = swipe.current
    if (!s) return
    const dx = e.clientX - s.x
    if (Math.abs(dx) > 40) {
      s.swiped = true // клик после свайпа не считаем тапом
      if (dx < 0) forward()
      else backward()
    }
  }

  function onTransitionEnd(e: TransitionEvent<HTMLDivElement>, i: number) {
    if (e.propertyName === 'transform' && i === flipping) setFlipping(null)
  }

  const z = (i: number) => (i === flipping ? leaves.length + 1 : i < turned ? i + 1 : leaves.length - i)
  const page = (p: Page) => <PageView page={p} format={format} imageSrc={imageSrc} variant="print" />

  return (
    <div className="fb-wrap">
      {/* Книга для глаз; управление для всех — кнопками ниже. Метки реза —
          лист разворота, как его увидит типография. */}
      <CropMarks>
      <div
        className={turned === 0 ? 'fb is-closed' : 'fb'}
        style={{ aspectRatio: `${2 * format.widthMm} / ${format.heightMm}` }}
        aria-hidden="true"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div className="fb-book">
          <span className="fb-shadow" />
          <span className="fb-ribbon" />
          <div className="fb-base">
            <div className="fb-face fb-front">{page(last)}</div>
          </div>
          {leaves.map((leaf, i) => (
            <div
              key={i}
              className={['fb-leaf', i === 0 && 'is-cover', i < turned && 'is-turned'].filter(Boolean).join(' ')}
              style={{ zIndex: z(i) }}
              onTransitionEnd={(e) => onTransitionEnd(e, i)}
            >
              <div className="fb-face fb-front">{page(leaf.front)}</div>
              <div className="fb-face fb-back">{page(leaf.back)}</div>
            </div>
          ))}
        </div>
      </div>
      </CropMarks>
      <div className="fb-controls">
        <button className="fb-btn" onClick={backward} disabled={turned === 0} aria-label={t.home.bookPrev}>
          <Chevron />
        </button>
        <span className="fb-count" aria-live="polite">
          {turned === 0 ? t.home.bookClosed : t.home.bookSpread(turned, leaves.length)}
        </span>
        <button className="fb-btn" onClick={forward} disabled={turned === leaves.length} aria-label={t.home.bookNext}>
          <Chevron next />
        </button>
      </div>
    </div>
  )
}

function Chevron({ next = false }: { next?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={next ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} />
    </svg>
  )
}
