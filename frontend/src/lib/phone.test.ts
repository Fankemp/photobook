import { describe, expect, it } from 'vitest'
import { formatPhone, normalizePhone } from './phone.ts'

describe('normalizePhone (same cases as the Go test)', () => {
  it.each([
    ['+7 700 123 45 67', '+77001234567'],
    ['8 (700) 123-45-67', '+77001234567'],
    ['87001234567', '+77001234567'],
    ['77001234567', '+77001234567'],
    ['+7(727)2501010', '+77272501010'],
    ['700 123 45 67', null],
    ['+1 202 555 0100', null],
    ['+7 700 123 45 67 8', null],
    ['+7 700 abc', null],
    ['', null],
  ])('%s → %s', (input, want) => {
    expect(normalizePhone(input)).toBe(want)
  })
})

describe('formatPhone', () => {
  it('groups digits for people', () => {
    expect(formatPhone('+77001234567')).toBe('+7\u00a0700\u00a0123\u00a045\u00a067') // неразрывные пробелы
  })
})
