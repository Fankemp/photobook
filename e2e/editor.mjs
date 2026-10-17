// Сквозной тест в настоящем браузере (Chromium через Playwright).
// Запуск: make e2e (сервисы должны быть запущены через make up).
// Проходит путь клиента: шаблон → книга → загрузка фото → кадр → автосохранение,
// плюс обрыв сети, конфликт двух вкладок, неподходящий файл.
// Скриншоты — в e2e/shots/. Тестовые книги остаются в dev-базе.
import { chromium, devices } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const apiBase = process.env.API_URL ?? 'http://localhost:8080'
const out = 'shots'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const problems = []
const log = (...a) => console.log(...a)
const check = (cond, msg) => { if (!cond) problems.push('FAIL: ' + msg); log((cond ? 'ok   ' : 'FAIL ') + msg) }

// 1. JPEG 1200x800 из canvas, затем вставляем EXIF Orientation=6 («повернуть на 90°»),
//    как у фото, снятого телефоном вертикально.
{
  const p = await browser.newPage()
  const dataUrl = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 800
    const g = c.getContext('2d')
    const grd = g.createLinearGradient(0, 0, 1200, 800); grd.addColorStop(0, '#2b6cb0'); grd.addColorStop(1, '#f6ad55')
    g.fillStyle = grd; g.fillRect(0, 0, 1200, 800)
    g.fillStyle = '#fff'; g.font = 'bold 160px sans-serif'; g.fillText('ВЕРХ →', 120, 450)
    return c.toDataURL('image/jpeg', 0.9)
  })
  await p.close()
  const jpg = Buffer.from(dataUrl.split(',')[1], 'base64')
  const tiff = Buffer.from([0x4d,0x4d,0x00,0x2a,0x00,0x00,0x00,0x08, 0x00,0x01, 0x01,0x12,0x00,0x03,0x00,0x00,0x00,0x01,0x00,0x06,0x00,0x00, 0x00,0x00,0x00,0x00])
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload])
  writeFileSync('shots/rotated.jpg', Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]))

  // Крупное фото 3000x2000 — для печати страницы 20×20 см хватает (~254 DPI).
  const p2 = await browser.newPage()
  const big = await p2.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000
    const g = c.getContext('2d')
    const grd = g.createLinearGradient(0, 0, 3000, 2000); grd.addColorStop(0, '#276749'); grd.addColorStop(1, '#f6e05e')
    g.fillStyle = grd; g.fillRect(0, 0, 3000, 2000)
    g.fillStyle = '#fff'; g.font = 'bold 300px sans-serif'; g.fillText('3000×2000', 600, 1100)
    return c.toDataURL('image/jpeg', 0.85)
  })
  await p2.close()
  writeFileSync('shots/big.jpg', Buffer.from(big.split(',')[1], 'base64'))
}

// Куда backend перенаправляет за картинкой: миниатюра (/thumbs/) или оригинал.
async function imageLocation(token, assetId) {
  const res = await fetch(`${apiBase}/api/books/${token}/assets/${assetId}/image`, { redirect: 'manual' })
  return res.headers.get('location') ?? ''
}
async function waitThumb(token, assetId) {
  for (let i = 0; i < 40; i++) {
    if ((await imageLocation(token, assetId)).includes('/thumbs/')) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('409') && !m.text().includes('ERR_FAILED')) problems.push('console: ' + m.text()) })
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
const status = () => page.locator('.ed-status').textContent()
const waitSaved = () => page.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
const api = async (token) => (await (await fetch(`${apiBase}/api/books/${token}`)).json())

// 2. Создаём книгу и открываем редактор.
await page.goto(base + '/templates/travel-minimal')
await page.getByRole('button', { name: 'Создать книгу по этому шаблону' }).click()
await page.waitForURL(/\/b\/[A-Z2-7]{26}$/)
const token = page.url().split('/b/')[1]
await page.locator('.ed-page').waitFor()
check((await status()) === 'Сохранено', 'editor opens, status "Сохранено"')
await page.screenshot({ path: `${out}/ed-1-cover.png` })

// 3. Страница 1 (фото на всю страницу): тап по пустому слоту → выбор файла.
await page.getByRole('button', { name: 'Следующая страница' }).click()
check((await page.locator('.ed-pager span').textContent()) === 'Страница 1 из 20', 'pager shows "Страница 1 из 20"')
const chooser = page.waitForEvent('filechooser')
await page.locator('.ed-slot').first().click()
await (await chooser).setFiles('shots/rotated.jpg')
await page.locator('.ed-slot.is-selected').waitFor({ timeout: 15000 })
check(true, 'photo uploaded, slot selected for adjusting')
await waitSaved()
let b = await api(token)
const slot = b.pages[0].elements[0]
check(!!slot.assetId, 'assetId saved on server')
check(b.assets.length === 1 && b.assets[0].width === 800 && b.assets[0].height === 1200, `rotated size 800x1200 stored (got ${b.assets[0]?.width}x${b.assets[0]?.height})`)
check(await waitThumb(token, slot.assetId), 'thumbnail generated in background, image URL now points to /thumbs/')
// 800x1200 на всю страницу 20×20 см — около 100 DPI: должно быть предупреждение.
check(await page.locator('.ed-slot .ed-dpi-badge').isVisible(), 'small photo → "Фото маленькое" badge on the slot')
check((await page.locator('.ed-dpi-warning').textContent()).includes('нечётким'), 'small photo → full warning in the toolbar')
check(await page.locator('.ed-strip li').nth(1).locator('.ed-strip-warn').isVisible(), 'page strip marks page 1 with a warning dot')
await page.screenshot({ path: `${out}/ed-2-uploaded.png` })

// 4. Двигаем кадр мышью и увеличиваем ползунком.
const box = await page.locator('.ed-slot.is-selected').boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 8 })
await page.mouse.up()
await page.locator('.ed-zoom input').fill('2')
await waitSaved()
b = await api(token)
const crop = b.pages[0].elements[0].crop
check(crop.zoom === 2 && crop.offsetY < 0 && crop.offsetX === 0, `crop saved after drag down + zoom (got ${JSON.stringify(crop)})`)
await page.screenshot({ path: `${out}/ed-3-adjusted.png` })

// 5. Перезагрузка: фото приходит с сервера (через редирект в хранилище), кадр тот же.
await page.reload()
await page.locator('.ed-page').waitFor()
await page.getByRole('button', { name: 'Следующая страница' }).click()
const img = page.locator('.ed-page .pv-slot img').first()
await img.waitFor()
await page.waitForFunction(() => { const i = document.querySelector('.ed-page .pv-slot img'); return i && i.complete && i.naturalWidth > 0 })
const nat = await img.evaluate((i) => [i.naturalWidth, i.naturalHeight, i.style.transform])
check(nat[0] === 800 && nat[1] === 1200 && nat[2] === 'scale(2)', `after reload image loads from storage, oriented 800x1200, zoom kept (got ${nat})`)
await page.screenshot({ path: `${out}/ed-4-reloaded.png` })

// 6. Нет связи: сохранение падает → статус «Нет связи», правка живёт в черновике;
//    перезагружаем страницу (сохранения всё ещё блокируются) — правка на месте.
await page.route('**/api/books/*', (r) => (r.request().method() === 'PUT' ? r.abort() : r.continue()))
await page.locator('.ed-slot').first().click()
await page.locator('.ed-zoom input').fill('3')
await page.locator('.ed-status', { hasText: 'Нет связи' }).waitFor({ timeout: 10000 })
check(true, 'save fails offline → status "Нет связи — сохраним позже"')
await page.screenshot({ path: `${out}/ed-5-offline.png` })
await page.reload()
await page.locator('.ed-page').waitFor()
await page.getByRole('button', { name: 'Следующая страница' }).click()
const zoomAfterReload = await page.locator('.ed-page .pv-slot img').first().evaluate((i) => i.style.transform)
check(zoomAfterReload === 'scale(3)', `draft restored from localStorage after reload (got ${zoomAfterReload})`)
await page.unroute('**/api/books/*')
await page.evaluate(() => window.dispatchEvent(new Event('online')))
await waitSaved()
b = await api(token)
check(b.pages[0].elements[0].crop.zoom === 3, 'draft reaches server when connection is back')

// 7. Конфликт: вторая вкладка с той же книгой сохраняет первой — первая видит предупреждение.
const page2 = await ctx.newPage()
await page2.goto(page.url())
await page2.locator('.ed-page').waitFor()
await page2.getByRole('button', { name: 'Следующая страница' }).click()
await page2.locator('.ed-slot').first().click()
await page2.locator('.ed-zoom input').fill('1.5')
await page2.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })
await page.locator('.ed-slot').first().click()
await page.locator('.ed-zoom input').fill('2.5')
await page.locator('.ed-banner').waitFor({ timeout: 10000 })
check(true, 'stale tab gets conflict banner instead of overwriting')
await page.screenshot({ path: `${out}/ed-6-conflict.png` })
b = await api(token)
check(b.pages[0].elements[0].crop.zoom === 1.5, 'server kept the newer save from the other tab')
await page2.close()

// 8. Убрать фото.
await page.reload()
await page.locator('.ed-page').waitFor()
await page.getByRole('button', { name: 'Следующая страница' }).click()
await page.locator('.ed-slot').first().click()
await page.getByRole('button', { name: 'Убрать' }).click()
await waitSaved()
b = await api(token)
check(!b.pages[0].elements[0].assetId, 'photo removed from slot')

// 8б. Крупное фото: предупреждения нет, пока не увеличишь кадр слишком сильно.
//     После перезагрузки показывается миниатюра (1600 px), а не оригинал (3000 px).
const chooserBig = page.waitForEvent('filechooser')
await page.locator('.ed-slot').first().click()
await (await chooserBig).setFiles('shots/big.jpg')
await page.locator('.ed-slot.is-selected').waitFor({ timeout: 15000 })
check(!(await page.locator('.ed-dpi-badge').isVisible()), 'big photo (~254 DPI) → no warning')
await page.locator('.ed-zoom input').fill('1.5')
check(await page.locator('.ed-dpi-badge').isVisible(), 'big photo zoomed 1.5× (~169 DPI) → warning appears')
await page.locator('.ed-zoom input').fill('1')
await waitSaved()
b = await api(token)
const bigId = b.pages[0].elements[0].assetId
check(await waitThumb(token, bigId), 'big photo thumbnail generated')
await page.reload()
await page.locator('.ed-page').waitFor()
await page.getByRole('button', { name: 'Следующая страница' }).click()
await page.waitForFunction(() => { const i = document.querySelector('.ed-page .pv-slot img'); return i && i.complete && i.naturalWidth > 0 })
const shown = await page.locator('.ed-page .pv-slot img').first().evaluate((i) => [i.naturalWidth, i.naturalHeight])
check(shown[0] === 1600 && shown[1] === 1067, `client sees the 1600 px thumbnail, not the 3000 px original (got ${shown})`)
await page.screenshot({ path: `${out}/ed-8-big-photo.png` })

// 9. Неподходящий файл: сообщение, а не падение.
writeFileSync('shots/note.gif', Buffer.from('GIF89a'))
// Слот уже с фото: выбираем его и жмём «Заменить» — откроется выбор файла.
await page.locator('.ed-slot').first().click()
const chooser2 = page.waitForEvent('filechooser')
await page.getByRole('button', { name: 'Заменить' }).click()
await (await chooser2).setFiles('shots/note.gif')
check((await page.locator('.ed-toolbar .error').textContent()).includes('JPG или PNG'), 'unsupported file → friendly error')

// 10. Превью. Правку, сделанную прямо перед переходом, превью уже показывает
//     (сохранение ещё может лететь — тогда берётся черновик с устройства).
await page.locator('.ed-slot').first().click()
await page.locator('.ed-zoom input').fill('1.2')
await page.getByRole('link', { name: 'Превью' }).click()
await page.waitForURL(/\/preview$/)
// По умолчанию — «Книга»: свою книгу листают, как настоящую.
await page.locator('.pp-book .fb').waitFor()
check((await page.locator('.fb-count').textContent()) === 'Обложка', 'preview opens as a book, closed on the cover')
await page.getByRole('button', { name: 'Следующий разворот' }).click()
await page.locator('.fb-count', { hasText: 'Страница 1' }).waitFor()
const bookImg = page.locator('.fb .pv-slot img').first()
await bookImg.waitFor()
check((await bookImg.evaluate((i) => i.style.transform)) === 'scale(1.2)', 'book view: turned to page 1, shows the photo with the zoom just made')
await page.screenshot({ path: `${out}/pv-0-book.png` })
// «Для печати» — развороты с вылетами, линией реза и безопасной зоной.
await page.getByRole('button', { name: 'Для печати' }).click()
await page.locator('.pp-spread').waitFor()
const navLabel = () => page.locator('.pp-nav span').textContent()
check((await navLabel()) === 'Обложка', 'preview opens on the cover')
check((await page.locator('.pv-cut').count()) === 1 && (await page.locator('.pv-safe').count()) === 1, 'cut line and safe zone shown by default')
check((await page.locator('.pp-spread .pv-slot').count()) === 0, 'empty frame on the cover is not printed (print variant)')
await page.screenshot({ path: `${out}/pv-1-cover.png` })
await page.getByRole('button', { name: 'Следующий разворот' }).click()
check((await navLabel()) === 'Страница 1', 'first spread: page 1 on the right')
const pvImg = page.locator('.pp-spread .pv-slot img').first()
await pvImg.waitFor()
check((await pvImg.evaluate((i) => i.style.transform)) === 'scale(1.2)', 'preview shows the edit made just before leaving the editor')
const slotBox = await page.locator('.pp-spread .pv-slot').first().boundingBox()
const trimBox = await page.locator('.pp-spread .pv-trim').nth(0).boundingBox()
check(slotBox.width > trimBox.width + 2, `full-page photo extends into the bleed (slot ${Math.round(slotBox.width)} px > page ${Math.round(trimBox.width)} px)`)
const issuesText = await page.locator('.book-issues').textContent()
check(issuesText.includes('обложка') && issuesText.includes('стр. 2') && !issuesText.includes('нечётким'), 'issues list empty frames (cover, pages) and no small photos')
await page.screenshot({ path: `${out}/pv-2-page1.png` })
await page.getByRole('button', { name: 'Следующий разворот' }).click()
check((await navLabel()) === 'Страницы 2–3', 'next spread: pages 2–3')
await page.getByLabel('Показать линию реза и безопасную зону').uncheck()
check((await page.locator('.pv-cut').count()) === 0, 'guides can be turned off')
await page.screenshot({ path: `${out}/pv-3-spread-clean.png` })
for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight')
check((await navLabel()) === 'Задняя обложка', 'last spread: the back cover')
await page.keyboard.press('ArrowLeft')
check((await navLabel()) === 'Страница 20', 'before it: page 20 on the left')
await page.locator('.book-issues').getByRole('link', { name: 'стр. 2', exact: true }).click()
await page.locator('.ed-page').waitFor()
check((await page.locator('.ed-pager span').textContent()) === 'Страница 2 из 20', 'issue link opens the editor on that page')
check(!(await page.locator('.share-row input').inputValue()).includes('?'), 'share link stays clean (no ?page=)')

// 10. Компьютер: вид редактора.
const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await desk.goto(`${base}/b/${token}`)
await desk.locator('.ed-page').waitFor()
await desk.keyboard.press('ArrowRight')
await desk.keyboard.press('ArrowRight')
check((await desk.locator('.ed-pager span').textContent()) === 'Страница 2 из 20', 'arrow keys switch pages on desktop')
await desk.screenshot({ path: `${out}/ed-7-desktop.png` })
await desk.goto(`${base}/b/${token}/preview`)
await desk.getByRole('button', { name: 'Для печати' }).click()
await desk.locator('.pp-spread').waitFor()
await desk.keyboard.press('ArrowRight')
await desk.keyboard.press('ArrowRight')
await desk.waitForTimeout(300)
await desk.screenshot({ path: `${out}/pv-4-desktop.png` })

await browser.close()
log(problems.length ? '\nPROBLEMS:\n' + problems.join('\n') : '\nALL CHECKS PASSED, no unexpected console errors')
process.exit(problems.length ? 1 : 0)
