import { useEffect, useEffectEvent, useRef, type MouseEvent, type PointerEvent } from 'react'
import { DEFAULT_CROP, panCrop, zoomCrop } from '../book/crop.ts'
import { box } from '../book/geometry.ts'
import { t } from '../i18n/index.ts'
import type { Crop, PhotoSlotElement } from '../types.ts'
import type { Size } from './upload.ts'

export type UploadState = { previewUrl: string; progress: number }

type Props = {
  el: PhotoSlotElement
  selected: boolean
  imageSize?: Size // размеры фото в слоте (нужны, чтобы двигать его 1:1 за пальцем)
  upload?: UploadState
  lowDpi: boolean // фото слишком маленькое для этого слота на печати
  label: string
  onTap: () => void
  onCrop: (crop: Crop) => void
}

type Point = { x: number; y: number }

// Прозрачный слой поверх слота на странице: принимает касания и жесты.
// Сама картинка рисуется в PageView — этот слой только управляет кадром.
//
// Жесты (Pointer Events — одинаково для пальца, мыши и стилуса):
//  - тап — выбрать слот (или открыть выбор фото, если слот пустой);
//  - в выбранном слоте: тянуть одним пальцем/мышью — сдвиг кадра,
//    двумя пальцами — масштаб, колесо мыши — масштаб.
export function SlotOverlay({ el, selected, imageSize, upload, lowDpi, label, onTap, onCrop }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>())
  // Начало текущего жеста. Пересчитывается, когда меняется число пальцев,
  // чтобы при переходе «два пальца → один» фото не прыгало.
  const start = useRef<{ crop: Crop; points: Point[]; w: number; h: number } | null>(null)
  const moved = useRef(false)

  const crop = el.crop ?? DEFAULT_CROP
  const canAdjust = selected && !!el.assetId && !!imageSize && !upload

  function restart(target: HTMLElement) {
    const rect = target.getBoundingClientRect()
    start.current = { crop, points: [...pointers.current.values()], w: rect.width, h: rect.height }
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (pointers.current.size === 0) moved.current = false
    if (!canAdjust) return
    e.currentTarget.setPointerCapture(e.pointerId) // жест продолжается, даже если палец ушёл за край
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    restart(e.currentTarget)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const s = start.current
    if (!s || !imageSize || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]

    if (pts.length === 1 && s.points.length === 1) {
      const dx = pts[0].x - s.points[0].x
      const dy = pts[0].y - s.points[0].y
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true // мелкая дрожь пальца — ещё тап
      if (moved.current) onCrop(panCrop(s.crop, dx, dy, s.w, s.h, imageSize.width, imageSize.height))
    } else if (pts.length === 2 && s.points.length === 2) {
      moved.current = true
      onCrop(zoomCrop(s.crop, (s.crop.zoom * distance(pts)) / distance(s.points)))
    }
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(e.pointerId)) return
    if (pointers.current.size > 0) restart(e.currentTarget)
    else start.current = null
  }

  function onClick(e: MouseEvent) {
    e.stopPropagation() // клик по пустому месту страницы снимает выбор — а этот нет
    if (moved.current) return // это был жест, а не тап
    onTap()
  }

  // Колесо мыши: React вешает onWheel как passive, и прокрутку страницы
  // не отменить. Поэтому подписываемся вручную с passive: false.
  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (!canAdjust) return
    e.preventDefault()
    onCrop(zoomCrop(crop, crop.zoom * Math.exp(-e.deltaY * 0.002)))
  })
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const handler = (e: WheelEvent) => onWheel(e)
    node.addEventListener('wheel', handler, { passive: false })
    return () => node.removeEventListener('wheel', handler)
  }, [])

  const className = ['ed-slot', selected && 'is-selected', canAdjust && 'is-adjustable'].filter(Boolean).join(' ')

  return (
    <div
      ref={ref}
      className={className}
      style={box(el)}
      role="button"
      aria-label={label}
      aria-pressed={selected}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={onClick}
    >
      {lowDpi && !upload && (
        <span className="ed-dpi-badge">
          <WarningIcon />
          {t.editor.lowDpiShort}
        </span>
      )}
      {upload && (
        <div className="ed-upload">
          <img src={upload.previewUrl} alt="" />
          <div className="ed-progress">
            <span style={{ width: `${Math.round(upload.progress * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 2 1 21h22L12 2zm1 15h-2v2h2v-2zm0-7h-2v5h2v-5z" />
    </svg>
  )
}

function distance([a, b]: Point[]) {
  return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
}
