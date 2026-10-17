import { describe, expect, it } from 'vitest'
import type { Format, Page } from '../types.ts'
import type { Doc } from './doc.ts'
import { blankCopy, canAdd, canRemove, hasContent, insertLeaf, leafOf, nextCounts, removeLeaf, restoreLeaf } from './pages.ts'

// Как формат для разработки: 20 страниц у новой книги, от 10 до 20, листами по 2.
const f = { pages: 20, minPages: 10, maxPages: 20, pageStep: 2 } as Format

const page = (id: string, extra: Partial<Page> = {}): Page => ({ id, background: '#ffffff', elements: [], ...extra })
const book = (n: number): Doc => ({
  cover: page('cover'),
  backCover: page('back'),
  pages: Array.from({ length: n }, (_, i) => page(`p${i + 1}`)),
})
const ids = (d: Doc) => d.pages.map((p) => p.id)

describe('leaves', () => {
  it('groups pages into leaves of pageStep', () => {
    expect(leafOf(0, 2)).toEqual({ start: 0, end: 2 }) // страницы 1–2
    expect(leafOf(5, 2)).toEqual({ start: 4, end: 6 }) // страница 6 — на листе 5–6
    expect(leafOf(5, 1)).toEqual({ start: 5, end: 6 })
  })

  it('never goes below min or above max', () => {
    expect(canRemove(12, f)).toBe(true)
    expect(canRemove(10, f)).toBe(false) // минимум
    expect(canAdd(18, f)).toBe(true)
    expect(canAdd(20, f)).toBe(false) // максимум
    expect(nextCounts(10, f)).toEqual({ down: null, up: 12 })
    expect(nextCounts(16, f)).toEqual({ down: 14, up: 18 })
  })

  it('keeps the page count a multiple of the step through any sequence', () => {
    let d = book(20)
    const seq = [7, 0, 13, 3, 'add', 4, 'add', 'add', 9, 1] as const
    for (const op of seq) {
      if (op === 'add') {
        if (canAdd(d.pages.length, f)) d = insertLeaf(d, 2, f.pageStep, d.pages.slice(0, 2))
      } else if (canRemove(d.pages.length, f)) {
        d = removeLeaf(d, Math.min(op, d.pages.length - 1), f.pageStep).doc
      }
      expect(d.pages.length % f.pageStep).toBe(0)
      expect(d.pages.length).toBeGreaterThanOrEqual(f.minPages)
      expect(d.pages.length).toBeLessThanOrEqual(f.maxPages)
      expect(new Set(ids(d)).size).toBe(d.pages.length) // id страниц не повторяются
    }
  })
})

describe('remove and undo', () => {
  it('removes the whole leaf of the page and restores it in the same place', () => {
    const d = book(20)
    const { doc, removed } = removeLeaf(d, 5, 2) // страница 6 → уходят 5 и 6
    expect(ids(doc)).not.toContain('p5')
    expect(ids(doc)).not.toContain('p6')
    expect(doc.pages).toHaveLength(18)
    expect(removed).toEqual({ at: 4, pages: [d.pages[4], d.pages[5]] })
    expect(restoreLeaf(doc, removed)).toEqual(d)
  })
})

describe('new pages', () => {
  it('copy the layout of the sample without its content', () => {
    const sample = page('p3', {
      background: '#fcf3f1',
      elements: [
        { type: 'photo_slot', id: 's1', x: 0, y: 0, w: 100, h: 80, assetId: 'photo-1', crop: { zoom: 2, offsetX: 1, offsetY: 0 } },
        { type: 'text', id: 't1', x: 8, y: 83, w: 84, h: 11, text: 'Море', font: 'lora', size: 11, align: 'center' },
        { type: 'text', id: 'ut-abc', x: 8, y: 8, w: 84, h: 10, text: 'мой текст', font: 'lora', size: 14, align: 'center' },
        { type: 'sticker', id: 'st-1', x: 40, y: 40, w: 20, h: 20, stickerId: 'love-heart' },
      ],
    })
    expect(hasContent(sample)).toBe(true)
    const copy = blankCopy(sample, 'pg-new')
    expect(copy.id).toBe('pg-new')
    expect(copy.background).toBe('#fcf3f1')
    expect(copy.elements.map((e) => e.type)).toEqual(['photo_slot', 'text'])
    expect(copy.elements[0]).toMatchObject({ assetId: null, crop: { zoom: 1, offsetX: 0, offsetY: 0 } })
    expect(copy.elements[1]).toMatchObject({ id: 't1', text: '' })
    expect(hasContent(copy)).toBe(false)
  })

  it('are inserted as a leaf at the given place with fresh ids', () => {
    const d = book(16)
    const next = insertLeaf(d, 6, 2, [d.pages[4], d.pages[5]])
    expect(next.pages).toHaveLength(18)
    expect(ids(next).slice(0, 6)).toEqual(ids(d).slice(0, 6))
    expect(ids(next).slice(8)).toEqual(ids(d).slice(6))
    expect(next.pages[6].id).toMatch(/^pg-/)
    expect(next.pages[7].id).not.toBe(next.pages[6].id)
  })
})
