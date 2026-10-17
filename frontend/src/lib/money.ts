import type { Format } from '../types.ts'

// Цена книги с n страницами — та же формула, что на сервере (formats.Format.Price):
// цена формата плюс доплата за каждую страницу сверх format.pages (меньше страниц —
// дешевле, но не меньше нуля). Заявку сервер оценивает сам, здесь — для показа.
export function bookPrice(f: Format, n: number): number {
  return Math.max(0, f.priceKzt + f.pricePerPageKzt * (n - f.pages))
}

// «15 000 ₸» — Intl сам ставит неразрывные пробелы между тысячами.
export function formatTenge(n: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(n)} ₸`
}
