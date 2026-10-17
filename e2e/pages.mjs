// Страницы книги: удалить (пустой лист — сразу, с содержимым — с вопросом),
// «Отменить», добавить (после листа и в конец), пределы и шаг из формата,
// счётчик, автосохранение быстрых действий, проверка на сервере, заявка.
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

const api = async (path, init) => {
  const r = await fetch(`${apiBase}/api${path}`, init)
  return { status: r.status, body: await r.json().catch(() => null) }
}
const getBook = async (token) => (await api(`/books/${token}`)).body
const putPages = (token, b, pages) => api(`/books/${token}`, {
  method: 'PUT',
  body: JSON.stringify({ version: b.version, cover: b.cover, pages, backCover: b.backCover }),
})

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('400')) problems.push('console: ' + m.text()) })
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
const bar = page.locator('.ed-pages')
const delBtn = bar.getByRole('button', { name: /^Удалить/ })
const addBtn = bar.getByRole('button', { name: /^Добавить/ })
const counter = page.locator('.ed-pages-count')
const toast = page.locator('.ed-toast')
const confirm = page.locator('dialog.ed-confirm')
const label = page.locator('.ed-pager span')
const saved = async () => { await page.waitForTimeout(300); await page.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 }) }
const serverPages = async (token) => (await getBook(token)).pages
// Панель страниц — в середину экрана: внизу её может закрыть панель настроек.
const showBar = () => bar.evaluate((e) => e.scrollIntoView({ block: 'center' }))

// Формат из API: все пределы берём оттуда, не из теста.
const { body: created } = await api('/books', { method: 'POST', body: JSON.stringify({ templateId: 'travel-minimal' }) })
const token = created.token
const f = (await getBook(token)).format
log(`  format: ${f.pages} pages by default, ${f.minPages}…${f.maxPages}, step ${f.pageStep}`)
const original = (await serverPages(token)).map((p) => p.id)

// 1. Новая книга — f.pages страниц; это максимум: добавить нельзя, причина видна.
await page.goto(`${base}/b/${token}?page=3`)
await page.locator('.ed-page').waitFor()
await showBar()
check((await counter.textContent()).startsWith(`Страниц: ${f.pages} из ${f.maxPages}.`), `counter: "${await counter.textContent()}"`)
check(await addBtn.isDisabled() && (await addBtn.getAttribute('title')) === `Максимум ${f.maxPages} страниц`, `at max "Добавить" is disabled with "Максимум ${f.maxPages} страниц"`)
check(await page.locator('.ed-strip-add button').isDisabled(), 'the "+" tile in the strip is disabled too')
const hb = await delBtn.boundingBox()
check(hb.height >= 44, `delete button is ${Math.round(hb.height)} px high (≥ 44)`)

// 2. Пустой лист (страницы 3–4 без фото и текста) удаляется сразу, без вопроса.
check((await delBtn.textContent()) === 'Удалить страницы 3–4', `button names the whole leaf: "${await delBtn.textContent()}"`)
await delBtn.click()
await toast.waitFor()
check((await confirm.count()) === 0 && (await toast.textContent()).startsWith('Страницы 3–4 удалены'), 'empty leaf deleted without a question, toast "Страницы 3–4 удалены"')
await page.waitForTimeout(600) // докрутка к сообщению
const tb = await toast.boundingBox()
const panelTop = (await page.locator('.ed-toolbar').boundingBox()).y
check(tb.y + tb.height <= panelTop + 1, `the message is scrolled above the bottom panel (${Math.round(tb.y + tb.height)} ≤ ${Math.round(panelTop)})`)
check((await counter.textContent()).startsWith(`Страниц: ${f.pages - f.pageStep} из ${f.maxPages}.`) && (await label.textContent()) === `Страница 3 из ${f.pages - f.pageStep}`,
  `counter and pager follow (${await label.textContent()})`)
await page.screenshot({ path: `${out}/pg-1-deleted.png` })
await saved()
let ids = (await serverPages(token)).map((p) => p.id)
check(ids.length === f.pages - f.pageStep && !ids.includes(original[2]) && !ids.includes(original[3]), 'server saved the book without pages 3–4')

// 3. «Отменить» возвращает страницы на то же место.
await toast.getByRole('button', { name: 'Отменить' }).click()
await saved()
ids = (await serverPages(token)).map((p) => p.id)
check(JSON.stringify(ids) === JSON.stringify(original) && (await label.textContent()) === `Страница 3 из ${f.pages}`, 'undo puts pages 3–4 back in place (same ids, same order), saved')

// 4. Лист с текстом — сначала вопрос; «Отмена» ничего не меняет, «Удалить» удаляет.
await page.goto(`${base}/b/${token}?page=5`) // стр. 5 — цитата шаблона
await page.locator('.ed-page').waitFor()
await showBar()
await delBtn.click()
await confirm.waitFor()
check((await confirm.locator('h2').textContent()) === 'Удалить страницы 5–6?', 'leaf with text: confirmation "Удалить страницы 5–6?"')
await page.screenshot({ path: `${out}/pg-2-confirm.png` })
await confirm.getByRole('button', { name: 'Отмена' }).click()
check((await confirm.count()) === 0 && (await counter.textContent()).startsWith(`Страниц: ${f.pages} из`), '"Отмена" keeps the pages')
await delBtn.click()
await confirm.getByRole('button', { name: 'Удалить' }).click()
await saved()
ids = (await serverPages(token)).map((p) => p.id)
check(!ids.includes(original[4]) && !ids.includes(original[5]) && ids.length === f.pages - f.pageStep, '"Удалить" removes pages 5–6')

// 5. До минимума: дальше удалять нельзя, причина видна. Число страниц — всегда кратно шагу.
let steps = 0
while (await delBtn.isEnabled() && steps < 20) {
  await showBar()
  await delBtn.click()
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: 'Удалить' }).click()
  steps++
  const n = Number((await counter.textContent()).match(/Страниц: (\d+)/)[1])
  if (n % f.pageStep !== 0 || n < f.minPages) problems.push(`FAIL: page count ${n} after a delete`)
}
await saved()
const atMin = (await serverPages(token)).length
check(atMin === f.minPages && await delBtn.isDisabled() && (await delBtn.getAttribute('title')) === `Минимум ${f.minPages} страниц`,
  `stops at the minimum ${f.minPages}: "Удалить" disabled with "Минимум ${f.minPages} страниц" (server: ${atMin})`)
check((await counter.textContent()).includes(`Минимум ${f.minPages} страниц. Добавить можно: будет ${f.minPages + f.pageStep}.`), `hint at the minimum: "${await counter.textContent()}"`)
await page.screenshot({ path: `${out}/pg-3-min.png` })

// 6. Добавить: после листа открытой страницы, с устройством соседнего листа, без содержимого.
await page.goto(`${base}/b/${token}?page=1`)
await page.locator('.ed-page').waitFor()
await showBar()
await addBtn.click()
await saved()
let pages = await serverPages(token)
check(pages.length === f.minPages + f.pageStep && pages[2].id.startsWith('pg-') && pages[3].id.startsWith('pg-') && (await label.textContent()) === `Страница 3 из ${pages.length}`,
  `"Добавить" inserts a leaf after pages 1–2 and opens it (${await label.textContent()})`)
const slots = pages[2].elements.filter((e) => e.type === 'photo_slot')
check(slots.length > 0 && slots.every((s) => !s.assetId) && pages[2].elements.every((e) => e.type !== 'sticker' && (e.type !== 'text' || e.text === '')),
  'new page copies the frames of the neighbour leaf, without photos, text or stickers')

// 7. «+» в ленте — лист в конец; быстрые нажатия подряд не теряются и не выходят за максимум.
const tile = page.locator('.ed-strip-add button')
await tile.click()
await saved()
pages = await serverPages(token)
check(pages.length === f.minPages + 2 * f.pageStep && pages.at(-1).id.startsWith('pg-'), `"+" in the strip adds a leaf at the end (${pages.length})`)
await showBar()
for (let i = 0; i < 10; i++) await addBtn.click({ force: true, timeout: 2000 }).catch(() => {})
await saved()
pages = await serverPages(token)
check(pages.length === f.maxPages && new Set(pages.map((p) => p.id)).size === pages.length, `rapid taps: book grows to the maximum ${f.maxPages} and stops, all saved, ids unique`)

// 8. Сервер: число страниц — в пределах и кратно шагу.
{
  const b = await getBook(token)
  const keep = b.pages
  check((await putPages(token, b, keep.slice(0, keep.length - 1))).status === 400, `${keep.length - 1} pages (not a multiple of ${f.pageStep}) → 400`)
  check((await putPages(token, b, keep.slice(0, f.minPages - f.pageStep))).status === 400, `${f.minPages - f.pageStep} pages (below minimum) → 400`)
  const more = [...keep, { ...keep[0], id: 'x1' }, { ...keep[1], id: 'x2' }]
  check((await putPages(token, b, more)).status === 400, `${more.length} pages (above maximum) → 400`)
  check((await putPages(token, b, keep.slice(0, f.minPages))).status === 200, `${f.minPages} pages → saved`)
}

// 9. Заявка: число страниц, предупреждение о пустых страницах — без запрета.
await page.goto(`${base}/b/${token}/order`)
await page.locator('.order-book').waitFor()
check((await page.locator('.order-book').textContent()).includes(`${f.minPages} страниц`), `order form shows ${f.minPages} pages`)
const issues = await page.locator('.book-issues').textContent()
check(issues.includes('Пустые страницы') || issues.includes('пустая — удалить её?'), `order form warns about empty pages: "${issues.slice(0, 90)}…"`)
check(await page.getByRole('button', { name: 'Отправить заявку' }).isVisible(), 'ordering is not blocked')
await page.screenshot({ path: `${out}/pg-4-order.png`, fullPage: true })

// 10. Компьютер: добавление и удаление отменяются общей «Отменить» (Ctrl+Z);
//     после неё «Отменить» в сообщении страницы второй раз не вставляет.
{
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  desk.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
  await desk.goto(`${base}/b/${token}?page=3`)
  const dbar = desk.locator('.ed-pages')
  await dbar.waitFor()
  await dbar.getByRole('button', { name: /^Добавить/ }).click()
  await desk.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
  await desk.keyboard.press('Control+z')
  await desk.waitForTimeout(300)
  await desk.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
  check((await serverPages(token)).length === f.minPages, 'desktop: Ctrl+Z undoes adding pages')
  const before = (await serverPages(token)).map((p) => p.id)
  await dbar.getByRole('button', { name: /^Добавить/ }).click() // теперь можно удалить лист
  await desk.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
  await dbar.getByRole('button', { name: /^Удалить/ }).click()
  if (await desk.locator('dialog.ed-confirm').isVisible().catch(() => false)) await desk.locator('dialog.ed-confirm').getByRole('button', { name: 'Удалить' }).click()
  await desk.locator('.ed-toast').waitFor()
  await desk.keyboard.press('Control+z') // общая отмена вернула страницы…
  await desk.locator('.ed-toast').getByRole('button', { name: 'Отменить' }).click() // …а «Отменить» в сообщении — уже ничего
  await desk.waitForTimeout(300)
  await desk.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
  const after = (await serverPages(token)).map((p) => p.id)
  check(after.length === before.length + f.pageStep && new Set(after).size === after.length,
    `Ctrl+Z then "Отменить" in the message: pages restored once, ids unique (${after.length} pages)`)
  await desk.screenshot({ path: `${out}/pg-5-desktop.png` })
  await desk.close()
}

await browser.close()
log(problems.length ? `\n${problems.length} problem(s):\n` + problems.join('\n') : '\nall page checks passed')
process.exit(problems.length ? 1 : 0)
