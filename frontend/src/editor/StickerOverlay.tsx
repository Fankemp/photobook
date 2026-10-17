import { useRef, type MouseEvent, type PointerEvent } from 'react'
import { box } from '../book/geometry.ts'
import { t } from '../i18n/index.ts'
import type { StickerElement } from '../types.ts'

type Props = {
  el: StickerElement
  selected: boolean
  onTap: () => void
  onMove: (x: number, y: number) => void // новый левый верхний угол, в % страницы
}

// Прозрачный слой над стикером (сам рисунок — в PageView), повёрнут так же,
// чтобы рамка выбора совпадала с рисунком.
//  - тап — выбрать стикер;
//  - выбранный стикер тянем пальцем или мышью. Мышью можно тянуть сразу,
//    без выбора; пальцем — только выбранный, иначе по стикеру не прокрутить страницу.
export function StickerOverlay({ el, selected, onTap, onMove }: Props) {
  const drag = useRef<{ id: number; x: number; y: number; px: number; py: number; w: number; h: number } | null>(null)
  const moved = useRef(false)

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    moved.current = false
    if (drag.current || (!selected && e.pointerType !== 'mouse')) return
    // Размер страницы на экране: слой лежит прямо в .ed-page, она = странице по линии реза.
    const page = e.currentTarget.parentElement?.getBoundingClientRect()
    if (!page) return
    e.currentTarget.setPointerCapture(e.pointerId) // жест продолжается, даже если палец ушёл за край
    drag.current = { id: e.pointerId, x: el.x, y: el.y, px: e.clientX, py: e.clientY, w: page.width, h: page.height }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    if (!moved.current && Math.abs(dx) + Math.abs(dy) <= 4) return // мелкая дрожь пальца — ещё тап
    if (!moved.current && !selected) onTap() // мышью потянули невыбранный — выбираем
    moved.current = true
    onMove(d.x + (dx / d.w) * 100, d.y + (dy / d.h) * 100)
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  function onClick(e: MouseEvent) {
    e.stopPropagation() // клик по пустому месту страницы снимает выбор — а этот нет
    if (!moved.current) onTap()
  }

  return (
    <div
      className={selected ? 'ed-sticker is-selected' : 'ed-sticker'}
      style={{ ...box(el), transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }}
      data-el-id={el.id}
      role="button"
      aria-label={t.editor.sticker}
      aria-pressed={selected}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={onClick}
    />
  )
}
