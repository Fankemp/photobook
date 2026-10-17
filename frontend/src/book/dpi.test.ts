import { describe, expect, it } from 'vitest'
import type { Format, PhotoSlotElement } from '../types.ts'
import { isLowDpi, slotDpi } from './dpi.ts'

const format: Format = {
  id: 'square-200',
  name: 'Квадрат 20×20 см',
  widthMm: 200,
  heightMm: 200,
  bleedMm: 3,
  safeMm: 5,
  pages: 20,
  minDpi: 200,
  targetDpi: 300,
  priceKzt: 0,
}

const fullPage: PhotoSlotElement = { type: 'photo_slot', id: 's1', x: 0, y: 0, w: 100, h: 100 }

describe('slotDpi', () => {
  it('full page 20 cm from a 3000×2000 photo: limited by the short side', () => {
    // Сторона 200 мм ≈ 7.87 дюйма; по короткой стороне 2000 px → ~254 DPI.
    expect(slotDpi(fullPage, format, { width: 3000, height: 2000 })).toBeCloseTo(254, 0)
  })

  it('zoom divides the resolution', () => {
    const zoomed = { ...fullPage, crop: { zoom: 2, offsetX: 0, offsetY: 0 } }
    expect(slotDpi(zoomed, format, { width: 3000, height: 2000 })).toBeCloseTo(127, 0)
  })

  it('a small slot needs fewer pixels', () => {
    const quarter = { ...fullPage, w: 50, h: 50 }
    expect(slotDpi(quarter, format, { width: 1200, height: 800 })).toBeCloseTo(203.2, 1)
  })

  it('warns below the format minimum only', () => {
    expect(isLowDpi(fullPage, format, { width: 3000, height: 2000 })).toBe(false)
    expect(isLowDpi(fullPage, format, { width: 1200, height: 800 })).toBe(true)
    const zoomed = { ...fullPage, crop: { zoom: 1.5, offsetX: 0, offsetY: 0 } }
    expect(isLowDpi(zoomed, format, { width: 3000, height: 2000 })).toBe(true)
  })
})
