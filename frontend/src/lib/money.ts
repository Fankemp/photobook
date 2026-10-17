// «15 000 ₸» — Intl сам ставит неразрывные пробелы между тысячами.
export function formatTenge(n: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(n)} ₸`
}
