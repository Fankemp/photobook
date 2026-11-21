// Снимки страниц шаблона — для сверки с референсом (не тест, инструмент).
// Страница шаблона /templates/<id> рисует обложку, страницы и заднюю обложку
// тем же PageView, что редактор и PDF, с примерами фото. Каждый лист — PNG
// 1200×1200: shots/tpl-<id>/00.png (обложка), 01…16, 17 (задняя обложка).
// Запуск (сервисы запущены): node template-shots.mjs you-and-me
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const id = process.argv[2] ?? 'you-and-me'
const out = `shots/tpl-${id}`
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1300, height: 1300 }, deviceScaleFactor: 1 })
await page.goto(`${base}/templates/${id}`)
await page.locator('.grid-item .pv').first().waitFor()
// Каждую страницу показываем крупно: растягиваем элемент сетки на 1200 px.
await page.addStyleTag({ content: '.grid { display: block !important } .grid-item { width: 1200px !important; margin: 0 0 20px !important } .sticky-actions { display: none !important }' })
await page.evaluate(() => document.fonts.ready)
const items = page.locator('.grid-item .pv')
const n = await items.count()
for (let i = 0; i < n; i++) {
  const el = items.nth(i)
  await el.scrollIntoViewIfNeeded()
  await page.waitForFunction((k) => [...document.querySelectorAll('.grid-item .pv')][k].querySelectorAll('img').length === 0 ||
    [...[...document.querySelectorAll('.grid-item .pv')][k].querySelectorAll('img')].every((im) => im.complete), i)
  await el.screenshot({ path: `${out}/${String(i).padStart(2, '0')}.png` })
}
console.log(`${n} pages → e2e/${out}`)
await browser.close()
