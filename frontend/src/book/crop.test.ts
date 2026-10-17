import { describe, expect, it } from 'vitest'
import { DEFAULT_CROP, MAX_ZOOM, cropStyle, panCrop, zoomCrop } from './crop.ts'

describe('cropStyle', () => {
  it('centred by default', () => {
    expect(cropStyle(undefined)).toEqual({ objectPosition: '50% 50%', transformOrigin: '50% 50%', transform: 'scale(1)' })
  })

  it('offsets map -1..1 to 0%..100%', () => {
    const s = cropStyle({ zoom: 2, offsetX: -1, offsetY: 1 })
    expect(s.objectPosition).toBe('0% 100%')
    expect(s.transformOrigin).toBe('0% 100%')
    expect(s.transform).toBe('scale(2)')
  })
})

describe('panCrop', () => {
  // Слот 100×100 px, фото 200×100: по ширине фото выступает на 100 px, по высоте — ровно.
  const slot = [100, 100] as const
  const img = [200, 100] as const

  it('dragging right by the full spare width shows the left edge', () => {
    const c = panCrop(DEFAULT_CROP, 50, 0, ...slot, ...img)
    expect(c.offsetX).toBe(-1) // 2 * 50 / 100 = 1 → от 0 до -1
  })

  it('photo follows the pointer 1:1 (half the spare = half the range)', () => {
    expect(panCrop(DEFAULT_CROP, -25, 0, ...slot, ...img).offsetX).toBe(0.5)
  })

  it('cannot move along an axis without spare pixels', () => {
    expect(panCrop(DEFAULT_CROP, 0, 40, ...slot, ...img).offsetY).toBe(0)
  })

  it('zoom adds spare pixels on both axes', () => {
    const zoomed = { zoom: 2, offsetX: 0, offsetY: 0 }
    // Высота при zoom 2: 200 px в слоте 100 → запас 100 px.
    expect(panCrop(zoomed, 0, 25, ...slot, ...img).offsetY).toBe(-0.5)
  })

  it('never leaves the photo (clamped to -1..1)', () => {
    const c = panCrop(DEFAULT_CROP, -1000, 0, ...slot, ...img)
    expect(c.offsetX).toBe(1)
  })
})

describe('zoomCrop', () => {
  it('clamps zoom to 1..MAX_ZOOM', () => {
    expect(zoomCrop(DEFAULT_CROP, 0.3).zoom).toBe(1)
    expect(zoomCrop(DEFAULT_CROP, 99).zoom).toBe(MAX_ZOOM)
  })
})
