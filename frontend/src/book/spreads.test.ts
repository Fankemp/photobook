import { describe, expect, it } from 'vitest'
import type { Format, Page } from '../types.ts'
import { bookSpreads, findIssues } from './spreads.ts'

describe('bookSpreads', () => {
  it('20 pages: cover, [_ 1], [2 3] … [18 19], [20 _], back cover', () => {
    const s = bookSpreads(20)
    expect(s).toHaveLength(13) // обложка + 11 разворотов + задняя обложка
    expect(s[0]).toEqual({ kind: 'cover' })
    expect(s[1]).toEqual({ kind: 'pages', left: null, right: 0 })
    expect(s[2]).toEqual({ kind: 'pages', left: 1, right: 2 })
    expect(s[11]).toEqual({ kind: 'pages', left: 19, right: null })
    expect(s[12]).toEqual({ kind: 'back' })
  })

  it('odd page count ends with a full spread', () => {
    const s = bookSpreads(3)
    expect(s).toEqual([
      { kind: 'cover' },
      { kind: 'pages', left: null, right: 0 },
      { kind: 'pages', left: 1, right: 2 },
      { kind: 'back' },
    ])
  })
})

describe('findIssues', () => {
  const format: Format = {
    id: 'f', name: 'f', widthMm: 200, heightMm: 200, bleedMm: 3, safeMm: 5,
    pages: 2, minPages: 2, maxPages: 4, pageStep: 1, minDpi: 200, targetDpi: 300, priceKzt: 0, pricePerPageKzt: 0, spineMm: 0, wrapMm: 0,
    pdfMode: 'single', pdfOrder: 'front,pages,back',
  }
  const slot = (id: string, assetId: string | null) =>
    ({ type: 'photo_slot', id, x: 0, y: 0, w: 100, h: 100, assetId }) as const
  const page = (id: string, ...elements: Page['elements']): Page => ({ id, background: '#ffffff', elements })

  it('reports small photos, empty frames and empty pages; cover is 0, back cover is last', () => {
    const sizes = new Map([
      ['big', { width: 4000, height: 4000 }],
      ['small', { width: 800, height: 800 }],
    ])
    const issues = findIssues(
      {
        cover: page('cover', slot('s1', null)),
        pages: [page('p1', slot('s1', 'big')), page('p2', slot('s1', 'small'), slot('s2', null)), page('p3', slot('s1', null))],
        backCover: page('back', slot('s1', null)),
      },
      format,
      sizes,
    )
    // Задняя обложка — номер 4 (после трёх страниц), как в редакторе. Страница 3
    // пустая целиком: она в emptyPages и не повторяется в emptySlots.
    expect(issues).toEqual({ lowDpi: [2], emptySlots: [0, 2, 4], emptyPages: [3] })
  })

  // Регрессия (assignment 05, риск R1): у HEIC, который браузер не открыл, размеры
  // 0×0, пока сервер не сделал миниатюру (или если миниатюра не получилась).
  // Неизвестный размер — не «маленькое фото»: так же считают редактор и проверка книги.
  it('does not report a photo with unknown size (0×0, HEIC before thumbnail) as low resolution', () => {
    const sizes = new Map([
      ['heic', { width: 0, height: 0 }],
      ['small', { width: 800, height: 800 }],
    ])
    const issues = findIssues(
      {
        cover: page('cover', slot('s1', 'heic')),
        pages: [page('p1', slot('s1', 'heic')), page('p2', slot('s1', 'small'))],
        backCover: page('back', slot('s1', 'heic')),
      },
      format,
      sizes,
    )
    expect(issues).toEqual({ lowDpi: [2], emptySlots: [], emptyPages: [] })
  })
})
