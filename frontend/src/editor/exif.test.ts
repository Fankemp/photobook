import { describe, expect, it } from 'vitest'
import { takenAtFromBytes } from './exif.ts'

// Минимальный JPEG с EXIF: SOI, APP1 «Exif\0\0» + TIFF с одной датой съёмки.
function jpegWithDate(date: string, littleEndian = false): Uint8Array {
  const tiff = new Uint8Array(70)
  const dv = new DataView(tiff.buffer)
  const le = littleEndian
  tiff.set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0)
  dv.setUint16(2, 42, le)
  dv.setUint32(4, 8, le) // IFD0 сразу за заголовком
  dv.setUint16(8, 1, le) // одна запись: ссылка на раздел EXIF
  dv.setUint16(10, 0x8769, le)
  dv.setUint16(12, 4, le)
  dv.setUint32(14, 1, le)
  dv.setUint32(18, 26, le)
  dv.setUint16(26, 1, le) // раздел EXIF: одна запись — DateTimeOriginal
  dv.setUint16(28, 0x9003, le)
  dv.setUint16(30, 2, le) // ASCII
  dv.setUint32(32, 20, le)
  dv.setUint32(36, 44, le)
  tiff.set([...date].map((c) => c.charCodeAt(0)), 44)
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0]
  const len = 2 + exif.length + tiff.length
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...exif, ...tiff, 0xff, 0xd9])
}

describe('takenAtFromBytes', () => {
  it('reads DateTimeOriginal in both byte orders', () => {
    expect(takenAtFromBytes(jpegWithDate('2023:07:15 14:22:01'))).toBe('2023-07-15T14:22:01')
    expect(takenAtFromBytes(jpegWithDate('2021:01:02 03:04:05', true))).toBe('2021-01-02T03:04:05')
  })

  it('finds EXIF further in the file, as in HEIC', () => {
    const jpeg = jpegWithDate('2022:12:31 23:59:59')
    const heicLike = new Uint8Array(5000 + jpeg.length)
    heicLike.set(jpeg.subarray(4), 5000) // без маркеров JPEG, глубже в файле
    expect(takenAtFromBytes(heicLike)).toBe('2022-12-31T23:59:59')
  })

  it('returns null without a date or with a broken one', () => {
    expect(takenAtFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
    expect(takenAtFromBytes(jpegWithDate('0000:00:00 00:00:00'))).toBeNull()
    expect(takenAtFromBytes(jpegWithDate('2023:07:15 14:22:01').subarray(0, 40))).toBeNull()
  })
})
