import { describe, expect, it } from 'vitest'
import type { Format } from '../types.ts'
import {
  frameOf,
  keepOnPage,
  moveFrame,
  nearCutLine,
  normalizeAngle,
  placementOf,
  resizeFrame,
  rotateFrame,
  type Frame,
} from './transform.ts'

const square = { widthMm: 200, heightMm: 200, safeMm: 5 } as Format
const landscape = { widthMm: 300, heightMm: 200, safeMm: 5 } as Format

// Блок 100×20 мм с центром в середине квадратной страницы.
const mid: Frame = { cx: 100, cy: 100, w: 100, h: 20, rotation: 0 }

describe('frameOf / placementOf', () => {
  it('converts percentages to millimetres and back', () => {
    const el = { x: 10, y: 80, w: 80, h: 15, rotation: 30 }
    expect(frameOf(el, landscape)).toEqual({ cx: 150, cy: 175, w: 240, h: 30, rotation: 30 })
    expect(placementOf(frameOf(el, landscape), landscape)).toEqual(el)
  })

  it('drops zero rotation, keeps angles in −180…180', () => {
    expect(placementOf({ ...mid, rotation: 0.3 }, square).rotation).toBeUndefined()
    expect(placementOf({ ...mid, rotation: 270 }, square).rotation).toBe(-90)
    expect(normalizeAngle(-180)).toBe(180)
  })
})

describe('moveFrame', () => {
  it('moves by millimetres without snapping', () => {
    const { frame, guides } = moveFrame(mid, 13, -7, square, 0)
    expect([frame.cx, frame.cy]).toEqual([113, 93])
    expect(guides).toEqual({ x: null, y: null })
  })

  it('snaps the centre to the middle of the page and reports the guide', () => {
    const { frame, guides } = moveFrame({ ...mid, cx: 80, cy: 60 }, 18, 1, square, 3)
    expect(frame.cx).toBe(100) // 98 → середина
    expect(guides.x).toBe(100)
    expect(guides.y).toBeNull() // 61 — далеко от линий
  })

  it('snaps the rotated outline to the page edge', () => {
    // Повёрнутый на 90° блок 100×20: по горизонтали он 20 мм, половина — 10.
    const r = { ...mid, rotation: 90 }
    const { frame, guides } = moveFrame(r, -88.5, 0, square, 3)
    expect(frame.cx).toBeCloseTo(10) // левый край повёрнутого блока — ровно по краю страницы
    expect(guides.x).toBe(0)
  })

  it('keeps a quarter of the block on the page', () => {
    const { frame } = moveFrame(mid, 1000, -1000, square, 0)
    expect(frame.cx - frame.w / 2).toBeCloseTo(200 - 25) // 25 мм из 100 по ширине на странице
    expect(frame.cy + frame.h / 2).toBeCloseTo(5) // 5 мм из 20 по высоте на странице
    expect(keepOnPage(frame, square)).toEqual(frame)
  })
})

describe('resizeFrame', () => {
  it('right handle widens to the right, the left side stays put', () => {
    const f = resizeFrame(mid, 'e', 20, 5, square)
    expect(f.w).toBe(120)
    expect(f.h).toBe(20)
    expect(f.cx - f.w / 2).toBeCloseTo(50)
  })

  it('works in the rotated block axes', () => {
    // Блок повёрнут на 90°: его «ширина» идёт вниз. Тянем правую ручку вниз на 30 мм.
    const f = resizeFrame({ ...mid, rotation: 90 }, 'e', 0, 30, square)
    expect(f.w).toBeCloseTo(130)
    expect(f.cx).toBeCloseTo(100)
    expect(f.cy).toBeCloseTo(115) // центр сдвинулся на половину прироста, вниз
  })

  it('top handle grows upwards, the corner changes both sides', () => {
    const top = resizeFrame(mid, 'n', 0, -10, square)
    expect(top.h).toBe(30)
    expect(top.cy + top.h / 2).toBeCloseTo(110) // нижняя сторона на месте
    const corner = resizeFrame(mid, 'se', 10, 10, square)
    expect([corner.w, corner.h]).toEqual([110, 30])
  })

  it('does not shrink below the minimum or grow beyond the page', () => {
    expect(resizeFrame(mid, 'w', 500, 0, square).w).toBe(12)
    expect(resizeFrame(mid, 's', 0, -500, square).h).toBe(6)
    expect(resizeFrame(mid, 'e', 500, 0, square).w).toBe(200)
  })
})

describe('rotateFrame', () => {
  it('rotates by the angle the finger turned around the centre', () => {
    const f = rotateFrame(mid, { x: 100, y: 50 }, { x: 150, y: 100 }) // сверху → справа: +90°
    expect(f.rotation).toBeCloseTo(90)
    expect(rotateFrame(mid, { x: 100, y: 50 }, { x: 80, y: 50 }).rotation).toBeCloseTo(-21.8, 1)
  })

  it('sticks to multiples of 45° when close', () => {
    expect(rotateFrame(mid, { x: 100, y: 50 }, { x: 103, y: 50 }).rotation).toBe(0) // ≈3.4°
    expect(rotateFrame({ ...mid, rotation: 170 }, { x: 100, y: 50 }, { x: 150, y: 100 }).rotation).toBe(-100)
  })
})

describe('nearCutLine', () => {
  it('uses the safe zone from the format', () => {
    expect(nearCutLine({ x: 10, y: 40, w: 80, h: 10 }, square)).toBe(false)
    expect(nearCutLine({ x: 2, y: 40, w: 80, h: 10 }, square)).toBe(true) // 4 мм от края < 5
    expect(nearCutLine({ x: 2, y: 40, w: 80, h: 10 }, { ...square, safeMm: 3 })).toBe(false)
  })

  it('accounts for rotation', () => {
    // Широкий блок у верхнего края: прямо — внутри, повёрнутый — угол в зоне реза.
    expect(nearCutLine({ x: 10, y: 5, w: 50, h: 10 }, square)).toBe(false)
    expect(nearCutLine({ x: 10, y: 5, w: 50, h: 10, rotation: 30 }, square)).toBe(true)
  })
})
