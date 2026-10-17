// Каталог: фильтр шаблонов по поводу, новые шаблоны (стикеры, повёрнутый текст,
// задняя обложка) и книга по новому шаблону.
// Запуск: make e2e (сервисы должны быть запущены через make up).
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const apiBase = process.env.API_URL ?? 'http://localhost:8080'
const out = 'shots'
mkdirSync(out, { recursive: true })
const problems = []
const log = (...a) => console.log(...a)
const check = (cond, msg) => { if (!cond) problems.push('FAIL: ' + msg); log((cond ? 'ok   ' : 'FAIL ') + msg) }

const all = await (await fetch(`${apiBase}/api/templates`)).json()
const NEW = { 'mom-tender': 'Подарок маме', 'wedding-elegant': 'Свадьба', 'baby-first-year': 'Малыш', 'family-album': 'Семья' }

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()) })
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
const cards = page.locator('.tpl-card')
const chip = (name) => page.locator('.chips').getByRole('button', { name, exact: true })
// Адрес меняется чуть раньше, чем React перерисует список, — ждём нажатую кнопку.
const chipOn = (name) => page.locator('.chip[aria-pressed="true"]', { hasText: name }).waitFor()
const imagesLoaded = () => page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0))

// 1. Все шаблоны, у каждого повода — кнопка фильтра; стикеры на обложках загрузились.
await page.goto(base + '/')
await cards.first().waitFor()
await imagesLoaded()
const occasions = new Set(all.map((tpl) => tpl.occasion))
check((await cards.count()) === all.length && all.length >= 7, `catalog shows all ${all.length} templates`)
check((await page.locator('.chip').count()) === occasions.size + 1 && (await chip('Все').getAttribute('aria-pressed')) === 'true',
  `filter: "Все" + ${occasions.size} occasions, "Все" is on`)
check((await page.locator('.tpl-card .pv-sticker').count()) >= 4, 'stickers drawn on the new covers')
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'filter row does not make the page scroll sideways')
await page.screenshot({ path: `${out}/cat-1-all.png`, fullPage: true })

// 2. Фильтр: один повод → только его шаблоны; он в адресе и переживает перезагрузку.
await chip('Подарок маме').click()
await chipOn('Подарок маме')
check((await cards.count()) === 1 && (await cards.first().locator('.tpl-card-name').textContent()) === 'Маме с любовью'
  && page.url().endsWith('/?occasion=mom'), '"Подарок маме" → only «Маме с любовью», chip on, ?occasion=mom')
await page.reload()
await cards.first().waitFor()
check((await cards.count()) === 1 && (await chip('Подарок маме').getAttribute('aria-pressed')) === 'true', 'filter survives a reload')
await page.screenshot({ path: `${out}/cat-2-mom.png` })
await chip('Все').click()
await chipOn('Все')
check((await cards.count()) === all.length && !new URL(page.url()).search, '"Все" shows every template again, ?occasion dropped')
await page.goto(base + '/?occasion=unicorn')
await cards.first().waitFor()
check((await cards.count()) === all.length && (await chip('Все').getAttribute('aria-pressed')) === 'true', 'unknown occasion in the address → all templates')

// 3. Каждый новый шаблон: свой повод в фильтре, 22 страницы (обложки + 20), стикеры.
for (const [id, occasion] of Object.entries(NEW)) {
  const tpl = all.find((x) => x.id === id)
  check(tpl?.occasion && (await page.goto(`${base}/?occasion=${tpl.occasion}`), await cards.first().waitFor(), (await chip(occasion).getAttribute('aria-pressed')) === 'true'),
    `${id}: listed under "${occasion}"`)
  await page.goto(`${base}/templates/${id}`)
  await page.locator('.grid .pv').first().waitFor()
  await imagesLoaded()
  const pagesShown = await page.locator('.grid .pv').count()
  const stickers = await page.locator('.grid .pv-sticker').count()
  check(pagesShown === 22 && stickers >= 5, `${id}: 22 pages with back cover, ${stickers} stickers drawn`)
}

// 4. Книга по шаблону «Первый год»: подписи месяцев повёрнуты, стикеры на месте.
await page.goto(`${base}/templates/baby-first-year`)
await page.getByRole('button', { name: 'Создать книгу по этому шаблону' }).click()
await page.waitForURL(/\/b\/[A-Z2-7]{26}$/)
await page.goto(page.url() + '?page=3')
const label = page.locator('.ed-page .pv-text').first()
await label.waitFor()
check((await label.textContent()) === '1 месяц' && (await label.evaluate((e) => e.style.transform)) === 'rotate(-3deg)',
  'baby book, page 3: "1 месяц" label, tilted −3° like in the template')
check((await page.locator('.ed-page .pv-sticker').count()) === 1, 'baby book, page 3: sparkles sticker')
await page.screenshot({ path: `${out}/cat-3-baby-book.png` })

await browser.close()
log(problems.length ? `\n${problems.length} problem(s):\n` + problems.join('\n') : '\nall catalog checks passed')
process.exit(problems.length ? 1 : 0)
