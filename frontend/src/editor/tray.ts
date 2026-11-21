import { DEFAULT_CROP } from '../book/crop.ts'
import type { AssetInfo, Crop, Page } from '../types.ts'
import { allPagesOf, updateSlot, type Doc, type SlotRef } from './doc.ts'

// Лоток «Мои фото» — это просто фото книги (book.assets); рамка хранит только
// assetId. Одно фото может стоять в нескольких рамках. Здесь — чистые функции:
// сколько раз фото использовано, порядок, раскладка по рамкам и её отмена.

// Фото в рамке: где стояло и с каким кадром (чтобы «Отменить» вернуло как было).
export type Placement = SlotRef & { assetId: string; crop?: Crop }

// Сколько рамок занимает каждое фото.
export function usageCounts(doc: Doc): Map<string, number> {
  const used = new Map<string, number>()
  for (const p of allPagesOf(doc)) {
    for (const el of p.elements) {
      if (el.type === 'photo_slot' && el.assetId) used.set(el.assetId, (used.get(el.assetId) ?? 0) + 1)
    }
  }
  return used
}

// Номера страниц (0 — обложка), где стоит фото.
export function pagesUsing(doc: Doc, assetId: string): number[] {
  return allPagesOf(doc).flatMap((p, i) => (p.elements.some((el) => el.type === 'photo_slot' && el.assetId === assetId) ? [i] : []))
}

// Порядок фото: сначала по дате съёмки (EXIF), затем фото без даты —
// в порядке загрузки (assets приходят с сервера в порядке загрузки).
export function sortForLayout(assets: AssetInfo[]): AssetInfo[] {
  const dated = assets.filter((a) => a.takenAt)
  const undated = assets.filter((a) => !a.takenAt)
  // Даты в одном формате («2023-07-15T14:22:01») — сравниваются как строки.
  // sort устойчивый: фото с одной датой остаются в порядке загрузки.
  dated.sort((a, b) => (a.takenAt! < b.takenAt! ? -1 : a.takenAt! > b.takenAt! ? 1 : 0))
  return [...dated, ...undated]
}

// Фото в лотке: не удалённые, а удалённые — пока стоят в рамке (например,
// после «Отменить» в редакторе), чтобы фото из книги всегда было видно в лотке.
export function trayPhotos(assets: AssetInfo[], usage: Map<string, number>): AssetInfo[] {
  return sortForLayout(assets.filter((a) => !a.removed || (usage.get(a.id) ?? 0) > 0))
}

// Пустые рамки страницы по порядку элементов.
export function emptySlotsOf(page: Page): SlotRef[] {
  return page.elements.flatMap((el) => (el.type === 'photo_slot' && !el.assetId ? [{ pageId: page.id, elId: el.id }] : []))
}

// Поставить фото в рамки по очереди: первое фото — в первую рамку и т.д.
export function placePhotos(doc: Doc, targets: SlotRef[], assetIds: string[]): { doc: Doc; placed: Placement[] } {
  const placed: Placement[] = []
  let out = doc
  targets.slice(0, assetIds.length).forEach((target, i) => {
    out = updateSlot(out, target, (el) => ({ ...el, assetId: assetIds[i], crop: DEFAULT_CROP }))
    placed.push({ ...target, assetId: assetIds[i] })
  })
  return { doc: out, placed }
}

// «Разложить автоматически»: неиспользованные фото по порядку (sortForLayout)
// в пустые рамки по порядку страниц — обложка, страницы, задняя обложка.
// Заполненные рамки не трогаем. leftover — сколько фото не хватило рамок.
export function autoLayout(doc: Doc, assets: AssetInfo[]): { doc: Doc; placed: Placement[]; leftover: number } {
  const used = usageCounts(doc)
  const photos = sortForLayout(assets.filter((a) => !a.removed && !used.has(a.id)))
  const targets = allPagesOf(doc).flatMap(emptySlotsOf)
  const { doc: out, placed } = placePhotos(
    doc,
    targets,
    photos.map((a) => a.id),
  )
  return { doc: out, placed, leftover: Math.max(0, photos.length - targets.length) }
}

// Отменить раскладку: освободить рамки, где всё ещё стоит то же фото
// (если рамку с тех пор поменяли вручную — её не трогаем).
export function unplace(doc: Doc, placed: Placement[]): Doc {
  let out = doc
  for (const p of placed) {
    out = updateSlot(out, p, (el) => (el.assetId === p.assetId ? { ...el, assetId: null, crop: DEFAULT_CROP } : el))
  }
  return out
}

// Удаление фото из лотка: освободить все рамки с этими фото.
export function freeAssets(doc: Doc, assetIds: Set<string>): { doc: Doc; freed: Placement[] } {
  const freed: Placement[] = []
  for (const p of allPagesOf(doc)) {
    for (const el of p.elements) {
      if (el.type === 'photo_slot' && el.assetId && assetIds.has(el.assetId)) {
        freed.push({ pageId: p.id, elId: el.id, assetId: el.assetId, crop: el.crop })
      }
    }
  }
  return { doc: unplace(doc, freed), freed }
}

// Вернуть фото в рамки («Отменить» удаление) — только в те, что так и остались пустыми.
export function restorePlacements(doc: Doc, placed: Placement[]): Doc {
  let out = doc
  for (const p of placed) {
    out = updateSlot(out, p, (el) => (el.assetId ? el : { ...el, assetId: p.assetId, crop: p.crop ?? DEFAULT_CROP }))
  }
  return out
}
