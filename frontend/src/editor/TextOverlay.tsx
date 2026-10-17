import { useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { box } from '../book/geometry.ts'
import { t } from '../i18n/index.ts'
import type { Format, TextElement } from '../types.ts'
import {
  frameOf,
  moveFrame,
  placementOf,
  resizeFrame,
  rotateFrame,
  type Frame,
  type Guides,
  type Handle,
  type Placement,
} from './transform.ts'

type Props = {
  el: TextElement
  format: Format
  selected: boolean
  overflow: boolean // текст не влезает даже мелким шрифтом
  nearCut: boolean // блок заходит в зону реза (ближе format.safeMm к краю)
  onSelect: () => void
  onEdit: () => void // повторный тап по выбранному блоку — ввод текста
  // Новое положение во время жеста. gesture — номер жеста: все правки одного
  // жеста — один шаг «Отменить».
  onPlace: (p: Placement, gesture: number) => void
  onGuides: (g: Guides | null) => void // линии привязки на время переноса
}

type Kind = 'move' | 'rotate' | Handle

type Gesture = {
  id: number
  pointerId: number
  kind: Kind
  start: Frame // блок в начале жеста, мм
  x0: number // палец в начале жеста, px экрана
  y0: number
  page: DOMRect // страница на экране
  mmPerPx: number
}

const HANDLES: Handle[] = ['n', 's', 'w', 'e', 'se']
const TAP_SLOP_PX = 5 // сдвиг меньше — ещё тап, а не перетаскивание (дрожь пальца)
const SNAP_PX = 8 // привязка к центру и краям, если ближе стольких пикселей на экране
let gestureSeq = 0

// Слой над текстовым блоком. Сам текст рисует PageView (тот же, что в превью
// и PDF); здесь — рамка, ручки, жесты и подсказки, на печать они не попадают.
//
// Сделано на Pointer Events (одинаково для пальца, мыши и стилуса), как кадр
// фото и стикеры, без библиотек вроде react-moveable: нужна небольшая часть
// их возможностей, а ручки должны быть крупными (44px) для пальца.
//
//  - тап — выбрать блок: рамка и ручки; тап по выбранному (или двойной клик) — ввод текста;
//  - выбранный блок тянем пальцем, мышью — сразу, без выбора. Пальцем невыбранный
//    не тянется: иначе по тексту было бы не прокрутить страницу;
//  - ручки по краям — размер, ручка над блоком — поворот.
// Слой повёрнут вместе с текстом, поэтому рамка и ручки совпадают с ним.
//
// Ручки — соседи рамки, а не её дети. Chrome на телефоне «подстраивает» касание:
// ищет нажимаемые элементы в ~10px вокруг пальца и из вложенных выбирает самый
// глубокий. Будь ручки внутри рамки, тап по середине тонкой строки текста
// доставался бы ближней ручке, а не рамке.
export function TextOverlay({ el, format, selected, overflow, nearCut, onSelect, onEdit, onPlace, onGuides }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  // Тап это или жест — решаем при отпускании; был ли блок выбран — при касании.
  const tap = useRef({ moved: false, wasSelected: false })
  const [rotating, setRotating] = useState(false)

  function begin(kind: Kind, e: PointerEvent<HTMLElement>) {
    if (gesture.current) return // второй палец во время жеста не мешает первому
    tap.current = { moved: false, wasSelected: selected }
    if (kind === 'move' && !selected && e.pointerType !== 'mouse') return
    // Слой лежит прямо в .ed-page, а она — страница по линии реза.
    const page = rootRef.current?.parentElement?.getBoundingClientRect()
    if (!page) return
    e.currentTarget.setPointerCapture(e.pointerId) // жест продолжается, даже если палец ушёл за край
    gesture.current = {
      id: ++gestureSeq,
      pointerId: e.pointerId,
      kind,
      start: frameOf(el, format),
      x0: e.clientX,
      y0: e.clientY,
      page,
      mmPerPx: format.widthMm / page.width,
    }
  }

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    const dxPx = e.clientX - g.x0
    const dyPx = e.clientY - g.y0
    if (!tap.current.moved) {
      if (Math.abs(dxPx) + Math.abs(dyPx) <= TAP_SLOP_PX) return
      tap.current.moved = true
      if (!selected) onSelect() // мышью потянули невыбранный блок — выбираем
      if (g.kind === 'rotate') setRotating(true)
    }

    const k = g.mmPerPx
    let frame: Frame
    if (g.kind === 'move') {
      const moved = moveFrame(g.start, dxPx * k, dyPx * k, format, SNAP_PX * k)
      frame = moved.frame
      onGuides(moved.guides.x === null && moved.guides.y === null ? null : moved.guides)
    } else if (g.kind === 'rotate') {
      const toMm = (x: number, y: number) => ({ x: (x - g.page.left) * k, y: (y - g.page.top) * k })
      frame = rotateFrame(g.start, toMm(g.x0, g.y0), toMm(e.clientX, e.clientY))
    } else {
      frame = resizeFrame(g.start, g.kind, dxPx * k, dyPx * k, format)
    }
    onPlace(placementOf(frame, format), g.id)
  }

  function onPointerEnd(e: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointerId !== e.pointerId) return
    gesture.current = null
    setRotating(false)
    onGuides(null)
  }

  function onClick(e: MouseEvent) {
    e.stopPropagation() // клик по пустому месту страницы снимает выбор — а этот нет
    if (tap.current.moved) return // это было перетаскивание, а не тап
    if (tap.current.wasSelected) onEdit()
    else onSelect()
    tap.current.wasSelected = true // для клика без касания (клавиатура): следующий — ввод
  }

  // Тап по ручке без движения ничего не делает (и не снимает выбор).
  const stop = (e: MouseEvent) => e.stopPropagation()

  const empty = el.text.trim() === ''
  const rotation = el.rotation ?? 0
  return (
    <div ref={rootRef} className={selected ? 'ed-text is-selected' : 'ed-text'} style={box(el)} data-el-id={el.id}>
      {/* Движение и отпускание пальца всплывают сюда и от рамки, и от ручек. */}
      <div
        className="ed-text-rot"
        style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div
          className="ed-text-frame"
          role="button"
          aria-label={empty ? t.editor.textEmpty : t.editor.textFilled}
          aria-pressed={selected}
          onPointerDown={(e) => begin('move', e)}
          onClick={onClick}
        >
          {empty && <span className="ed-text-placeholder">{t.editor.textPlaceholder}</span>}
        </div>
        {selected &&
          HANDLES.map((h) => (
            <span key={h} className={`ed-handle ed-handle-${h}`} aria-hidden="true" onPointerDown={(e) => begin(h, e)} onClick={stop} />
          ))}
        {selected && (
          <span className="ed-rotate" aria-hidden="true" onPointerDown={(e) => begin('rotate', e)} onClick={stop}>
            {rotating && <span className="ed-rotate-value">{t.editor.degrees(rotation)}</span>}
          </span>
        )}
      </div>
      {/* Предупреждения — не повёрнуты, чтобы читались. */}
      {(overflow || nearCut) && (
        <div className="ed-badges">
          {overflow && <span className="ed-dpi-badge">{t.editor.textOverflowShort}</span>}
          {nearCut && <span className="ed-dpi-badge ed-badge-soft">{t.editor.textNearCutShort}</span>}
        </div>
      )}
    </div>
  )
}
