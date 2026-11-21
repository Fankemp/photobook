import config from './backgrounds.json'

// Узоры фона страниц — наши SVG в frontend/public/backgrounds (рисует
// tools/backgrounds/generate.py). Список — в backgrounds.json, общий с backend:
// он проверяет, что узор страницы существует. Узор ложится поверх цвета
// страницы на весь лист с вылетом и в PDF остаётся вектором.

export type BackgroundInfo = { id: string; name: string; file: string }

const byId = new Map((config.backgrounds as BackgroundInfo[]).map((b) => [b.id, b]))

// Адрес картинки узора или undefined (узора нет — только цвет страницы).
export function backgroundUrl(id: string | undefined): string | undefined {
  const b = id ? byId.get(id) : undefined
  return b ? `/backgrounds/${b.file}` : undefined
}
