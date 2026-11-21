// Лоток «Мои фото» и массовая загрузка: 20 фото за раз (одно не грузится —
// автоповторы, потом «Повторить»), повторы пропускаются, выбор нескольких фото
// в пустые рамки страницы, перетаскивание в рамку, автораскладка по дате съёмки
// и её отмена, удаление фото из лотка с отменой, HEIC, предупреждение при
// закрытии вкладки, шторка на телефоне, число неиспользованных фото в заявке
// и в админке.
// Запуск: make e2e (сервисы должны быть запущены через make up).
import { chromium, devices } from 'playwright'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const apiBase = process.env.API_URL ?? 'http://localhost:8080'
const out = 'shots'
mkdirSync(out, { recursive: true })
const problems = []
const log = (...a) => console.log(...a)
const check = (cond, msg) => { if (!cond) problems.push('FAIL: ' + msg); log((cond ? 'ok   ' : 'FAIL ') + msg) }
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const getBook = async (token) => (await fetch(`${apiBase}/api/books/${token}`)).json()
const slotsOf = (b) => [b.cover, ...b.pages, b.backCover].map((p) => p.elements.filter((e) => e.type === 'photo_slot').map((e) => e.assetId ?? null))

const browser = await chromium.launch()

// ---------- 20 фото с датой съёмки в EXIF ----------
// Фото i снято 19 − i января (последнее загруженное — самое раннее), у двух
// последних даты нет: автораскладка должна пойти по дате, а их поставить в конце.
const photos = []
{
  const p = await browser.newPage()
  for (let i = 0; i < 20; i++) {
    const dataUrl = await p.evaluate((i) => {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 1200
      const g = c.getContext('2d')
      g.fillStyle = `hsl(${i * 18} 60% 55%)`; g.fillRect(0, 0, 1600, 1200)
      g.fillStyle = '#fff'; g.font = 'bold 500px sans-serif'; g.fillText(String(i), 400, 800)
      return c.toDataURL('image/jpeg', 0.8)
    }, i)
    const jpg = Buffer.from(dataUrl.split(',')[1], 'base64')
    const date = i < 18 ? `2024:01:${String(19 - i).padStart(2, '0')} 10:00:00` : null
    const file = date ? withDate(jpg, date) : jpg
    const name = `photo-${String(i).padStart(2, '0')}.jpg`
    writeFileSync(`${out}/${name}`, file)
    photos.push({ i, name, path: `${out}/${name}`, size: file.length, sha: sha(file), takenAt: date && date.replace(/^(\d+):(\d+):(\d+) /, '$1-$2-$3T') })
  }
  await p.close()
}

// APP1 «Exif» с одной записью DateTimeOriginal — сразу за началом JPEG.
function withDate(jpg, date) {
  const tiff = Buffer.alloc(70)
  tiff.write('MM', 0, 'latin1'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4)
  tiff.writeUInt16BE(1, 8); tiff.writeUInt16BE(0x8769, 10); tiff.writeUInt16BE(4, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt32BE(26, 18)
  tiff.writeUInt16BE(1, 26); tiff.writeUInt16BE(0x9003, 28); tiff.writeUInt16BE(2, 30); tiff.writeUInt32BE(20, 32); tiff.writeUInt32BE(44, 36)
  tiff.write(date, 44, 'latin1')
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload])
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)])
}

// ---------- Компьютер: лоток — колонка справа ----------
const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
desk.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
await desk.goto(`${base}/templates/travel-minimal`)
await desk.getByRole('button', { name: 'Создать книгу по этому шаблону' }).click()
await desk.waitForURL(/\/b\/[A-Z2-7]{26}$/)
const token = desk.url().split('/b/')[1]
await desk.locator('.ed-page').waitFor()
const tray = desk.locator('.ed-tray')
check(await tray.isVisible(), 'desktop: the tray is always visible next to the page')
const waitSaved = () => desk.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 15000 })

// 1. 20 файлов за раз; файл №7 хранилище не принимает (обрыв) — два автоповтора,
//    потом он в списке ошибок, остальные загружаются.
const failing = photos[7]
let failingPuts = 0
let maxParallel = 0
let activePuts = 0
// Сбойный файл узнаём по размеру в запросе «дай ссылку для загрузки» и
// запоминаем id фото из ответа: PUT по этой ссылке обрываем.
const failingIds = new Set()
await desk.route('**/api/books/*/assets', async (route) => {
  const req = route.request()
  if (req.method() !== 'POST') return route.continue()
  const res = await route.fetch()
  const body = await res.json()
  if (JSON.parse(req.postData() ?? '{}').size === failing.size) failingIds.add(body.assetId)
  return route.fulfill({ response: res, json: body })
})
await desk.route('**/originals/**', async (route) => {
  const req = route.request()
  if (req.method() !== 'PUT') return route.continue()
  if ([...failingIds].some((id) => req.url().includes(id))) {
    failingPuts++
    return route.abort('connectionreset')
  }
  return route.continue()
})
// Сколько загрузок в хранилище идёт одновременно — по событиям браузера.
const isPut = (r) => r.method() === 'PUT' && r.url().includes('/originals/')
desk.on('request', (r) => { if (isPut(r)) maxParallel = Math.max(maxParallel, ++activePuts) })
desk.on('requestfinished', (r) => { if (isPut(r)) activePuts-- })
desk.on('requestfailed', (r) => { if (isPut(r)) activePuts-- })
const started = Date.now()
await desk.locator('input[type=file]').setInputFiles(photos.map((p) => p.path))
await desk.locator('.ed-tray-item.is-failed').waitFor({ timeout: 90000 })
await desk.locator('.ed-tray-item.is-uploading, .ed-tray-item.is-waiting').first().waitFor({ state: 'detached', timeout: 90000 })
log(`     20 files in ${((Date.now() - started) / 1000).toFixed(1)} s`)
check((await desk.locator('.ed-tray-photo[data-asset-id]').count()) === 19, '19 of 20 photos uploaded despite one failing file')
check(failingPuts === 3, `failing file tried 3 times: first try + 2 automatic retries (got ${failingPuts})`)
check(maxParallel <= 3, `no more than 3 uploads at once (max seen ${maxParallel})`)
check((await tray.locator('.ed-tray-failed').textContent()).includes('Не загрузились: 1 фото'), 'error list: "Не загрузились: 1 фото"')
await desk.screenshot({ path: `${out}/tray-1-failed.png` })

await desk.unroute('**/originals/**')
await desk.unroute('**/api/books/*/assets')
await tray.locator('.ed-tray-item.is-failed').getByRole('button', { name: 'Повторить' }).click()
await desk.locator('.ed-tray-item.is-failed').waitFor({ state: 'detached', timeout: 30000 })
await desk.locator('.ed-tray-photo[data-asset-id]').nth(19).waitFor({ timeout: 30000 })
check((await tray.locator('.ed-tray-head p').textContent()) === 'Использовано 0 из 20 фото', 'after «Повторить» all 20 photos are in the tray, counter "Использовано 0 из 20 фото"')

let b = await getBook(token)
const idOf = new Map(b.assets.map((a) => [a.sha256, a.id]))
const id = (i) => idOf.get(photos[i].sha)
check(b.assets.length === 20 && photos.every((p) => idOf.has(p.sha)), 'server has all 20 photos with their hashes')
check(b.assets.find((a) => a.id === id(0))?.takenAt === '2024-01-19T10:00:00', 'EXIF date of capture saved with the photo')

// 2. Повторы: те же файлы и копия под другим именем — пропускаются, не загружаются.
writeFileSync(`${out}/copy-of-3.jpg`, readFileSync(photos[3].path))
let postsAfter = 0
desk.on('request', (r) => { if (r.method() === 'POST' && /\/assets$/.test(r.url())) postsAfter++ })
await desk.locator('input[type=file]').setInputFiles([photos[0].path, photos[1].path, `${out}/copy-of-3.jpg`])
await tray.locator('.ed-tray-note', { hasText: 'уже есть в книге' }).waitFor({ timeout: 15000 })
check((await tray.locator('.ed-tray-note', { hasText: 'уже есть в книге' }).textContent()).startsWith('3 фото уже есть в книге'), 'duplicates skipped with a message: "3 фото уже есть в книге"')
check(postsAfter === 0 && (await getBook(token)).assets.length === 20, 'duplicates are not uploaded again')

// 3. Страница 2 (две пустые рамки): тап по рамке — выбор нескольких фото,
//    они встают в рамки страницы в порядке выбора.
await desk.keyboard.press('ArrowRight')
await desk.keyboard.press('ArrowRight')
check((await desk.locator('.ed-pager span').textContent()) === 'Страница 2 из 16', 'on page 2')
await desk.locator('.ed-slot').first().click()
check((await tray.locator('.ed-tray-pick').textContent()).includes('до 2 фото'), 'pick mode: "Отметьте до 2 фото…"')
await tray.locator(`[data-asset-id="${id(5)}"]`).click()
await tray.locator(`[data-asset-id="${id(3)}"]`).click()
check((await tray.locator('.ed-tray-order').allTextContents()).join() === '1,2', 'picked photos are numbered in the order chosen')
await desk.screenshot({ path: `${out}/tray-2-pick.png` })
await tray.getByRole('button', { name: 'Вставить 2 фото' }).click()
await waitSaved()
b = await getBook(token)
check(JSON.stringify(slotsOf(b)[2]) === JSON.stringify([id(5), id(3)]), 'page 2: first chosen photo in the first slot, second in the second')

// 4. Страница 3: перетаскиваем миниатюру мышью в рамку.
await desk.keyboard.press('ArrowRight')
await tray.locator(`[data-asset-id="${id(9)}"]`).dragTo(desk.locator('.ed-slot').first())
await waitSaved()
b = await getBook(token)
check(slotsOf(b)[3][0] === id(9), 'drag and drop from the tray into a slot (desktop)')
check((await tray.locator(`[data-asset-id="${id(9)}"] .ed-tray-used`).textContent()) === '✓', 'used photo gets a check mark in the tray')

// 5. «Разложить автоматически»: остальные 17 фото — в пустые рамки по порядку
//    страниц, по дате съёмки (без даты — в конце); заполненные рамки не трогаются.
const manual = slotsOf(b)
await tray.getByRole('button', { name: 'Разложить автоматически' }).click()
await tray.locator('.ed-toast', { hasText: 'Разложено 17 фото' }).waitFor()
check(true, 'toast "Разложено 17 фото." with «Отменить»')
await waitSaved()
b = await getBook(token)
const after = slotsOf(b)
const kept = manual.every((page, pi) => page.every((v, si) => v === null || after[pi][si] === v))
check(kept, 'auto-layout keeps slots that were already filled')
const filled = after.flatMap((page, pi) => page.map((v, si) => (manual[pi][si] === null ? v : undefined))).filter((v) => v !== undefined && v !== null)
const unused = photos.filter((p) => ![3, 5, 9].includes(p.i))
const expected = [...unused.filter((p) => p.takenAt).sort((x, y) => (x.takenAt < y.takenAt ? -1 : 1)), ...unused.filter((p) => !p.takenAt)].map((p) => id(p.i))
check(JSON.stringify(filled) === JSON.stringify(expected), 'photos placed by EXIF date of capture, photos without a date last (upload order)')
check(after[0][0] === id(17), 'cover gets the earliest photo (17, taken 1 January)')
// Фото 1600×1200 на странице 1 во всю страницу — около 200 DPI: «маленькое».
check((await tray.locator('.ed-tray-low').count()) >= 1, 'tray marks photos that are too small for their slot')
await desk.screenshot({ path: `${out}/tray-3-laid-out.png` })

await tray.locator('.ed-toast').getByRole('button', { name: 'Отменить' }).click()
await waitSaved()
b = await getBook(token)
check(JSON.stringify(slotsOf(b)) === JSON.stringify(manual), '«Отменить» returns the book to exactly how it was before auto-layout')

// 6. Удаление фото из лотка: фото стоит на странице 2 — сначала вопрос, рамка
//    освобождается; «Отменить» возвращает фото в лоток и в рамку.
await tray.locator(`[data-asset-id="${id(5)}"]`).click()
await tray.getByRole('button', { name: 'Удалить 1 фото' }).click()
const dialog = desk.locator('dialog.ed-confirm')
await dialog.waitFor()
check((await dialog.textContent()).includes('стр. 2'), 'deleting a used photo asks first and names the page')
await dialog.getByRole('button', { name: 'Удалить' }).click()
await waitSaved()
b = await getBook(token)
check(slotsOf(b)[2][0] === null && b.assets.find((a) => a.id === id(5))?.removed === true, 'after confirming, the slot is empty and the photo is removed from the tray')
check((await tray.locator(`[data-asset-id="${id(5)}"]`).count()) === 0, 'deleted photo disappears from the tray')
await tray.locator('.ed-toast').getByRole('button', { name: 'Отменить' }).click()
await waitSaved()
b = await getBook(token)
check(slotsOf(b)[2][0] === id(5) && !b.assets.find((a) => a.id === id(5))?.removed, '«Отменить» brings the photo back to the tray and to its slot')

// 7. HEIC (как с iPhone): Chromium его не открывает — миниатюру делает сервер.
await desk.locator('input[type=file]').setInputFiles(['fixtures/portrait.heic', 'fixtures/lying.heic'])
await desk.waitForFunction(() => document.querySelectorAll('.ed-tray-photo[data-asset-id]').length === 22, null, { timeout: 30000 })
await desk.waitForFunction(() => !document.querySelector('.ed-tray-wait'), null, { timeout: 30000 })
b = await getBook(token)
const heic = b.assets.slice(-2)
check(heic.every((a) => a.width === 900 && a.height === 1200 && a.viewable), `HEIC sizes read on the server, the lying one turned upright (got ${heic.map((a) => `${a.width}x${a.height}`)})`)
check(JSON.stringify(heic.map((a) => a.takenAt).sort()) === '["2020-03-03T12:00:00","2021-06-01T09:30:00"]', `HEIC date of capture read from EXIF (got ${heic.map((a) => a.takenAt)})`)
const thumb = tray.locator(`[data-asset-id="${heic[1].id}"] img`)
await desk.waitForFunction((id) => { const i = document.querySelector(`[data-asset-id="${id}"] img`); return i && i.complete && i.naturalWidth > 0 }, heic[1].id)
check(JSON.stringify(await thumb.evaluate((i) => [i.naturalWidth, i.naturalHeight])) === '[900,1200]', 'HEIC thumbnail is a JPEG the browser shows, upright')
// HEIC в рамку на всю страницу 1 — попадёт в печатный PDF (через JPEG-копию).
await desk.keyboard.press('ArrowLeft')
await desk.keyboard.press('ArrowLeft')
await tray.locator(`[data-asset-id="${heic[1].id}"]`).dragTo(desk.locator('.ed-slot').first())
await waitSaved()
b = await getBook(token)
check(slotsOf(b)[1][0] === heic[1].id, 'HEIC photo placed on page 1')
await desk.screenshot({ path: `${out}/tray-4-heic.png` })

// 8. Уходят со страницы (закрывают вкладку), пока фото грузится, — браузер
//    переспрашивает. Headless Chromium показывает этот вопрос при переходе
//    на другой адрес, а при закрытии вкладки — нет; обработчик тот же.
let release
await desk.route('**/originals/**', async (route) => {
  if (route.request().method() !== 'PUT') return route.continue()
  await new Promise((r) => { release = r })
  return route.abort()
})
writeFileSync(`${out}/slow.jpg`, Buffer.concat([readFileSync(photos[0].path), Buffer.from('slow')]))
await desk.locator('input[type=file]').setInputFiles([`${out}/slow.jpg`])
await desk.locator('.ed-tray-item.is-uploading').waitFor()
await desk.locator('.ed-header h1').click() // beforeunload спрашивает, только если человек уже что-то нажимал
const asked = new Promise((resolve) => desk.once('dialog', (d) => { resolve(d.type()); d.dismiss() }))
await desk.goto(`${base}/`, { timeout: 5000 }).catch(() => {}) // вопрос отклонён — остаёмся
check((await Promise.race([asked, new Promise((r) => setTimeout(() => r('none'), 5000))])) === 'beforeunload', 'leaving the page during an upload asks to stay')
release?.()
await desk.close()

// ---------- Телефон: шторка снизу ----------
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const phone = await ctx.newPage()
phone.on('pageerror', (e) => problems.push('pageerror (phone): ' + e.message))
await phone.goto(`${base}/b/${token}`)
await phone.locator('.ed-page').waitFor()
check(!(await phone.locator('.ed-tray').isVisible()), 'phone: tray hidden until opened')
await phone.getByRole('button', { name: /^Мои фото · 22/ }).click()
await phone.locator('.ed-tray.is-open').waitFor()
await phone.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running')) // шторка доехала
check((await phone.locator('.ed-tray-head p').textContent()) === 'Использовано 4 из 22 фото', 'phone: bottom sheet with "Использовано 4 из 22 фото"')
const sheet = await phone.locator('.ed-tray.is-open').boundingBox()
const vp = phone.viewportSize()
check(Math.abs(sheet.y + sheet.height - vp.height) < 2 && Math.abs(sheet.width - vp.width) < 1, `phone: tray is a sheet attached to the bottom of the screen (${JSON.stringify(sheet)} in ${JSON.stringify(vp)})`)
// Миниатюры в шторке — с сервера (уменьшенные копии), видимые загружаются.
await phone.waitForFunction(() => [...document.querySelectorAll('.ed-tray.is-open .ed-tray-photo img')].slice(0, 6).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 })
check(true, 'phone: thumbnails in the sheet load from the server')
await phone.screenshot({ path: `${out}/tray-5-phone.png` })
await phone.getByRole('button', { name: 'Закрыть' }).click()
check(!(await phone.locator('.ed-tray.is-open').isVisible()), 'phone: sheet closes')

// 9. Заявка: сколько фото загружено, но не стоит в книге.
await phone.goto(`${base}/b/${token}/order`)
const note = phone.locator('.order-form p', { hasText: 'загружено, но не стоит в книге' })
await note.waitFor()
check((await note.textContent()).startsWith('18 фото загружено'), 'order form: "18 фото загружено, но не стоит в книге"')
const password = process.env.ADMIN_PASSWORD
if (password) {
  const res = await fetch(`${apiBase}/api/books/${token}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Тест лотка', phone: '+77001234567', address: 'ул. Абая, 1', wantedDate: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), comment: '', version: b.version, confirmed: true }),
  })
  const order = await res.json()
  check(res.status === 201, `order created (HTTP ${res.status} ${JSON.stringify(order)})`)
  const auth = 'Basic ' + Buffer.from(`admin:${password}`).toString('base64')
  const detail = async () => (await fetch(`${apiBase}/admin/orders/${order.number}`, { headers: { Authorization: auth } })).text()
  check((await detail()).includes('Фото не в книге') && (await detail()).includes('18 — загружены'), 'admin: order shows "Фото не в книге: 18"')
  // Печатный PDF собирается в фоне; HEIC на странице 1 печатается с JPEG-копии.
  let pdf = ''
  for (let i = 0; i < 90 && !pdf; i++) {
    const html = await detail()
    if (html.includes('/pdf/book')) pdf = 'ready'
    else if (/не собран \(/.test(html) && i > 5) pdf = 'error'
    else await new Promise((r) => setTimeout(r, 2000))
  }
  check(pdf === 'ready', `print PDF with a HEIC photo is built (${pdf || 'timeout'})`)
} else {
  log('     ADMIN_PASSWORD is not set — admin check skipped')
}

await browser.close()
if (problems.length) {
  console.log('\n' + problems.join('\n'))
  process.exit(1)
}
console.log('\nall tray checks passed')
