// Дата съёмки из EXIF (тег DateTimeOriginal) — по ней автораскладка ставит фото
// по порядку. Читаем прямо в браузере, до загрузки: так порядок известен сразу.
//
// EXIF — это маленький файл в формате TIFF внутри фото. В JPEG он лежит в
// блоке APP1, в HEIC — отдельным «элементом»; в обоих случаях перед ним стоит
// подпись «Exif\0\0». Ищем её в начале файла, а не разбираем весь формат: так
// одна короткая функция работает и для JPEG, и для HEIC с iPhone. Не нашли —
// не беда: дату из HEIC достанет сервер (libvips), иначе — порядок загрузки.

const HEAD_BYTES = 512 * 1024 // EXIF всегда в начале файла

// Дата в виде «2023-07-15T14:22:01» (местное время камеры, без часового пояса) или null.
export async function readTakenAt(file: Blob): Promise<string | null> {
  try {
    return takenAtFromBytes(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()))
  } catch {
    return null
  }
}

export function takenAtFromBytes(b: Uint8Array): string | null {
  for (let i = 0; i + 14 <= b.length; i++) {
    // «Exif» и два нулевых байта
    if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0) {
      const found = fromTiff(b.subarray(i + 6))
      if (found) return found
    }
  }
  return null
}

const TAG_EXIF_IFD = 0x8769 // ссылка на раздел EXIF
const TAG_DATE_ORIGINAL = 0x9003 // DateTimeOriginal: «2023:07:15 14:22:01»

// TIFF: порядок байт («II» — младший первым, «MM» — старший), число 42,
// смещение первого каталога (IFD). Каталог — число записей и записи по 12 байт:
// тег, тип, количество, значение или смещение до него.
function fromTiff(b: Uint8Array): string | null {
  if (b.length < 8) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const order = dv.getUint16(0)
  if (order !== 0x4949 && order !== 0x4d4d) return null
  const le = order === 0x4949
  try {
    if (dv.getUint16(2, le) !== 42) return null
    const findTag = (ifd: number, tag: number): number | null => {
      const n = dv.getUint16(ifd, le)
      for (let k = 0; k < n; k++) {
        const entry = ifd + 2 + k * 12
        if (dv.getUint16(entry, le) === tag) return entry
      }
      return null
    }
    const exifRef = findTag(dv.getUint32(4, le), TAG_EXIF_IFD)
    if (exifRef === null) return null
    const date = findTag(dv.getUint32(exifRef + 8, le), TAG_DATE_ORIGINAL)
    if (date === null || dv.getUint32(date + 4, le) < 19) return null
    const at = dv.getUint32(date + 8, le)
    const text = String.fromCharCode(...b.subarray(at, at + 19))
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text)
    if (!m || m[1] === '0000') return null // камеры без часов пишут нули
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
  } catch {
    return null // RangeError: файл обрезан или испорчен — даты нет
  }
}
