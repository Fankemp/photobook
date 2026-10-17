import type { Format, PhotoSlotElement } from '../types.ts'

export type ImageSize = { width: number; height: number }

// Эффективное разрешение фото в слоте на печати — сколько пикселей фото
// придётся на дюйм бумаги (DPI). Чем больше увеличение кадра, тем меньше DPI.
//
// Фото вписано в слот с заполнением (см. crop.ts): на один пиксель фото
// приходится max(ширина слота / ширина фото, высота слота / высота фото) мм,
// а увеличение zoom растягивает пиксель ещё в zoom раз.
// Размеры слота считаем по линии реза; вылет (3 мм) на результат почти не влияет.
export function slotDpi(el: PhotoSlotElement, format: Format, img: ImageSize): number {
  const slotWmm = (el.w / 100) * format.widthMm
  const slotHmm = (el.h / 100) * format.heightMm
  const mmPerPixel = Math.max(slotWmm / img.width, slotHmm / img.height) * (el.crop?.zoom ?? 1)
  return 25.4 / mmPerPixel
}

// Ниже минимума формата — предупреждаем: на печати фото будет нечётким.
export function isLowDpi(el: PhotoSlotElement, format: Format, img: ImageSize): boolean {
  return slotDpi(el, format, img) < format.minDpi
}
