// Свободный текст: тап и повторный тап, перенос пальцем и мышью, ручки размера
// и поворота, привязка с направляющими, отмена/повтор, копия, «вперёд»,
// предупреждение о зоне реза, автосохранение после жеста, кегль на любом экране.
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
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const api = async (path, init) => {
  const r = await fetch(`${apiBase}/api${path}`, init)
  return { status: r.status, body: await r.json().catch(() => null) }
}
const getBook = async (token) => (await api(`/books/${token}`)).body
const putBook = (token, b) => api(`/books/${token}`, {
  method: 'PUT',
  body: JSON.stringify({ version: b.version, cover: b.cover, pages: b.pages, backCover: b.backCover }),
})
const texts = async (token) => (await getBook(token)).pages[1].elements.filter((e) => e.type === 'text')

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()) })
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
let puts = 0
page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/api/books/')) puts++ })
const waitSaved = (p = page) => p.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
const settle = async (p = page) => { await p.waitForTimeout(300); await waitSaved(p) }
const dialog = page.locator('dialog.ed-dialog')
const frame = page.locator('.ed-text-frame')
const center = (b) => [b.x + b.width / 2, b.y + b.height / 2]

// Палец (через CDP): pointer-события с pointerType = touch, как на телефоне.
const cdp = await ctx.newCDPSession(page)
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
// Жест ~0.8 с; during — проверки посреди жеста, до того как палец отпущен.
async function touchDrag([x0, y0], [x1, y1], during) {
  await touch('touchStart', x0, y0)
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8)
    await sleep(100)
  }
  if (during) await during()
  await touch('touchEnd')
}

// 1. Книга, страница 2 (две рамки для фото, текста нет). Отменять пока нечего.
const { body: created } = await api('/books', { method: 'POST', body: JSON.stringify({ templateId: 'travel-minimal' }) })
const token = created.token
await page.goto(`${base}/b/${token}?page=2`)
await page.locator('.ed-page').waitFor()
const undoBtn = page.getByRole('button', { name: 'Отменить' })
const redoBtn = page.getByRole('button', { name: 'Повторить' })
check(await undoBtn.isDisabled() && await redoBtn.isDisabled(), 'nothing to undo or redo in a freshly opened book')

// 2. Добавить текст → рамка, ручки размера и поворота; зона касания ручки ≥ 44px.
await page.getByRole('button', { name: 'Добавить текст' }).click()
await dialog.locator('textarea').fill('Привет, Алматы!')
await dialog.getByRole('button', { name: 'Готово' }).click()
await settle()
check((await page.locator('.ed-text.is-selected .ed-handle').count()) === 5 && (await page.locator('.ed-text.is-selected .ed-rotate').count()) === 1,
  'selected text shows 5 resize handles and a rotate handle')
const hb = await page.locator('.ed-handle-e').boundingBox()
check(hb.width >= 44 && hb.height >= 44, `handle touch area is ${hb.width}×${hb.height} px (≥ 44)`)
await page.screenshot({ path: `${out}/tm-1-selected.png` })

// 3. Тап по невыбранному — только выбор; повторный тап — ввод текста.
await page.getByRole('button', { name: 'Готово' }).click()
check((await page.locator('.ed-text.is-selected').count()) === 0, '"Готово" deselects the text')
let c = center(await frame.boundingBox())
await page.touchscreen.tap(c[0], c[1])
await page.waitForTimeout(200)
check((await page.locator('.ed-text.is-selected').count()) === 1 && (await dialog.count()) === 0, 'first tap selects the block, no text input yet')
await page.waitForTimeout(600) // выбранный блок докручивается выше нижней панели
c = center(await frame.boundingBox())
await page.touchscreen.tap(c[0], c[1])
await dialog.waitFor({ timeout: 3000 }).catch(() => {})
check((await dialog.count()) === 1, 'second tap on the selected block opens text input')
await dialog.getByRole('button', { name: 'Готово' }).click()

// 4. Перенос пальцем: ни одного сохранения во время жеста, одно — после.
let [t0] = await texts(token)
const pageBox = await page.locator('.ed-page').boundingBox()
const mmPerPx = 200 / pageBox.width
c = center(await frame.boundingBox())
await settle()
puts = 0
let putsDuring = -1
await touchDrag(c, [c[0] + 20, c[1] - 100], async () => { putsDuring = puts })
check((await dialog.count()) === 0, 'dragging does not open text input')
await page.waitForTimeout(2500)
await waitSaved()
let [t1] = await texts(token)
check(putsDuring === 0 && puts === 1, `no save while the finger moves, exactly one after (during: ${putsDuring}, total: ${puts})`)
check(near(t1.x - t0.x, (20 * mmPerPx) / 2) && near(t1.y - t0.y, (-100 * mmPerPx) / 2) && t1.w === t0.w,
  `finger drag moves the block (x ${t0.x}→${t1.x}, y ${t0.y}→${t1.y})`)

// 5. Привязка: центр блока рядом с серединой страницы — прилипает, видна направляющая.
c = center(await frame.boundingBox())
const toMiddle = pageBox.x + pageBox.width / 2 - c[0] + 5 // на 5 px не доводим
let guideVisible = false
await touchDrag(c, [c[0] + toMiddle, c[1]], async () => { guideVisible = await page.locator('.ed-guide-v').isVisible() })
await settle()
;[t1] = await texts(token)
check(guideVisible && near(t1.x + t1.w / 2, 50, 0.01), `snaps to the page centre with a guide line (centre ${t1.x + t1.w / 2}%)`)
check((await page.locator('.ed-guide').count()) === 0, 'guide line disappears after the gesture')

// 6. Ручка справа: уже на 60 px, левый край на месте.
c = center(await page.locator('.ed-handle-e').boundingBox())
const before = t1
await touchDrag(c, [c[0] - 60, c[1]])
await settle()
;[t1] = await texts(token)
check(near(t1.x, before.x, 0.01) && near(t1.w, before.w - (60 * mmPerPx) / 2), `right handle: width ${before.w}→${t1.w}%, left edge stays`)

// 7. Поворот: ручку над блоком ведём вправо от центра — ровно 90° (прилипание).
const fc = center(await frame.boundingBox())
c = center(await page.locator('.ed-rotate').boundingBox())
let angleShown = ''
await touchDrag(c, [fc[0] + 120, fc[1] + 3], async () => { angleShown = await page.locator('.ed-rotate-value').textContent() })
await settle()
;[t1] = await texts(token)
const pvTransform = await page.locator('.ed-page .pv-text').last().evaluate((e) => e.style.transform)
check(t1.rotation === 90 && pvTransform === 'rotate(90deg)' && angleShown === '90°', `rotate handle: 90° saved, shown while turning ("${angleShown}") and drawn by PageView`)
await page.screenshot({ path: `${out}/tm-2-rotated.png` })

// 8. Отменить / повторить.
await undoBtn.click()
await settle()
;[t1] = await texts(token)
check((t1.rotation ?? 0) === 0 && !(await redoBtn.isDisabled()), 'undo restores the angle (0°)')
await redoBtn.click()
await settle()
;[t1] = await texts(token)
check(t1.rotation === 90, 'redo turns it back to 90°')
await undoBtn.click()
await settle()

// 9. За край не утащить целиком; у края — мягкое предупреждение.
c = center(await frame.boundingBox())
await touchDrag(c, [pageBox.x + pageBox.width + 200, pageBox.y + pageBox.height + 200])
await settle()
;[t1] = await texts(token)
check(t1.x <= 100 - t1.w / 4 + 0.01 && t1.y <= 100 - t1.h / 4 + 0.01 && t1.x < 100 && t1.y < 100,
  `dragged far off the page, a quarter of the block stays on it (x=${t1.x} w=${t1.w}, y=${t1.y} h=${t1.h})`)
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'block hanging off the page does not make the screen scroll sideways')
check(await page.locator('.ed-text .ed-dpi-badge', { hasText: 'Близко к краю' }).isVisible() && await page.locator('.ed-warning-soft').isVisible(),
  '"Близко к краю" on the block and an explanation in the panel')
await page.screenshot({ path: `${out}/tm-3-near-cut.png` })
await undoBtn.click()
await settle()
check((await page.locator('.ed-text .ed-dpi-badge').count()) === 0, 'back inside the safe zone — no warning')

// 10. Копия — поверх, со сдвигом; «Вперёд» поднимает оригинал над ней.
await page.getByRole('button', { name: 'Копия' }).click()
await settle()
let all = await texts(token)
check(all.length === 2 && all[1].text === all[0].text && near(all[1].x - all[0].x, 3) && near(all[1].y - all[0].y, 3),
  `"Копия" adds the same text 6 mm right and down (${all.length} texts)`)
check(await page.getByRole('button', { name: 'На передний план' }).isDisabled(), 'the copy is on top: "Вперёд" is disabled')
c = center(await frame.last().boundingBox())
await touchDrag(c, [c[0], c[1] + 150]) // отодвигаем копию, чтобы достать оригинал
await settle()
// Сняли выбор — панель внизу стала низкой и не закрывает оригинал.
await page.getByRole('button', { name: 'Готово' }).click()
c = center(await frame.first().boundingBox())
await page.touchscreen.tap(c[0], c[1])
await page.getByRole('button', { name: 'На передний план' }).click()
await settle()
all = (await getBook(token)).pages[1].elements
check(all.at(-1).id === t1.id && await page.getByRole('button', { name: 'На передний план' }).isDisabled(), '"Вперёд" moves the original above the copy')

// 11. Кегль: на телефоне — доля ширины страницы, как на бумаге (14 пт = 4.94 мм из 200).
const share = (p, sel) => p.locator(sel).first().evaluate((d) => parseFloat(getComputedStyle(d).fontSize) / d.closest('.pv-trim').clientWidth)
const expected = (14 * 25.4) / 72 / 200
const phoneShare = await share(page, '.ed-page .pv-text > div')
await page.close()

// 12. Компьютер: двойной клик — ввод; мышью тянется сразу, ввод не открывается; Ctrl+Z.
const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
desk.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
await desk.goto(`${base}/b/${token}?page=2`)
const dframe = desk.locator('.ed-text-frame').last()
await dframe.waitFor()
await desk.evaluate(() => document.fonts.ready)
const deskShare = await share(desk, '.ed-page .pv-text > div')
check(near(phoneShare, expected, expected * 0.005) && near(deskShare, expected, expected * 0.005),
  `font size is the same share of the page width on phone and desktop (${phoneShare.toFixed(5)}, ${deskShare.toFixed(5)}; paper: ${expected.toFixed(5)})`)
await dframe.dblclick()
check(await desk.locator('dialog.ed-dialog').isVisible(), 'desktop: double click opens text input')
await desk.getByRole('button', { name: 'Отмена' }).click()
await desk.locator('.ed-stage').click({ position: { x: 5, y: 5 } }) // пустое место — снять выбор
check((await desk.locator('.ed-text.is-selected').count()) === 0, 'click on an empty spot deselects')
const startX = (await texts(token)).find((e) => e.id === t1.id).x
const db = await dframe.boundingBox()
const dmm = 200 / (await desk.locator('.ed-page').boundingBox()).width
await desk.mouse.move(db.x + 30, db.y + db.height / 2)
await desk.mouse.down()
await desk.mouse.move(db.x + 110, db.y + db.height / 2 + 7, { steps: 8 })
await desk.mouse.up()
await settle(desk)
const movedX = (await texts(token)).find((e) => e.id === t1.id).x
check(near(movedX - startX, (80 * dmm) / 2) && (await desk.locator('dialog.ed-dialog').count()) === 0 && (await desk.locator('.ed-text.is-selected').count()) === 1,
  `desktop: mouse drags an unselected block right away, selects it, no text input (x ${startX}→${movedX})`)
await desk.keyboard.press('Control+z')
await settle(desk)
const undoneX = (await texts(token)).find((e) => e.id === t1.id).x
await desk.keyboard.press('Control+Shift+z')
await settle(desk)
const redoneX = (await texts(token)).find((e) => e.id === t1.id).x
check(undoneX === startX && redoneX === movedX, `Ctrl+Z / Ctrl+Shift+Z undo and redo the move (${undoneX}, ${redoneX})`)

// 13. Превью — тот же PageView: тот же кегль, положение и поворот.
await desk.goto(`${base}/b/${token}/preview`)
await desk.getByRole('button', { name: 'Для печати' }).click()
await desk.getByRole('button', { name: 'Следующий разворот' }).click()
await desk.getByRole('button', { name: 'Следующий разворот' }).click()
await desk.locator('.pv-text').first().waitFor()
const prevShare = await share(desk, '.pp-spread .pv-text > div')
check(near(prevShare, expected, expected * 0.005), `preview: same font size share (${prevShare.toFixed(5)})`)
await desk.screenshot({ path: `${out}/tm-4-preview.png` })
await desk.close()

// 14. Сервер: поворот только −180…180, текст хотя бы частью на странице.
{
  const b = await getBook(token)
  const bad = (patch) => {
    const copy = structuredClone(b)
    Object.assign(copy.pages[1].elements.find((e) => e.type === 'text'), patch)
    return putBook(token, copy)
  }
  check((await bad({ rotation: 200 })).status === 400, 'text rotation 200° → 400')
  check((await bad({ x: 100 })).status === 400, 'text entirely off the page → 400')
  check((await bad({ x: -40, rotation: -30 })).status === 200, 'text partly off the page, rotated → saved')
}

await browser.close()
log(problems.length ? `\n${problems.length} problem(s):\n` + problems.join('\n') : '\nall free-text checks passed')
process.exit(problems.length ? 1 : 0)
