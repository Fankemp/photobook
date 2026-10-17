// Стикеры в редакторе: окно выбора, добавление, перетаскивание пальцем и мышью,
// размер, поворот, удаление, проверка на сервере.
// Запуск: make e2e (сервисы должны быть запущены через make up).
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const apiBase = process.env.API_URL ?? 'http://localhost:8080'
const out = 'shots'
mkdirSync(out, { recursive: true })
const problems = []
const log = (...a) => console.log(...a)
const check = (cond, msg) => { if (!cond) problems.push('FAIL: ' + msg); log((cond ? 'ok   ' : 'FAIL ') + msg) }
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol

const api = async (path, init) => {
  const r = await fetch(`${apiBase}/api${path}`, init)
  return { status: r.status, body: await r.json().catch(() => null) }
}
const getBook = async (token) => (await api(`/books/${token}`)).body
const putBook = (token, b) => api(`/books/${token}`, {
  method: 'PUT',
  body: JSON.stringify({ version: b.version, cover: b.cover, pages: b.pages, backCover: b.backCover }),
})
const stickerOf = async (token) => (await getBook(token)).pages[1].elements.find((e) => e.type === 'sticker')

const config = JSON.parse(readFileSync('/repo/frontend/src/book/stickers.json', 'utf8'))
const total = config.sets.reduce((n, s) => n + s.stickers.length, 0)

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('409')) problems.push('console: ' + m.text()) })
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
const waitSaved = () => page.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
const settle = async () => { await page.waitForTimeout(300); await waitSaved() }

// Касание пальцем (через CDP): браузер присылает pointer-события с pointerType = touch,
// как на настоящем телефоне. page.mouse дал бы «мышь».
const cdp = await ctx.newCDPSession(page)
async function touchDrag(x0, y0, x1, y1) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y: y0 + ((y1 - y0) * i) / 10 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const center = (b) => [b.x + b.width / 2, b.y + b.height / 2]

// 1. Книга, страница 2.
const { body: created } = await api('/books', { method: 'POST', body: JSON.stringify({ templateId: 'travel-minimal' }) })
const token = created.token
await page.goto(`${base}/b/${token}?page=2`)
await page.locator('.ed-page').waitFor()

// 2. Окно выбора: все наборы и стикеры; Esc закрывает, ничего не добавив.
await page.getByRole('button', { name: 'Добавить стикер' }).click()
const picker = page.locator('dialog.ed-picker')
await picker.waitFor()
await page.waitForFunction(() => [...document.querySelectorAll('.ed-picker img')].every((i) => i.complete && i.naturalWidth > 0))
check((await picker.locator('.ed-picker-set').count()) === config.sets.length && (await picker.locator('.ed-picker-item').count()) === total,
  `picker shows ${config.sets.length} sets and all ${total} stickers, every picture loads`)
await page.screenshot({ path: `${out}/st-1-picker.png` })
await page.keyboard.press('Escape')
check((await picker.count()) === 0 && (await page.locator('.ed-page .pv-sticker').count()) === 0, 'Esc closes the picker without adding anything')

// 3. Добавить «Сердце»: появляется в центре страницы, выбрано, сохраняется.
await page.getByRole('button', { name: 'Добавить стикер' }).click()
await picker.getByRole('button', { name: 'Сердце', exact: true }).click()
const img = page.locator('.ed-page .pv-sticker')
await img.waitFor()
check((await picker.count()) === 0, 'picking a sticker closes the picker')
check((await img.getAttribute('src')) === '/stickers/love/heart.svg' && (await img.evaluate((i) => i.naturalWidth > 0)), 'sticker drawn on the page from /stickers/love/heart.svg')
check((await page.locator('.ed-sticker.is-selected').count()) === 1 && (await page.getByText('Поворот').count()) === 1, 'new sticker is selected, size/rotation panel shown')
await settle()
let st = await stickerOf(token)
check(st?.stickerId === 'love-heart' && st.x === 37 && st.y === 37 && st.w === 26 && st.h === 26 && (st.rotation ?? 0) === 0,
  `saved in the middle of the page, 26% wide (got ${JSON.stringify(st)})`)

// 4. Тянем выбранный стикер пальцем: +25% ширины вправо, −10% высоты вверх.
const pageBox = await page.locator('.ed-page').boundingBox()
let [cx, cy] = center(await page.locator('.ed-sticker').boundingBox())
await touchDrag(cx, cy, cx + pageBox.width * 0.25, cy - pageBox.height * 0.1)
await settle()
st = await stickerOf(token)
check(near(st.x, 62) && near(st.y, 27), `finger drag moves the selected sticker (x 37→${st.x}, y 37→${st.y})`)

// 5. Размер — с тем же центром; поворот — виден на странице.
await page.locator('.ed-range input').nth(0).fill('40')
await page.locator('.ed-range input').nth(1).fill('30')
await settle()
st = await stickerOf(token)
check(st.w === 40 && st.h === 40 && near(st.x + 20, 75) && near(st.y + 20, 40), `size 40% around the same center (got x=${st.x} y=${st.y} w=${st.w})`)
check(st.rotation === 30 && (await img.evaluate((i) => i.style.transform)) === 'rotate(30deg)' && (await page.locator('.ed-range-value').textContent()) === '30°',
  'rotation 30° saved and drawn')
await page.screenshot({ path: `${out}/st-2-rotated.png` })

// 6. За край страницы не утащить.
;[cx, cy] = center(await page.locator('.ed-sticker').boundingBox())
await touchDrag(cx, cy, pageBox.x + pageBox.width + 30, pageBox.y + pageBox.height + 30)
await settle()
st = await stickerOf(token)
check(st.x === 60 && st.y === 60, `dragged past the corner, the sticker stays on the page (x=${st.x} y=${st.y})`)

// 7. Невыбранный стикер пальцем не двигается (по нему прокручивается страница).
await page.getByRole('button', { name: 'Готово' }).click()
;[cx, cy] = center(await page.locator('.ed-sticker').boundingBox())
await touchDrag(cx, cy, cx - 120, cy - 60)
await page.waitForTimeout(800)
const unmoved = await stickerOf(token)
check(unmoved.x === 60 && unmoved.y === 60 && (await page.locator('.ed-sticker.is-selected').count()) === 0, 'finger drag over an unselected sticker does not move it')

// 8. Превью рисует стикер тем же компонентом (разворот «страницы 2–3»).
await page.goto(`${base}/b/${token}/preview`)
await page.getByRole('button', { name: 'Следующий разворот' }).click()
await page.getByRole('button', { name: 'Следующий разворот' }).click()
const pv = page.locator('.pv-sticker').first()
await pv.waitFor()
check((await pv.evaluate((i) => i.style.transform)) === 'rotate(30deg)', 'preview shows the sticker, rotated')
await page.screenshot({ path: `${out}/st-3-preview.png` })
await page.close()

// 9. Сервер принимает только стикеры из набора и поворот в −180…180.
{
  const b = await getBook(token)
  const bad = (patch) => {
    const copy = structuredClone(b)
    Object.assign(copy.pages[1].elements.find((e) => e.type === 'sticker'), patch)
    return putBook(token, copy)
  }
  check((await bad({ stickerId: 'unicorn' })).status === 400, 'unknown sticker id → 400')
  check((await bad({ rotation: 270 })).status === 400, 'rotation 270° → 400')
  check((await bad({ x: 70 })).status === 400, 'sticker sticking out of the page → 400')
}

// 10. Компьютер: мышью стикер тянется сразу, без выбора; удаление.
{
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  desk.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
  await desk.goto(`${base}/b/${token}?page=2`)
  const s = desk.locator('.ed-sticker')
  await s.waitFor()
  const pb = await desk.locator('.ed-page').boundingBox()
  const [x, y] = center(await s.boundingBox())
  await desk.mouse.move(x, y)
  await desk.mouse.down()
  await desk.mouse.move(x - pb.width * 0.3, y - pb.height * 0.2, { steps: 8 })
  await desk.mouse.up()
  await desk.waitForTimeout(300)
  await desk.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
  st = await stickerOf(token)
  check(near(st.x, 30) && near(st.y, 40) && (await desk.locator('.ed-sticker.is-selected').count()) === 1,
    `mouse drags an unselected sticker right away and selects it (x 60→${st.x}, y 60→${st.y})`)

  await desk.getByRole('button', { name: 'Удалить', exact: true }).click()
  await desk.waitForTimeout(300)
  await desk.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
  check((await desk.locator('.ed-page .pv-sticker').count()) === 0 && !(await stickerOf(token)), '"Удалить" removes the sticker from the page and the server')
  await desk.close()
}

// 11. Полная страница (50 элементов — предел сервера): добавлять больше нельзя.
{
  const b = await getBook(token)
  const p = b.pages[1]
  for (let i = p.elements.length; i < 50; i++) {
    p.elements.push({ type: 'sticker', id: `st-full${i}`, x: (i % 10) * 9, y: Math.floor(i / 10) * 9, w: 8, h: 8, stickerId: 'party-star', rotation: 0 })
  }
  check((await putBook(token, b)).status === 200, 'page with 50 elements saved')
  p.elements.push({ type: 'sticker', id: 'st-extra', x: 0, y: 90, w: 8, h: 8, stickerId: 'party-star', rotation: 0 })
  check((await putBook(token, { ...b, version: b.version + 1 })).status === 400, '51st element → 400')

  const full = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await full.goto(`${base}/b/${token}?page=2`)
  await full.locator('.ed-page').waitFor()
  check(await full.getByRole('button', { name: 'Добавить стикер' }).isDisabled() && await full.getByRole('button', { name: 'Добавить текст' }).isDisabled(),
    'on a full page "Добавить стикер" and "Добавить текст" are disabled')
  await full.close()
}

// 12. Новые наборы: вкладка прокручивает к набору, стикер из него сохраняется.
{
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  desk.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
  await desk.goto(`${base}/b/${token}?page=3`)
  await desk.getByRole('button', { name: 'Добавить стикер' }).click()
  const dlg = desk.locator('dialog.ed-picker')
  await dlg.getByRole('button', { name: 'Алматы', exact: true }).click()
  const heading = dlg.locator('.ed-picker-set h3', { hasText: 'Алматы' })
  await desk.waitForTimeout(700) // плавная прокрутка
  const [hb, db] = [await heading.boundingBox(), await dlg.boundingBox()]
  const scrolled = await dlg.evaluate((d) => d.scrollTop)
  // Набор ближе к концу не доедет до самого верха — проверяем, что он стал виден.
  check(scrolled > 0 && hb.y >= db.y && hb.y + hb.height <= db.y + db.height,
    `tab «Алматы» scrolls the picker to that set (scrolled ${Math.round(scrolled)} px, heading at +${Math.round(hb.y - db.y)} px)`)
  await dlg.getByRole('button', { name: 'Юрта', exact: true }).click()
  await desk.waitForTimeout(300)
  await desk.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
  const saved = (await getBook(token)).pages[2].elements.find((e) => e.type === 'sticker')
  check(saved?.stickerId === 'almaty-yurt', `sticker from a new set saved on the server (${saved?.stickerId})`)
  await desk.close()
}

await browser.close()
log(problems.length ? `\n${problems.length} problem(s):\n` + problems.join('\n') : '\nall sticker checks passed')
process.exit(problems.length ? 1 : 0)
