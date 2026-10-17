import type { Format, TextElement } from '../types.ts'

// Свободный текстовый блок: перенос, размер, поворот, привязка к центру и краям
// страницы, безопасная зона. Чистые функции без React — их проверяет transform.test.ts.
//
// Считаем в миллиметрах страницы, а не в процентах: на неквадратном формате
// процент по ширине и по высоте — разные длины, а поворот должен быть таким же,
// как CSS rotate на экране и на бумаге. Экранные пиксели переводятся в мм одним
// множителем для обеих осей (страница на экране — уменьшенная копия бумажной).

// Блок: центр, размеры (мм) и поворот (градусы по часовой, как CSS rotate).
export type Frame = { cx: number; cy: number; w: number; h: number; rotation: number }

// Ручки размера: n — верх, s — низ, e — правый край, w — левый, se — угол.
export type Handle = 'n' | 's' | 'e' | 'w' | 'se'

// Положение блока в JSON страницы (проценты страницы + поворот).
export type Placement = Pick<TextElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>

// Линии привязки, к которым прилип блок (мм от левого и верхнего края); null — нет.
export type Guides = { x: number | null; y: number | null }

// Меньше — текст не прочитать, а ручки слипаются под пальцем.
export const MIN_TEXT_MM = { w: 12, h: 6 }
// Какая доля блока по ширине и по высоте всегда остаётся на странице.
const KEEP_ON_PAGE = 0.25
// Поворот «прилипает» к 0°, ±45°, ±90°…, если ближе стольких градусов.
const ROTATION_SNAP = 4

const round2 = (v: number) => Math.round(v * 100) / 100
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const rad = (deg: number) => (deg * Math.PI) / 180

export function frameOf(el: Placement, format: Format): Frame {
  const w = (el.w / 100) * format.widthMm
  const h = (el.h / 100) * format.heightMm
  return {
    cx: (el.x / 100) * format.widthMm + w / 2,
    cy: (el.y / 100) * format.heightMm + h / 2,
    w,
    h,
    rotation: el.rotation ?? 0,
  }
}

// Обратно в проценты страницы. Поворот — целые градусы, 0 не пишем (как в шаблонах).
export function placementOf(f: Frame, format: Format): Placement {
  const rotation = normalizeAngle(Math.round(f.rotation))
  return {
    x: round2(((f.cx - f.w / 2) / format.widthMm) * 100),
    y: round2(((f.cy - f.h / 2) / format.heightMm) * 100),
    w: round2((f.w / format.widthMm) * 100),
    h: round2((f.h / format.heightMm) * 100),
    rotation: rotation === 0 ? undefined : rotation,
  }
}

// Половины ширины и высоты прямоугольника, в который вписан повёрнутый блок.
export function halfExtents(f: Frame) {
  const c = Math.abs(Math.cos(rad(f.rotation)))
  const s = Math.abs(Math.sin(rad(f.rotation)))
  return { hx: (f.w * c + f.h * s) / 2, hy: (f.w * s + f.h * c) / 2 }
}

// Не даём утащить блок целиком за страницу: хотя бы KEEP_ON_PAGE его ширины
// и высоты остаётся на ней (сервер требует, чтобы на странице была хоть часть).
export function keepOnPage(f: Frame, format: Format): Frame {
  const kx = f.w * (0.5 - KEEP_ON_PAGE)
  const ky = f.h * (0.5 - KEEP_ON_PAGE)
  return { ...f, cx: clamp(f.cx, -kx, format.widthMm + kx), cy: clamp(f.cy, -ky, format.heightMm + ky) }
}

// Привязка по одной оси: центр блока — к середине страницы, края — к краям.
// Возвращает новый центр и линию, к которой прилипли, или null.
function snapAxis(c: number, half: number, size: number, tol: number) {
  const options = [
    { line: size / 2, c: size / 2 },
    { line: 0, c: half },
    { line: size, c: size - half },
  ]
  let best: (typeof options)[number] | null = null
  for (const o of options) {
    if (Math.abs(c - o.c) <= tol && (!best || Math.abs(c - o.c) < Math.abs(c - best.c))) best = o
  }
  return best
}

// Перенос на (dx, dy) мм от начала жеста. snapMm — порог привязки (0 — без неё).
export function moveFrame(start: Frame, dx: number, dy: number, format: Format, snapMm: number) {
  let cx = start.cx + dx
  let cy = start.cy + dy
  const guides: Guides = { x: null, y: null }
  if (snapMm > 0) {
    const { hx, hy } = halfExtents(start)
    const sx = snapAxis(cx, hx, format.widthMm, snapMm)
    const sy = snapAxis(cy, hy, format.heightMm, snapMm)
    if (sx) [cx, guides.x] = [sx.c, sx.line]
    if (sy) [cy, guides.y] = [sy.c, sy.line]
  }
  const frame = keepOnPage({ ...start, cx, cy }, format)
  // Если блок упёрся (keepOnPage сдвинул), он уже не на линии привязки.
  if (frame.cx !== cx) guides.x = null
  if (frame.cy !== cy) guides.y = null
  return { frame, guides }
}

// Размер ручкой: (dx, dy) мм — сдвиг пальца на странице. Сдвиг раскладываем
// по осям повёрнутого блока; противоположная сторона блока остаётся на месте.
export function resizeFrame(start: Frame, handle: Handle, dx: number, dy: number, format: Format): Frame {
  const cos = Math.cos(rad(start.rotation))
  const sin = Math.sin(rad(start.rotation))
  const along = dx * cos + dy * sin // вдоль ширины блока
  const across = -dx * sin + dy * cos // вдоль высоты блока
  const minW = Math.min(MIN_TEXT_MM.w, format.widthMm)
  const minH = Math.min(MIN_TEXT_MM.h, format.heightMm)

  let w = start.w
  let h = start.h
  let ox = 0 // сдвиг центра в осях блока
  let oy = 0
  if (handle === 'e' || handle === 'se') {
    w = clamp(start.w + along, minW, format.widthMm)
    ox = (w - start.w) / 2
  } else if (handle === 'w') {
    w = clamp(start.w - along, minW, format.widthMm)
    ox = -(w - start.w) / 2
  }
  if (handle === 's' || handle === 'se') {
    h = clamp(start.h + across, minH, format.heightMm)
    oy = (h - start.h) / 2
  } else if (handle === 'n') {
    h = clamp(start.h - across, minH, format.heightMm)
    oy = -(h - start.h) / 2
  }
  const f = { ...start, w, h, cx: start.cx + ox * cos - oy * sin, cy: start.cy + ox * sin + oy * cos }
  return keepOnPage(f, format)
}

// Поворот ручкой: угол между «центр → начало жеста» и «центр → палец сейчас».
// from и to — точки на странице в мм.
export function rotateFrame(start: Frame, from: { x: number; y: number }, to: { x: number; y: number }): Frame {
  const a0 = Math.atan2(from.y - start.cy, from.x - start.cx)
  const a1 = Math.atan2(to.y - start.cy, to.x - start.cx)
  let deg = normalizeAngle(start.rotation + ((a1 - a0) * 180) / Math.PI)
  const nearest = Math.round(deg / 45) * 45
  if (Math.abs(deg - nearest) <= ROTATION_SNAP) deg = nearest
  return { ...start, rotation: normalizeAngle(deg) }
}

// Угол в диапазоне −180…180 (так его принимает сервер).
export function normalizeAngle(deg: number): number {
  let a = deg % 360
  if (a > 180) a -= 360
  if (a < -180) a += 360
  return a === -180 ? 180 : a + 0 // + 0 превращает −0 в 0
}

// Блок (с учётом поворота) заходит ближе format.safeMm к линии реза: при обрезке
// типография может задеть текст. Это мягкое предупреждение, не запрет.
export function nearCutLine(el: Placement, format: Format): boolean {
  const f = frameOf(el, format)
  const { hx, hy } = halfExtents(f)
  const s = format.safeMm - 0.01 // допуск на округление процентов
  return f.cx - hx < s || f.cy - hy < s || f.cx + hx > format.widthMm - s || f.cy + hy > format.heightMm - s
}
