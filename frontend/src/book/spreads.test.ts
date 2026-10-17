import { describe, expect, it } from 'vitest'
import type { Format, Page } from '../types.ts'
import { bookSpreads, findIssues } from './spreads.ts'

describe('bookSpreads', () => {
  it('20 pages: cover, then [_ 1], [2 3] … [18 19], [20 _]', () => {
    const s = bookSpreads(20)
    expect(s).toHaveLength(12) // обложка + 11 разворотов
    expect(s[0]).toEqual({ kind: 'cover' })
    expect(s[1]).toEqual({ kind: 'pages', left: null, right: 0 })
    expect(s[2]).toEqual({ kind: 'pages', left: 1, right: 2 })
    expect(s[11]).toEqual({ kind: 'pages', left: 19, right: null })
  })

  it('odd page count ends with a full spread', () => {
    const s = bookSpreads(3)
    expect(s).toEqual([
      { kind: 'cover' },
      { kind: 'pages', left: null, right: 0 },
      { kind: 'pages', left: 1, right: 2 },
    ])
  })
})

describe('findIssues', () => {
  const format: Format = {
    id: 'f', name: 'f', widthMm: 200, heightMm: 200, bleedMm: 3, safeMm: 5,
    pages: 2, minDpi: 200, targetDpi: 300, priceKzt: 0,
  }
  const slot = (id: string, assetId: string | null) =>
    ({ type: 'photo_slot', id, x: 0, y: 0, w: 100, h: 100, assetId }) as const
  const page = (id: string, ...elements: Page['elements']): Page => ({ id, background: '#ffffff', elements })

  it('reports pages with empty frames and small photos; cover is page 0', () => {
    const sizes = new Map([
      ['big', { width: 4000, height: 4000 }],
      ['small', { width: 800, height: 800 }],
    ])
    const issues = findIssues(
      page('cover', slot('s1', null)),
      [page('p1', slot('s1', 'big')), page('p2', slot('s1', 'small'), slot('s2', null))],
      format,
      sizes,
    )
    expect(issues).toEqual({ lowDpi: [2], emptySlots: [0, 2] })
  })
})
