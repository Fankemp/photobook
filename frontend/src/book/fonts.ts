import config from './fonts.json'

// Шрифты лежат файлами на нашем сервере (frontend/public/fonts), без внешних CDN:
// PDF на сервере рендерится той же страницей, и шрифт обязан загрузиться.
// Список — в fonts.json; добавить шрифт = файл + запись в конфиг (скилл add-font).

export type FontCategory = 'handwritten' | 'serif' | 'sans'

export type FontInfo = {
  id: string
  name: string // как видит пользователь
  category: FontCategory
  bold: boolean // есть жирное начертание
  kk: boolean // есть казахские буквы
  files: { file: string; weight: string }[] // weight: "400" или диапазон "400 900"
}

export const FONTS = config.fonts as FontInfo[]

const byId = new Map(FONTS.map((f) => [f.id, f]))

// Запасной шрифт той же категории — на долю секунды, пока грузится основной.
const fallback: Record<FontCategory, string> = {
  handwritten: 'cursive',
  serif: 'Georgia, serif',
  sans: 'system-ui, sans-serif',
}

// Своё имя семейства с префиксом pb-: не путается со шрифтом, установленным
// у пользователя в системе (там может быть другая версия без кириллицы).
const family = (id: string) => `pb-${id}`

export function fontFamily(id: string): string {
  const f = byId.get(id)
  return f ? `'${family(id)}', ${fallback[f.category]}` : 'system-ui, sans-serif'
}

export function fontHasBold(id: string): boolean {
  return byId.get(id)?.bold ?? false
}

// Подключает все шрифты из конфига (@font-face). Браузер скачивает файл
// только когда шрифт реально используется на странице.
export function installFonts() {
  const css = FONTS.flatMap((f) =>
    f.files.map(
      ({ file, weight }) => `@font-face {
  font-family: '${family(f.id)}';
  src: url('/fonts/${file}') format('${file.endsWith('.woff2') ? 'woff2' : 'truetype'}');
  font-weight: ${weight};
  font-style: normal;
  font-display: swap;
}`,
    ),
  ).join('\n')
  const style = document.createElement('style')
  style.dataset.fonts = ''
  style.textContent = css
  document.head.appendChild(style)
}
