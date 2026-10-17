import type { CSSProperties } from 'react'
import type { Format, PageElement } from '../types.ts'

// Координаты элемента в процентах страницы по линии реза → позиционирование.
// Используется для слоёв редактора поверх страницы.
export function box(el: PageElement): CSSProperties {
  return { left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }
}

// Допуск на дробные проценты: слот с x = 0.001 тоже «прижат к краю».
const EDGE = 0.01

type Rect = { x: number; y: number; w: number; h: number }

export type PageKind = 'cover' | 'page'

// Поле за линией реза в мм: у страниц блока — вылет, у обложки ещё и загиб
// на картон (из формата). Корешок пока не участвует: обложка — только лицевая
// сторона; при развёртке обложки формула поменяется здесь и в backend
// (internal/render, Sheet.Cover).
export function sheetMarginMm(format: Format, kind: PageKind): number {
  return format.bleedMm + (kind === 'cover' ? format.wrapMm : 0)
}

// Прямоугольник фото-слота с учётом вылета (в процентах страницы по линии реза).
//
// Типография режет лист с погрешностью, поэтому фото, прижатое к краю страницы,
// печатается с запасом на bleedMm за линией реза — иначе после реза у края
// может остаться белая полоска. Остальные элементы не растягиваются.
export function bleedRect(el: PageElement, format: Format, marginMm = format.bleedMm): Rect {
  if (el.type !== 'photo_slot') return { x: el.x, y: el.y, w: el.w, h: el.h }
  const bx = (marginMm / format.widthMm) * 100
  const by = (marginMm / format.heightMm) * 100
  const left = el.x <= EDGE ? bx : 0
  const top = el.y <= EDGE ? by : 0
  const right = el.x + el.w >= 100 - EDGE ? bx : 0
  const bottom = el.y + el.h >= 100 - EDGE ? by : 0
  return { x: el.x - left, y: el.y - top, w: el.w + left + right, h: el.h + top + bottom }
}

export function bleedBox(el: PageElement, format: Format, marginMm = format.bleedMm): CSSProperties {
  const r = bleedRect(el, format, marginMm)
  return { left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }
}

// Размер элемента на бумаге в миллиметрах (с вылетом для фото у края).
export function sizeMm(el: PageElement, format: Format) {
  const r = bleedRect(el, format)
  return { w: (r.w / 100) * format.widthMm, h: (r.h / 100) * format.heightMm }
}
