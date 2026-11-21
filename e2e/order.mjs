// Сквозной тест заявки (шаг 6) в настоящем браузере.
// Запуск: make e2e (сервисы должны быть запущены через make up).
// Сообщение в Telegram здесь не проверяется: без токена бота оно пишется
// в лог backend (make logs), а формат текста покрыт Go-тестом.
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const apiBase = process.env.API_URL ?? 'http://localhost:8080'
const out = 'shots'
mkdirSync(out, { recursive: true })

const problems = []
const log = (...a) => console.log(...a)
const check = (cond, msg) => {
  if (!cond) problems.push('FAIL: ' + msg)
  log((cond ? 'ok   ' : 'FAIL ') + msg)
}
const api = async (path) => (await fetch(`${apiBase}/api${path}`)).json()

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
page.on('console', (m) => {
  // 409 book_locked во второй вкладке и обрыв сохранения — ожидаемые.
  if (m.type() === 'error' && !/409|ERR_FAILED/.test(m.text())) problems.push('console: ' + m.text())
})

const { token } = await (await fetch(`${apiBase}/api/books`, { method: 'POST', body: JSON.stringify({ templateId: 'anniversary-classic' }) })).json()

// Вторая вкладка с редактором, открытая ДО заявки: потом проверим, что она не перезапишет заказанную книгу.
const stale = await ctx.newPage()
await stale.goto(`${base}/b/${token}?page=1`)
await stale.locator('.ed-page').waitFor()

// 1. Правка, которая не успела сохраниться (нет связи), — должна попасть в заявку.
await page.goto(`${base}/b/${token}?page=1`) // страница 1 — цитата
await page.locator('.ed-page').waitFor()
await page.route('**/api/books/*', (r) => (r.request().method() === 'PUT' ? r.abort() : r.continue()))
await page.locator('.ed-text').first().click()
await page.getByRole('button', { name: 'Больше' }).click()
await page.getByRole('button', { name: 'Больше' }).click() // 18 → 20 пт
await page.locator('.ed-status', { hasText: 'Нет связи' }).waitFor({ timeout: 10000 })
check(true, 'edit made while saving fails (stays in the local draft)')
await page.unroute('**/api/books/*')

// 2. Превью → «Оформить заявку».
await page.getByRole('link', { name: 'Превью' }).click()
await page.locator('.pp-book').waitFor()
await page.getByRole('link', { name: 'Оформить заявку' }).click()
await page.waitForURL(/\/order$/)
await page.locator('form.order-form').waitFor()
const submit = page.getByRole('button', { name: 'Отправить заявку' })
await submit.waitFor() // «Сохраняем книгу…» → «Отправить заявку»: черновик сохранён
let b = await api(`/books/${token}`)
check(b.pages[0].elements[0].size === 20, `unsaved edit was saved before ordering (size ${b.pages[0].elements[0].size})`)
check((await page.locator('.book-issues').textContent()).includes('Пустые рамки'), 'form shows what to fix (empty frames)')
check(await submit.isDisabled(), 'submit is disabled until the book is checked and the box is ticked')

// Без галочки «проверил(а)» сервер заявку не примет.
const noBox = await fetch(`${apiBase}/api/books/${token}/order`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Тест', phone: '+77001234567', address: 'Алматы, Абая 10', wantedDate: '2099-01-01', comment: '', version: b.version }),
})
check(noBox.status === 400 && (await noBox.json()).error !== undefined && (await api(`/books/${token}`)).order === null, 'order without the confirmation box is refused (no order created)')

// Шаг «Проверьте книгу»: листаем все страницы по порядку, галочка — только в конце.
const review = page.locator('.order-review')
const box = review.getByLabel('Я проверил(а) тексты и фото. После печати исправить ничего нельзя.')
check((await review.locator('.order-review-head').textContent()).startsWith('Обложка'), 'review starts on the cover')
check(await box.isDisabled(), 'confirmation box is locked until all pages are viewed')
const total = b.pages.length + 2
let sawText = false
let sawEmpty = false
for (let i = 1; i < total; i++) {
  await review.getByRole('button', { name: 'Дальше' }).click()
  const text = await review.textContent()
  if (i === 1) sawText = text.includes('«Здесь начинается наша история»')
  sawEmpty ||= text.includes('Пустая рамка') || text.includes('Пустых рамок')
}
check(sawText, 'review lists the texts of the page (page 1: «Здесь начинается наша история»)')
check(sawEmpty, 'review warns about empty frames on the page')
check((await review.locator('.order-review-head').textContent()).startsWith('Задняя обложка') && (await review.textContent()).includes(`Просмотрено ${total} из ${total}`), `all ${total} pages viewed in order, up to the back cover`)
await page.screenshot({ path: `${out}/or-0-review.png`, fullPage: true })
await box.check()
check(await submit.isEnabled(), 'after the box is ticked the form can be sent')

// «Все подписи книги» — тексты всех страниц списком, со ссылкой на страницу в редакторе.
const texts = await ctx.newPage()
await texts.goto(`${base}/b/${token}/texts`)
await texts.locator('.texts-list').waitFor()
check((await texts.locator('.texts-list').textContent()).includes('Здесь начинается наша история'), '"Все подписи книги" lists the texts by page')
await texts.screenshot({ path: `${out}/or-texts.png`, fullPage: true })
await texts.getByRole('link', { name: 'Страница 1', exact: true }).click()
await texts.waitForURL(/\?page=1$/)
check(true, 'page link opens that page in the editor')
await texts.close()

// 3. Пустая форма → подсказки под полями, фокус на первом поле с ошибкой.
await submit.click()
for (const [id, text] of [['name', 'обращаться'], ['phone', '+7 700'], ['address', 'улица'], ['wantedDate', 'не раньше']]) {
  const err = await page.locator(`#${id}-error`).textContent()
  check(err.toLowerCase().includes(text.toLowerCase()) && (await page.locator(`#${id}`).getAttribute('aria-invalid')) === 'true', `empty ${id} → hint under the field`)
}
check(await page.locator('#name').evaluate((e) => e === document.activeElement), 'focus moves to the first field with an error')
await page.screenshot({ path: `${out}/or-1-errors.png`, fullPage: true })

// 4. Неверный телефон, затем правильные данные.
await page.locator('#name').fill('Айгерим')
await page.locator('#phone').fill('123')
await page.locator('#address').fill('Алматы, ул. Абая 10, кв. 5')
const minDate = await page.locator('#wantedDate').getAttribute('min')
await page.locator('#wantedDate').fill(minDate)
await submit.click()
check((await page.locator('#phone-error').textContent()).includes('+7 700 123 45 67') && (await page.locator('#name-error').count()) === 0, 'only the wrong phone is flagged')
await page.locator('#phone').fill('8 (700) 123-45-67')
check((await page.locator('#phone-error').count()) === 0, 'editing the field clears its error hint')
await page.locator('#comment').fill('Позвоните после 18:00')
await page.screenshot({ path: `${out}/or-2-filled.png`, fullPage: true })
await submit.click()

// 5. Статус заявки.
await page.locator('h1', { hasText: 'Заявка №' }).waitFor({ timeout: 10000 })
const heading = await page.locator('h1').textContent()
const number = Number(heading.replace(/\D/g, ''))
check(/^Заявка №\d+$/.test(heading), `status page: "${heading}"`)
check((await page.locator('.order-status-name').textContent()) === 'Заявка принята', 'status "Заявка принята"')
check((await page.locator('.order-status-card').textContent()).includes('+7\u00a0700\u00a0123\u00a045\u00a067'), 'shows the phone we will call, formatted (no line break inside)')
await page.screenshot({ path: `${out}/or-3-status.png`, fullPage: true })

b = await api(`/books/${token}`)
const info = await api(`/books/${token}/order`)
check(b.order?.number === number && info.order.phone === '+77001234567' && info.order.wantedDate === minDate, `order stored: №${b.order?.number}, phone normalized, date ${info.order?.wantedDate}`)

// 6. После заявки книгу ещё можно менять (заказ не в печати): ссылка открывает
//    редактор с пояснением; в превью — статус заявки вместо кнопки.
check(await page.getByRole('link', { name: 'Изменить книгу' }).isVisible(), 'order page: "Изменить книгу" while the order is not in print')
await page.goto(`${base}/b/${token}?page=1`)
await page.locator('.ed-banner-info', { hasText: `заявка №${number}` }).waitFor()
check(true, 'after the order the book opens in the editor with "Книгу ещё можно менять"')
// Поле ввода текста — с проверкой орфографии браузера на русском.
await page.locator('.ed-text').first().click()
await page.getByRole('button', { name: 'Изменить текст' }).click()
const area = page.locator('.ed-dialog textarea')
check((await area.getAttribute('spellcheck')) === 'true' && (await area.getAttribute('lang')) === 'ru', 'text input has spellcheck on, language ru')
await page.getByRole('dialog').getByRole('button', { name: 'Готово' }).click()
await page.goto(`${base}/b/${token}/preview`)
await page.locator('.pp-book').waitFor()
check(await page.getByRole('link', { name: `Заявка №${number} оформлена, посмотреть статус` }).isVisible(), 'preview shows the order instead of the button')

// 7. Старая вкладка редактора (открыта до заявки, со старой версией книги)
//    пытается сохранить → конфликт, книга не перезаписана.
await stale.locator('.ed-text').first().click()
await stale.getByRole('button', { name: 'Меньше' }).click()
await stale.locator('.ed-banner', { hasText: 'Книгу изменили' }).waitFor({ timeout: 10000 })
check(true, 'stale editor tab: save refused with a conflict banner')
b = await api(`/books/${token}`)
check(b.pages[0].elements[0].size === 20, 'ordered book content did not change')

// 8. Компьютер: страница статуса.
const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await desk.goto(`${base}/b/${token}/order`)
await desk.locator('.order-status').waitFor()
await desk.screenshot({ path: `${out}/or-4-desktop.png` })

await browser.close()
log(problems.length ? '\nPROBLEMS:\n' + problems.join('\n') : '\nALL ORDER CHECKS PASSED, no unexpected console errors')
process.exit(problems.length ? 1 : 0)
