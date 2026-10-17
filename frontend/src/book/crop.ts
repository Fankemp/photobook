import type { CSSProperties } from 'react'
import type { Crop } from '../types.ts'

// Кадр фото внутри слота.
//
// Фото сначала вписывается «с заполнением» (как object-fit: cover — слот закрыт
// целиком, лишнее обрезано), затем увеличивается в zoom раз (1–MAX_ZOOM).
// offsetX/offsetY от -1 до 1 выбирают, какая часть фото видна:
// -1 — левый/верхний край, 0 — центр, 1 — правый/нижний край.
// Всё в долях, без пикселей, поэтому одинаково на телефоне, компьютере и в PDF.

export const DEFAULT_CROP: Crop = { zoom: 1, offsetX: 0, offsetY: 0 }
export const MAX_ZOOM = 4

export function cropStyle(crop: Crop | undefined): CSSProperties {
  const c = crop ?? DEFAULT_CROP
  const pos = `${50 + 50 * c.offsetX}% ${50 + 50 * c.offsetY}%`
  // object-position выбирает видимую часть, transform-origin в той же точке
  // увеличивает «вокруг» неё. Вместе они никогда не оставляют пустых полей.
  return { objectPosition: pos, transformOrigin: pos, transform: `scale(${c.zoom})` }
}

// Сдвиг кадра указателем: фото едет за пальцем/мышью 1:1.
// slotW/slotH — размер слота на экране (px), imgW/imgH — размеры фото,
// dx/dy — насколько сдвинулся указатель от начала жеста (px).
export function panCrop(
  start: Crop,
  dx: number,
  dy: number,
  slotW: number,
  slotH: number,
  imgW: number,
  imgH: number,
): Crop {
  const cover = Math.max(slotW / imgW, slotH / imgH)
  // На сколько пикселей фото на экране больше слота по каждой оси.
  // Если запаса нет (фото ровно по слоту), по этой оси двигать нечего.
  const spareX = imgW * cover * start.zoom - slotW
  const spareY = imgH * cover * start.zoom - slotH
  return {
    zoom: start.zoom,
    offsetX: spareX > 0.5 ? round(clamp(start.offsetX - (2 * dx) / spareX, -1, 1)) : start.offsetX,
    offsetY: spareY > 0.5 ? round(clamp(start.offsetY - (2 * dy) / spareY, -1, 1)) : start.offsetY,
  }
}

export function zoomCrop(start: Crop, zoom: number): Crop {
  return { ...start, zoom: round(clamp(zoom, 1, MAX_ZOOM)) }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

// 4 знака после запятой: точности хватает с запасом, а JSON книги не раздувается.
function round(v: number) {
  return Math.round(v * 10000) / 10000
}
