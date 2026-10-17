import { describe, expect, it } from 'vitest'
import type { Format, Page, StickerElement } from '../types.ts'
import { moveSticker, newStickerElement, resizeSticker, rotateSticker, stickerBox } from './doc.ts'

const square = { widthMm: 200, heightMm: 200 } as Format
const portrait = { widthMm: 200, heightMm: 300 } as Format
const heart = { id: 'love-heart', name: 'Сердце', file: 'love/heart.svg', aspect: 1 }
const banner = { id: 'nature-banner', name: 'Лента', file: 'nature/banner.svg', aspect: 2 }

const inside = (el: { x: number; y: number; w: number; h: number }) =>
  el.x >= 0 && el.y >= 0 && el.x + el.w <= 100 && el.y + el.h <= 100

describe('stickerBox', () => {
  it('keeps the drawing proportions on any page format', () => {
    expect(stickerBox(50, 50, 20, 1, square)).toEqual({ x: 40, y: 40, w: 20, h: 20 })
    // Портретная страница: 20% ширины = 40 мм, значит высота 40 мм = 13.33% высоты.
    expect(stickerBox(50, 50, 20, 1, portrait).h).toBeCloseTo(13.33, 2)
    expect(stickerBox(50, 50, 30, 2, square).h).toBe(15)
  })

  it('pushes the box back onto the page', () => {
    expect(stickerBox(2, 99, 20, 1, square)).toEqual({ x: 0, y: 80, w: 20, h: 20 })
  })

  it('shrinks a sticker taller than the page', () => {
    const b = stickerBox(50, 50, 60, 0.5, square)
    expect(b.h).toBe(100)
    expect(b.w).toBe(50)
    expect(inside(b)).toBe(true)
  })
})

describe('sticker editing', () => {
  const page: Page = { id: 'p1', background: '#ffffff', elements: [] }

  it('adds a new sticker in the middle of the page', () => {
    const el = newStickerElement(page, heart, square)
    expect(el).toMatchObject({ type: 'sticker', stickerId: 'love-heart', rotation: 0 })
    expect(el.x + el.w / 2).toBeCloseTo(50)
    expect(el.id.startsWith('st-')).toBe(true)
    // Второй стикер чуть сдвинут, чтобы не лечь ровно на первый.
    const second = newStickerElement({ ...page, elements: [el] }, heart, square)
    expect(second.x).toBeGreaterThan(el.x)
    expect(second.id).not.toBe(el.id)
  })

  it('does not move a sticker off the page', () => {
    const el = newStickerElement(page, banner, square)
    expect(inside(moveSticker(el, -30, 500))).toBe(true)
    expect(moveSticker(el, -30, 500)).toMatchObject({ x: 0, y: 100 - el.h })
  })

  it('resizes around the center', () => {
    const el: StickerElement = { type: 'sticker', id: 's', x: 40, y: 40, w: 20, h: 20, stickerId: 'love-heart' }
    expect(resizeSticker(el, 40, heart, square)).toMatchObject({ x: 30, y: 30, w: 40, h: 40 })
    // Стикера нет в наборе — пропорции берутся из текущего блока.
    expect(resizeSticker({ ...el, stickerId: 'gone', h: 10 }, 40, undefined, square)).toMatchObject({ w: 40, h: 20 })
  })

  it('snaps rotation to zero and keeps it in range', () => {
    expect(rotateSticker({} as StickerElement, 2).rotation).toBe(0)
    expect(rotateSticker({} as StickerElement, -45.4).rotation).toBe(-45)
    expect(rotateSticker({} as StickerElement, 400).rotation).toBe(180)
  })
})
