// Телефон — те же правила, что на сервере (backend/internal/orders):
// принимаем «+7 700 123 45 67», «8 (700) 123-45-67», «77001234567»,
// храним как +77001234567. Номера Казахстана (и России) начинаются с +7.
export function normalizePhone(s: string): string | null {
  if (/[^\d+\s\-()]/.test(s)) return null
  let d = s.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1)
  return d.length === 11 && d[0] === '7' ? '+' + d : null
}

// «+7 700 123 45 67» — для показа людям. Пробелы неразрывные (\u00a0),
// чтобы номер не переносился на середине строки.
export function formatPhone(p: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(p)
  return m ? ['+7', m[1], m[2], m[3], m[4]].join('\u00a0') : p
}
