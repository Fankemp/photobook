import { describe, expect, it } from 'vitest'
import type { Format } from '../types.ts'
import { bookPrice, formatTenge } from './money.ts'

// Та же формула, что formats.Format.Price на сервере (там свой тест).
describe('bookPrice', () => {
  const f = { pages: 20, priceKzt: 15000, pricePerPageKzt: 500 } as Format

  it('adds or subtracts the per-page price from the default page count', () => {
    expect(bookPrice(f, 20)).toBe(15000)
    expect(bookPrice(f, 16)).toBe(13000)
    expect(bookPrice(f, 24)).toBe(17000)
    expect(bookPrice({ ...f, pricePerPageKzt: 0 }, 10)).toBe(15000)
  })

  it('never goes below zero', () => {
    expect(bookPrice({ ...f, priceKzt: 0 }, 10)).toBe(0)
  })
})

describe('formatTenge', () => {
  it('groups thousands', () => {
    expect(formatTenge(15000).replace(/\s/g, ' ')).toBe('15 000 ₸')
  })
})
