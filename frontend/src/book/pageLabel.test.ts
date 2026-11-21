import { describe, expect, it } from 'vitest'
import { PAGE_LINKS, PAGE_NAMES, PAGE_SHORT, pageLabel, pageOfWords } from './pageLabel.ts'

// 16 внутренних страниц: 0 — обложка, 1…16, 17 — задняя обложка.
const LAST = 17

describe('pageLabel', () => {
  it('names cover, inner page and back cover', () => {
    expect([0, 1, 16, LAST].map((i) => pageLabel(i, LAST, PAGE_NAMES))).toEqual([
      'Обложка',
      'Страница 1',
      'Страница 16',
      'Задняя обложка',
    ])
  })

  it('link and short forms use the same numbering', () => {
    expect([0, 3, LAST].map((i) => pageLabel(i, LAST, PAGE_LINKS))).toEqual(['обложка', 'стр. 3', 'задняя обложка'])
    expect(pageLabel(5, LAST, PAGE_SHORT)).toBe('5')
  })

  it('"page N of total" form for the editor header', () => {
    expect(pageLabel(3, LAST, pageOfWords(16))).toBe('Страница 3 из 16')
    expect(pageLabel(LAST, LAST, pageOfWords(16))).toBe('Задняя обложка')
  })
})
