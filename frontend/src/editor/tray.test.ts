import { describe, expect, it } from 'vitest'
import type { AssetInfo, Page, PhotoSlotElement } from '../types.ts'
import type { Doc } from './doc.ts'
import { autoLayout, freeAssets, pagesUsing, placePhotos, restorePlacements, sortForLayout, trayPhotos, unplace, usageCounts } from './tray.ts'

const slot = (id: string, assetId: string | null = null): PhotoSlotElement => ({ type: 'photo_slot', id, x: 0, y: 0, w: 50, h: 50, assetId })
const page = (id: string, ...elements: PhotoSlotElement[]): Page => ({ id, background: '#fff', elements })
const asset = (id: string, takenAt?: string, extra: Partial<AssetInfo> = {}): AssetInfo => ({ id, width: 4000, height: 3000, takenAt, viewable: true, ...extra })

function doc(): Doc {
  return {
    cover: page('cover', slot('c1')),
    pages: [page('p1', slot('s1', 'kept'), slot('s2')), page('p2', slot('s1'), slot('s2'))],
    backCover: page('back'),
  }
}

const slotsOf = (d: Doc) =>
  [d.cover, ...d.pages, d.backCover].flatMap((p) => p.elements.map((e) => `${p.id}/${e.id}=${(e as PhotoSlotElement).assetId ?? '-'}`))

describe('sortForLayout', () => {
  it('orders by EXIF date, photos without a date go after, in upload order', () => {
    const list = [asset('no-date-1'), asset('may', '2024-05-01T10:00:00'), asset('jan', '2024-01-15T08:30:00'), asset('no-date-2'), asset('jan-later', '2024-01-15T08:30:01')]
    expect(sortForLayout(list).map((a) => a.id)).toEqual(['jan', 'jan-later', 'may', 'no-date-1', 'no-date-2'])
  })
})

describe('autoLayout', () => {
  it('fills only empty slots in page order and never overwrites filled ones', () => {
    const d = doc()
    const assets = [asset('kept'), asset('b', '2024-02-01T00:00:00'), asset('a', '2024-01-01T00:00:00'), asset('c')]
    const res = autoLayout(d, assets)
    expect(slotsOf(res.doc)).toEqual(['cover/c1=a', 'p1/s1=kept', 'p1/s2=b', 'p2/s1=c', 'p2/s2=-'])
    expect(res.placed).toHaveLength(3)
    expect(res.leftover).toBe(0)
  })

  it('reports photos that did not fit and removes nothing', () => {
    const assets = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => asset(id))
    const res = autoLayout(doc(), assets)
    expect(res.placed).toHaveLength(4) // 4 пустые рамки
    expect(res.leftover).toBe(2)
    expect(slotsOf(res.doc)).toContain('p1/s1=kept')
  })

  it('skips photos already in the book and removed from the tray', () => {
    const res = autoLayout(doc(), [asset('kept'), asset('gone', undefined, { removed: true }), asset('new')])
    expect(res.placed.map((p) => p.assetId)).toEqual(['new'])
  })

  it('undo returns the previous state, but keeps slots changed by hand since', () => {
    const before = doc()
    const res = autoLayout(before, [asset('a'), asset('b'), asset('c')])
    expect(slotsOf(unplace(res.doc, res.placed))).toEqual(slotsOf(before))

    // После раскладки клиент сам поменял фото в одной рамке — «Отменить» её не трогает.
    const changed = { ...res.doc, pages: res.doc.pages.map((p) => (p.id === 'p2' ? page('p2', slot('s1', 'mine'), slot('s2')) : p)) }
    expect(slotsOf(unplace(changed, res.placed))).toEqual(['cover/c1=-', 'p1/s1=kept', 'p1/s2=-', 'p2/s1=mine', 'p2/s2=-'])
  })
})

describe('placePhotos', () => {
  it('fills the chosen slots in the order photos were picked', () => {
    const res = placePhotos(doc(), [{ pageId: 'p2', elId: 's2' }, { pageId: 'p2', elId: 's1' }], ['first', 'second'])
    expect(slotsOf(res.doc)).toEqual(['cover/c1=-', 'p1/s1=kept', 'p1/s2=-', 'p2/s1=second', 'p2/s2=first'])
  })
})

describe('tray usage and deleting', () => {
  it('counts slots per photo and shows removed photos only while used', () => {
    const d = placePhotos(doc(), [{ pageId: 'p2', elId: 's1' }], ['kept']).doc
    const used = usageCounts(d)
    expect(used.get('kept')).toBe(2)
    expect(pagesUsing(d, 'kept')).toEqual([1, 2])
    const tray = trayPhotos([asset('kept', undefined, { removed: true }), asset('gone', undefined, { removed: true }), asset('x')], used)
    expect(tray.map((a) => a.id)).toEqual(['kept', 'x'])
  })

  it('frees every slot of a deleted photo and puts it back on undo', () => {
    const d = placePhotos(doc(), [{ pageId: 'p2', elId: 's1' }], ['kept']).doc
    const { doc: freed, freed: placements } = freeAssets(d, new Set(['kept']))
    expect(usageCounts(freed).size).toBe(0)
    expect(placements).toHaveLength(2)
    expect(slotsOf(restorePlacements(freed, placements))).toEqual(slotsOf(d))
  })
})
