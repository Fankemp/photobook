// Сквозной тест текста и шрифтов (шаг 5а) в настоящем браузере.
// Запуск: make e2e (сервисы должны быть запущены через make up).
//
// Для каждого шрифта из fonts.json проверяем через протокол отладки Chromium,
// какими шрифтами браузер на самом деле нарисовал текст: всё должно быть
// нашим файлом, без подстановки запасного шрифта ни для одной буквы.
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const apiBase = process.env.API_URL ?? 'http://localhost:8080'
const fontsPath = process.env.FONTS_JSON ?? '/repo/frontend/src/book/fonts.json'
const FONTS = JSON.parse(readFileSync(fontsPath, 'utf8')).fonts
const out = 'shots'
mkdirSync(out, { recursive: true })

const PANGRAM = 'Съешь же ещё этих мягких французских булок, да выпей чаю!'
const KAZAKH = 'Қазақстан: әже, ғалам, қала, ең, өмір, ұл, үй, һ, ірі'

const problems = []
const log = (...a) => console.log(...a)
const check = (cond, msg) => {
  if (!cond) problems.push('FAIL: ' + msg)
  log((cond ? 'ok   ' : 'FAIL ') + msg)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text())
})
// Шрифты — только с нашего сервера, никаких внешних CDN.
const fontRequests = []
page.on('request', (r) => {
  if (r.resourceType() === 'font') fontRequests.push(r.url())
})

const cdp = await ctx.newCDPSession(page)
await cdp.send('DOM.enable')
await cdp.send('CSS.enable')
// Какими шрифтами отрисован текст внутри элемента (по данным самого браузера).
async function renderedFonts(selector) {
  await page.evaluate(() => document.fonts.ready)
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
  return fonts
}
const api = async (token) => (await (await fetch(`${apiBase}/api/books/${token}`)).json())
const waitSaved = () => page.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 10000 })

// Книга по шаблону «Путешествие»; страница 2 — две фото без текста.
const { token } = await (await fetch(`${apiBase}/api/books`, { method: 'POST', body: JSON.stringify({ templateId: 'travel-minimal' }) })).json()
await page.goto(`${base}/b/${token}?page=2`)
await page.locator('.ed-page').waitFor()

// 1. Добавить текст: открывается окно ввода, текст сразу виден на странице.
await page.getByRole('button', { name: 'Добавить текст' }).click()
const dialog = page.locator('dialog.ed-dialog')
await dialog.waitFor()
check(await dialog.locator('textarea').evaluate((t) => t === document.activeElement), 'add text → dialog opens with the cursor in the field')
await dialog.locator('textarea').fill(PANGRAM)
check((await dialog.locator('.pv-text').last().textContent()) === PANGRAM, 'dialog shows a live preview of the page')
await page.screenshot({ path: `${out}/tx-1-dialog.png` })
await dialog.getByRole('button', { name: 'Готово' }).click()
const added = '.ed-page .pv-trim > .pv-text:last-of-type > div'
check((await page.locator(added).textContent()) === PANGRAM, 'text appears on the page')
await page.screenshot({ path: `${out}/tx-2-panel.png` })

// 2. Каждый шрифт: панграмма целиком нашим файлом; казахские буквы — как в отметке kk.
log('\n  шрифт              кириллица        казахский (kk в конфиге)')
for (const f of FONTS) {
  await page.locator('.ed-fonts').getByRole('radio', { name: f.name, exact: true }).click()
  const ru = await renderedFonts(added)
  // Неизменённый переменный шрифт браузер называет по начертанию по умолчанию
  // («Raleway Thin»), поэтому сверяем начало имени.
  const ruOk = ru.length === 1 && ru[0].isCustomFont && ru[0].familyName.startsWith(f.name)
  check(ruOk, `${f.name}: Cyrillic pangram rendered only with our file (got ${ru.map((x) => `${x.familyName}${x.isCustomFont ? '' : ' [system]'}×${x.glyphCount}`).join(', ')})`)
}
await page.getByRole('button', { name: 'Изменить текст' }).click()
await dialog.locator('textarea').fill(KAZAKH)
await dialog.getByRole('button', { name: 'Готово' }).click()
for (const f of FONTS) {
  await page.locator('.ed-fonts').getByRole('radio', { name: f.name, exact: true }).click()
  const kk = await renderedFonts(added)
  const onlyOurs = kk.length === 1 && kk[0].isCustomFont
  check(onlyOurs === f.kk, `${f.name}: Kazakh letters ${onlyOurs ? 'all in the font' : 'need a fallback'} — config says kk=${f.kk}`)
}
check(fontRequests.length > 0 && fontRequests.every((u) => u.startsWith(`${base}/fonts/`)), `all ${fontRequests.length} font files come from our server (/fonts/), no external CDN`)

// 3. Жирный: у Pacifico нет жирного — кнопка выключена; у Montserrat есть.
await page.locator('.ed-fonts').getByRole('radio', { name: 'Pacifico', exact: true }).click()
check(await page.locator('.ed-bold').isDisabled(), 'bold is disabled for a font without a bold face (Pacifico)')
await page.locator('.ed-fonts').getByRole('radio', { name: 'Montserrat', exact: true }).click()
await page.locator('.ed-bold').click()
const boldFonts = await renderedFonts(added)
check(boldFonts.length === 1 && boldFonts[0].isCustomFont && /bold/i.test(boldFonts[0].postScriptName ?? ''), `bold uses the real Montserrat Bold file (got ${boldFonts.map((x) => x.postScriptName).join(', ')})`)

// 4. Размер, выравнивание, цвет (положение, размер блока и поворот — в text-move.mjs).
await page.getByRole('button', { name: 'Больше' }).click()
await page.getByRole('radio', { name: 'По левому краю' }).click()
await page.getByRole('radio', { name: 'Тёмно-синий' }).click()
const style = await page.locator('.ed-page .pv-trim > .pv-text:last-of-type').evaluate((e) => [e.style.textAlign, getComputedStyle(e).color])
check(style[0] === 'left' && style[1] === 'rgb(30, 58, 95)', `align and colour applied (got ${style})`)
await waitSaved()
let b = await api(token)
const saved = b.pages[1].elements.at(-1)
check(
  saved.type === 'text' && saved.font === 'montserrat' && saved.bold === true && saved.size === 15 && saved.align === 'left' && saved.color === '#1e3a5f' && saved.text === KAZAKH,
  `settings saved on the server (got ${JSON.stringify({ font: saved.font, bold: saved.bold, size: saved.size, align: saved.align, color: saved.color })})`,
)
await page.screenshot({ path: `${out}/tx-3-styled.png` })

// 5. «Отмена» возвращает текст, который был до открытия окна.
await page.getByRole('button', { name: 'Изменить текст' }).click()
await dialog.locator('textarea').fill('черновик, который передумали')
await dialog.getByRole('button', { name: 'Отмена' }).click()
check((await page.locator(added).textContent()) === KAZAKH, 'cancel restores the previous text')

// 6. Удалить добавленный текст.
await page.getByRole('button', { name: 'Удалить' }).click()
await waitSaved()
b = await api(token)
check(b.pages[1].elements.every((e) => e.type !== 'text'), 'added text removed')

// 7. Автоподбор: длинная подпись уменьшается, пока не влезет в блок;
//    если не влезает даже мелко — предупреждение «Не помещается».
const longText = 'Мы ехали вдоль моря весь день, останавливались у каждой бухты и пили чай из термоса. '.repeat(6).slice(0, 500)
await page.getByRole('button', { name: 'Следующая страница' }).click() // стр. 3: фото с подписью (блок 168×22 мм, 11 пт)
await page.locator('.ed-text').first().click() // тап — выбрать подпись
await page.locator('.ed-text').first().click() // повторный тап — окно ввода
await dialog.waitFor()
await dialog.locator('textarea').fill(longText)
await dialog.getByRole('button', { name: 'Готово' }).click()
const caption = '.ed-page .pv-trim > .pv-text > div'
await page.waitForTimeout(500) // плавная докрутка страницы
const capBox = await page.locator('.ed-text.is-selected').boundingBox()
const barTop = (await page.locator('.ed-toolbar').boundingBox()).y
check(capBox.y + capBox.height <= barTop + 1, `selected caption at the bottom of the page is scrolled above the panel (${Math.round(capBox.y + capBox.height)} ≤ ${Math.round(barTop)})`)
const sizes = await page.locator(caption).first().evaluate((d) => [parseFloat(d.style.fontSize), d.offsetHeight <= d.parentElement.clientHeight + 0.5])
const specified = ((11 * 25.4) / 72 / 200) * 100 // 11 пт в cqw
check(sizes[0] < specified - 0.01 && sizes[1], `500-character caption shrinks to fit (${sizes[0].toFixed(2)}cqw < ${specified.toFixed(2)}cqw) and fits`)
check(!(await page.locator('.ed-text .ed-dpi-badge').isVisible()), 'no warning while the text still fits')
// Подзаголовок обложки — блок всего 10 мм в высоту: 500 символов не влезут даже 8 пт.
await page.locator('.ed-strip li').first().locator('button').click()
await page.locator('.ed-text').nth(1).click()
await page.getByRole('button', { name: 'Изменить текст' }).click()
await dialog.locator('textarea').fill(longText)
await dialog.getByRole('button', { name: 'Готово' }).click()
check(await page.locator('.ed-text .ed-dpi-badge', { hasText: 'Не помещается' }).isVisible(), 'too long even at the minimum size → "Не помещается" on the text')
check((await page.locator('.ed-text-panel .ed-dpi-warning').textContent()).includes('Сократите'), '... and an explanation in the panel')
await page.screenshot({ path: `${out}/tx-4-overflow.png` })

// 8. Превью рисует текст тем же нашим шрифтом (на этом же пойдёт PDF).
await page.getByRole('link', { name: 'Превью' }).click()
await page.getByRole('button', { name: 'Для печати' }).click()
await page.locator('.pp-spread').waitFor()
const coverTitle = await renderedFonts('.pp-spread .pv-text > div')
check(coverTitle.length === 1 && coverTitle[0].postScriptName === 'Montserrat-Bold' && coverTitle[0].isCustomFont, `preview renders the bold cover title with our Montserrat-Bold file (got ${coverTitle.map((x) => x.postScriptName)})`)

// 9. Компьютер: вид панели текста.
const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await desk.goto(`${base}/b/${token}`)
await desk.locator('.ed-text').first().click()
await desk.locator('.ed-text-panel').waitFor()
await desk.evaluate(() => document.fonts.ready)
await desk.screenshot({ path: `${out}/tx-5-desktop.png` })

await browser.close()
log(problems.length ? '\nPROBLEMS:\n' + problems.join('\n') : '\nALL TEXT CHECKS PASSED, no unexpected console errors')
process.exit(problems.length ? 1 : 0)
