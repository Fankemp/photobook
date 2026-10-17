import type { Format, PhotoSlotElement } from '../types.ts'
import { sizeMm } from './geometry.ts'

export type ImageSize = { width: number; height: number }

// Эффективное разрешение фото в слоте на печати — сколько пикселей фото
// придётся на дюйм бумаги (DPI). Чем больше увеличение кадра, тем меньше DPI.
//
// Фото вписано в слот с заполнением (см. crop.ts): на один пиксель фото
// приходится max(ширина слота / ширина фото, высота слота / высота фото) мм,
// а увеличение zoom растягивает пиксель ещё в zoom раз. Размер слота — как
// на бумаге, вместе с вылетом у края (см. geometry.ts).
export function slotDpi(el: PhotoSlotElement, format: Format, img: ImageSize): number {
  const slot = sizeMm(el, format)
  const mmPerPixel = Math.max(slot.w / img.width, slot.h / img.height) * (el.crop?.zoom ?? 1)
  return 25.4 / mmPerPixel
}

// Ниже минимума формата — предупреждаем: на печати фото будет нечётким.
export function isLowDpi(el: PhotoSlotElement, format: Format, img: ImageSize): boolean {
  return slotDpi(el, format, img) < format.minDpi
}
