import type { CSSProperties } from 'react'
import type { PageElement } from '../types.ts'

// Координаты элемента в процентах → абсолютное позиционирование внутри страницы.
// Общая функция для отрисовки и для слоёв редактора поверх неё.
export function box(el: PageElement): CSSProperties {
  return { left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }
}
