import type { Page } from '../types.ts'

// Витрина: иллюстрации-«фото» из frontend/public/demo (рисует tools/demo/generate.py)
// заполняют рамки шаблонов на главной и на странице шаблона — видно, как книга
// выглядит с фотографиями. В книги клиентов и в печать они не попадают: это только
// подстановка при показе (assetId вида «demo:lake», картинку отдаёт demoImageSrc).

const PREFIX = 'demo:'

// Какие сцены подходят к поводу — в том порядке, в каком они займут рамки.
const SCENES: Record<string, string[]> = {
  anniversary: ['lake', 'alatau', 'rings', 'city', 'sea', 'tulips', 'road', 'picnic'],
  love: ['city', 'lake', 'sea', 'rings', 'tulips', 'alatau', 'road', 'picnic', 'bouquet'],
  birthday: ['cake', 'balloons', 'picnic', 'sea', 'city', 'apples', 'tulips'],
  travel: ['alatau', 'lake', 'road', 'sea', 'city', 'snow', 'tulips'],
  mom: ['tulips', 'bouquet', 'apples', 'picnic', 'lake', 'cake', 'alatau'],
  wedding: ['rings', 'bouquet', 'lake', 'alatau', 'city', 'tulips', 'sea'],
  baby: ['teddy', 'balloons', 'picnic', 'apples', 'snow', 'cake', 'tulips'],
  family: ['picnic', 'alatau', 'apples', 'snow', 'city', 'lake', 'cake', 'road'],
}
const ALL = [...new Set(Object.values(SCENES).flat())]

export function demoImageSrc(assetId: string): string {
  return `/demo/${assetId.slice(PREFIX.length)}.svg`
}

// Страницы с занятыми рамками. Сцены идут подряд через все страницы,
// поэтому соседние рамки и страницы не повторяют одну картинку.
export function withDemoPhotos(pages: Page[], occasion: string, start = 0): Page[] {
  const scenes = SCENES[occasion] ?? ALL
  let n = start
  return pages.map((page) => ({
    ...page,
    elements: page.elements.map((el) =>
      el.type === 'photo_slot' && !el.assetId ? { ...el, assetId: PREFIX + scenes[n++ % scenes.length] } : el,
    ),
  }))
}

// Пустые подписи — примерами текста (только для витрины на главной).
export function withDemoCaptions(pages: Page[], captions: string[]): Page[] {
  let n = 0
  return pages.map((page) => ({
    ...page,
    elements: page.elements.map((el) =>
      el.type === 'text' && el.text === '' && n < captions.length ? { ...el, text: captions[n++] } : el,
    ),
  }))
}
