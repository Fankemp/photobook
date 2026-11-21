// Сквозной тест админки (шаг 7) вместе с клиентской стороной.
// Запуск: make e2e (пароль берётся из .env, ADMIN_PASSWORD).
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const apiBase = process.env.API_URL ?? 'http://localhost:8080'
const password = process.env.ADMIN_PASSWORD
if (!password) {
  console.log('ADMIN_PASSWORD is not set (see .env) — admin test skipped')
  process.exit(1)
}
const out = 'shots'
mkdirSync(out, { recursive: true })

const problems = []
const log = (...a) => console.log(...a)
const check = (cond, msg) => {
  if (!cond) problems.push('FAIL: ' + msg)
  log((cond ? 'ok   ' : 'FAIL ') + msg)
}
const api = async (path, init) => (await fetch(`${apiBase}/api${path}`, init)).json()

// Заявка от «клиента» через API.
async function placeOrder(token, name) {
  const book = await api(`/books/${token}`)
  const info = await api(`/books/${token}/order`)
  return api(`/books/${token}/order`, {
    method: 'POST',
    body: JSON.stringify({ name, phone: '+7 701 555 44 33', address: 'Алматы, Достык 5', wantedDate: info.minWantedDate, comment: '', version: book.version, confirmed: true }),
  })
}

const { token } = await api('/books', { method: 'POST', body: JSON.stringify({ templateId: 'birthday-bright' }) })
const order = await placeOrder(token, 'Тест Админки')
check(order.number > 0, `client placed order №${order.number}`)

const browser = await chromium.launch()

// 1. Без пароля — 401.
const anon = await browser.newPage()
const resp = await anon.goto(`${base}/admin/`)
check(resp.status() === 401, 'admin without password → 401')

// 2. С паролем: список «В работе», в нём новая заявка.
const ctx = await browser.newContext({ ...devices['iPhone 13'], httpCredentials: { username: 'admin', password } })
const page = await ctx.newPage()
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
await page.goto(`${base}/admin/`)
check((await page.locator('.filters a.on').textContent()).startsWith('В работе'), 'list opens on "В работе"')
const item = page.locator('.orders a', { hasText: `№${order.number}` })
check(await item.isVisible(), `new order №${order.number} is in the list`)
await page.screenshot({ path: `${out}/ad-1-list.png`, fullPage: true })

// 3. Карточка заявки: клиент, ссылки, уведомление.
await item.click()
await page.locator('h1', { hasText: `Заявка №${order.number}` }).waitFor()
check((await page.locator('a[href^="tel:"]').getAttribute('href')) === 'tel:+77015554433', 'phone is a tap-to-call link')
check((await page.getByRole('link', { name: 'WhatsApp' }).getAttribute('href')) === 'https://wa.me/77015554433', 'WhatsApp link')
check(await page.getByText('сообщение отправлено').isVisible(), 'Telegram notification marked as sent (log sender in dev)')
// PDF собирается в фоне за секунды: в карточке либо «собирается…», либо уже ссылки на файлы.
const pdfRow = await page.locator('dt:text-is("PDF") + dd').textContent()
check(/собирается|\.pdf/.test(pdfRow), `PDF row shows build status (${pdfRow.trim().slice(0, 40)})`)

// 4. Следующий шаг с заметкой → клиент видит новый статус.
await page.locator('input[name="note"]').first().fill('аванс 50% на Kaspi')
await page.getByRole('button', { name: 'Следующий шаг: Ждём аванс' }).click()
await page.getByText('Статус изменён.').waitFor()
check((await page.locator('h1 .status').textContent()) === 'Ждём аванс', 'status changed to "Ждём аванс"')
check(await page.locator('table').getByText('аванс 50% на Kaspi').isVisible(), 'history keeps the note')
await page.screenshot({ path: `${out}/ad-2-detail.png`, fullPage: true })
const client = await browser.newPage()
await client.goto(`${base}/b/${token}/order`)
// Страница клиента грузит заявку после открытия — ждём, а не проверяем мгновенно.
const seen = await client.locator('.order-status-name', { hasText: 'Ждём аванс' }).waitFor({ timeout: 10000 }).then(() => true, () => false)
check(seen, 'client sees "Ждём аванс" on their order page')

// 5. Отмена → книга снова открыта клиенту.
await page.locator('select[name="status"]').selectOption('cancelled')
await page.locator('input[name="note"]').last().fill('клиент передумал')
await page.getByRole('button', { name: 'Изменить' }).click()
await page.getByText('Статус изменён.').waitFor()
check((await page.locator('h1 .status').textContent()) === 'Отменена', 'order cancelled')
const book = await api(`/books/${token}`)
check(book.order === null, 'book has no active order after cancellation')
await client.goto(`${base}/b/${token}`)
await client.locator('.ed-page').waitFor()
check(client.url().endsWith(`/b/${token}`), 'client can edit the book again (no redirect to the order)')

// 6. Клиент оформил новую заявку — старую отменённую вернуть нельзя.
const second = await placeOrder(token, 'Тест Админки, вторая')
check(second.number > order.number, `client placed a new order №${second.number}`)
await page.locator('select[name="status"]').selectOption('new')
await page.getByRole('button', { name: 'Изменить' }).click()
await page.locator('.flash.err').waitFor()
check((await page.locator('.flash.err').textContent()).includes('другая действующая заявка'), 'cannot reopen the cancelled order while another is active')

// 7. Фильтр «Отменена».
await page.goto(`${base}/admin/?status=cancelled`)
check(await page.locator('.orders a', { hasText: `№${order.number}` }).isVisible(), 'cancelled filter shows the cancelled order')

// 8. POST с чужого сайта отклоняется (защита от подделки запросов).
const forged = await fetch(`${apiBase}/admin/orders/${second.number}/status`, {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from(`admin:${password}`).toString('base64'),
    'Sec-Fetch-Site': 'cross-site',
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'status=cancelled',
})
check(forged.status === 403, 'cross-site POST with valid password → 403')

const desk = await browser.newPage({ viewport: { width: 1280, height: 900 }, httpCredentials: { username: 'admin', password } })
await desk.goto(`${base}/admin/orders/${order.number}`)
await desk.screenshot({ path: `${out}/ad-3-desktop.png`, fullPage: true })

await browser.close()
log(problems.length ? '\nPROBLEMS:\n' + problems.join('\n') : '\nALL ADMIN CHECKS PASSED')
process.exit(problems.length ? 1 : 0)
