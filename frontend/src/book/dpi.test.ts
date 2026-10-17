import { describe, expect, it } from 'vitest'
import type { Format, PhotoSlotElement } from '../types.ts'
import { isLowDpi, slotDpi } from './dpi.ts'
import { bleedRect, sheetMarginMm } from './geometry.ts'

const format: Format = {
  id: 'square-200',
  name: 'Квадрат 20×20 см',
  widthMm: 200,
  heightMm: 200,
  bleedMm: 3,
  safeMm: 5,
  pages: 20,
  minPages: 10,
  maxPages: 20,
  pageStep: 2,
  minDpi: 200,
  targetDpi: 300,
  priceKzt: 0,
  pricePerPageKzt: 0,
  spineMm: 0,
  wrapMm: 0,
  pdfMode: 'single',
  pdfOrder: 'front,pages,back',
}

const fullPage: PhotoSlotElement = { type: 'photo_slot', id: 's1', x: 0, y: 0, w: 100, h: 100 }
const inner: PhotoSlotElement = { type: 'photo_slot', id: 's2', x: 25, y: 25, w: 50, h: 50 }

describe('bleedRect', () => {
  it('extends a full-page photo by the bleed on every side', () => {
    // 3 мм из 200 — это 1.5% страницы.
    expect(bleedRect(fullPage, format)).toEqual({ x: -1.5, y: -1.5, w: 103, h: 103 })
  })

  it('extends only the sides that touch the edge', () => {
    const topBand = { ...fullPage, h: 40 }
    expect(bleedRect(topBand, format)).toEqual({ x: -1.5, y: -1.5, w: 103, h: 41.5 })
  })

  it('leaves inner slots and text alone', () => {
    expect(bleedRect(inner, format)).toEqual({ x: 25, y: 25, w: 50, h: 50 })
    const text = { type: 'text' as const, id: 't', x: 0, y: 0, w: 100, h: 10, text: '', font: 'lora', size: 12, align: 'center' as const }
    expect(bleedRect(text, format)).toEqual({ x: 0, y: 0, w: 100, h: 10 })
  })
})

describe('sheetMarginMm', () => {
  it('pages get the bleed; the cover also gets the wrap around the board', () => {
    const wrapped = { ...format, wrapMm: 15 }
    expect(sheetMarginMm(wrapped, 'page')).toBe(3)
    expect(sheetMarginMm(wrapped, 'cover')).toBe(18)
    // Фото обложки у края тянется на вылет + загиб: 18 мм из 200 = 9%.
    expect(bleedRect(fullPage, wrapped, sheetMarginMm(wrapped, 'cover'))).toEqual({ x: -9, y: -9, w: 118, h: 118 })
  })
})

describe('slotDpi', () => {
  it('full page from a 3000×2000 photo: limited by the short side, bleed included', () => {
    // На бумаге 206 мм (200 + 2×3 вылета) ≈ 8.11 дюйма; 2000 px / 8.11 ≈ 247 DPI.
    expect(slotDpi(fullPage, format, { width: 3000, height: 2000 })).toBeCloseTo(246.6, 1)
  })

  it('zoom divides the resolution', () => {
    const zoomed = { ...fullPage, crop: { zoom: 2, offsetX: 0, offsetY: 0 } }
    expect(slotDpi(zoomed, format, { width: 3000, height: 2000 })).toBeCloseTo(123.3, 1)
  })

  it('a small inner slot needs fewer pixels', () => {
    // 100 мм ≈ 3.94 дюйма; 800 px по короткой стороне → 203.2 DPI.
    expect(slotDpi(inner, format, { width: 1200, height: 800 })).toBeCloseTo(203.2, 1)
  })

  it('warns below the format minimum only', () => {
    expect(isLowDpi(fullPage, format, { width: 3000, height: 2000 })).toBe(false)
    expect(isLowDpi(fullPage, format, { width: 1200, height: 800 })).toBe(true)
    const zoomed = { ...fullPage, crop: { zoom: 1.5, offsetX: 0, offsetY: 0 } }
    expect(isLowDpi(zoomed, format, { width: 3000, height: 2000 })).toBe(true)
  })
})
