// Окно правок после заявки и снимки заказа, вместе клиент и админка:
// клиент правит книгу после заявки → в админке «PDF устарел», «Отправить
// в печать» заблокирована → когда клиент затих (ORDER_CHANGE_QUIET_SECONDS),
// событие в истории, сообщение в Telegram, новая версия заказа и её PDF →
// администратор правит текст по просьбе клиента → ещё версия → «Отправить
// в печать» → книга у клиента только для просмотра, сервер правки не принимает.
// Запуск: make e2e (сервисы и сервис рендера запущены, ADMIN_PASSWORD в .env).
// Ждёт затишье правок (по умолчанию 60 с) и три сборки PDF — около 3 минут.
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const apiBase = process.env.API_URL ?? 'http://localhost:8080'
const out = 'shots'
mkdirSync(out, { recursive: true })
const problems = []
const log = (...a) => console.log(...a)
const check = (cond, msg) => { if (!cond) problems.push('FAIL: ' + msg); log((cond ? 'ok   ' : 'FAIL ') + msg) }

const password = process.env.ADMIN_PASSWORD
if (!password) {
  console.log('ADMIN_PASSWORD is not set (see .env) — order window test skipped')
  process.exit(0)
}
const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${password}`).toString('base64') }
const admin = (path, init = {}) => fetch(`${apiBase}/admin${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } })
const api = async (path, init) => (await fetch(`${apiBase}/api${path}`, init)).json()
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// Ждать, пока страница заявки в админке не станет такой, как надо.
async function waitAdmin(number, cond, what, seconds = 240) {
  for (let i = 0; i < seconds / 2; i++) {
    const text = plain(await (await admin(`/orders/${number}`)).text())
    if (cond(text)) return text
    await new Promise((r) => setTimeout(r, 2000))
  }
  check(false, `timeout waiting for: ${what}`)
  return plain(await (await admin(`/orders/${number}`)).text())
}
const pdfCurrent = (t) => t.includes('из текущей версии книги')

const browser = await chromium.launch()

// 1. Книга и заявка (форма заявки — в order.mjs; здесь через API, с галочкой).
const { token } = await api('/books', { method: 'POST', body: JSON.stringify({ templateId: 'anniversary-classic' }) })
let book = await api(`/books/${token}`)
const info = await api(`/books/${token}/order`)
const order = await api(`/books/${token}/order`, {
  method: 'POST',
  body: JSON.stringify({ name: 'Тест Окна', phone: '+77001234567', address: 'Алматы, Абая 1', wantedDate: info.minWantedDate, comment: '', version: book.version, confirmed: true }),
})
check(order.number > 0, `order №${order.number} placed`)
let text = await waitAdmin(order.number, pdfCurrent, 'first PDF')
check(text.includes('v1') && text.includes('галочка'), 'version 1 (order) saved with the client confirmation')

// 2. Клиент правит подпись после заявки — в редакторе, как обычно.
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const client = await ctx.newPage()
client.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
await client.goto(`${base}/b/${token}?page=1`)
await client.locator('.ed-banner-info', { hasText: `заявка №${order.number}` }).waitFor()
await client.locator('.ed-text').first().click()
await client.getByRole('button', { name: 'Изменить текст' }).click()
await client.locator('.ed-dialog textarea').fill('Здесь начинается наша история, 2026')
await client.getByRole('dialog').getByRole('button', { name: 'Готово' }).click()
await client.locator('.ed-status', { hasText: 'Сохранено' }).waitFor({ timeout: 15000 })
book = await api(`/books/${token}`)
check(book.pages[0].elements[0].text === 'Здесь начинается наша история, 2026', 'client edit after the order is saved (order is not in print yet)')

// 3. Сразу: PDF устарел, «Отправить в печать» выключена и сервер её не пустит.
text = plain(await (await admin(`/orders/${order.number}`)).text())
check(text.includes('PDF устарел'), 'admin: "PDF устарел" right after the client edit')
const detailHTML = await (await admin(`/orders/${order.number}`)).text()
check(/<button class="primary" disabled>Отправить в печать/.test(detailHTML), 'admin: "Отправить в печать" is disabled while the PDF is stale')
const early = await admin(`/orders/${order.number}/print`, { method: 'POST', redirect: 'manual' })
const refused = decodeURIComponent(early.headers.get('location') ?? '').replace(/\+/g, ' ')
check(early.status === 303 && refused.includes('В печать нельзя') && !plain(await (await admin(`/orders/${order.number}`)).text()).includes('Отправлено в печать'),
  'server refuses to send a stale PDF to print (status unchanged)')

// 4. Клиент затих → событие, Telegram, новая версия заказа и её PDF.
text = await waitAdmin(order.number, (t) => t.includes('Клиент изменил книгу') && t.includes('v2') && pdfCurrent(t), 'client change settled and PDF v2 built')
check(text.includes('Клиент изменил книгу (версия книги'), 'history: "Клиент изменил книгу"')
check(/«Клиент изменил книгу»: (отправлено|в очереди)/.test(text), `Telegram notice about the change (${text.match(/«Клиент изменил книгу»: \S+/)?.[0]})`)
check(text.includes('клиент изменил книгу'), 'version 2 — "клиент изменил книгу"')

// 5. Администратор правит текст по просьбе клиента.
const form = await (await admin(`/orders/${order.number}/texts`)).text()
const field = form.match(/name="(t:[^"]+)"[^>]*>Здесь начинается наша история, 2026</)?.[1]
check(!!field, 'admin texts page lists the client text')
const body = new URLSearchParams({ [field]: 'Здесь начинается наша история, 2026 год' })
const saved = await admin(`/orders/${order.number}/texts`, { method: 'POST', body, redirect: 'manual' })
check(saved.status === 303 && saved.headers.get('location').endsWith('?texts'), 'admin text edit saved')
book = await api(`/books/${token}`)
check(book.pages[0].elements[0].text === 'Здесь начинается наша история, 2026 год', 'book has the admin correction')
text = await waitAdmin(order.number, (t) => t.includes('v3') && pdfCurrent(t), 'PDF v3 after the admin edit')
check(text.includes('Изменено администратором: текст — стр. 1'), 'history: "Изменено администратором"')
check(text.includes('изменено администратором'), 'version 3 — "изменено администратором"')

// 6. Отправить в печать → книга закрыта.
const sent = await admin(`/orders/${order.number}/print`, { method: 'POST', redirect: 'manual' })
check(sent.status === 303 && sent.headers.get('location').endsWith('?saved'), 'admin: "Отправить в печать"')
text = plain(await (await admin(`/orders/${order.number}`)).text())
check(text.includes('Отправлено в печать') && text.includes('книга закрыта'), 'status "Печать", book closed')
await admin(`/orders/${order.number}`).then(async (r) => {
  const pdfs = (await r.text()).match(/versions\/\d+\/pdf\/book/g) ?? []
  check(pdfs.length === 3, `versions history keeps 3 PDFs (v1, v2, v3), got ${pdfs.length}`)
})

await client.reload()
await client.locator('.ed-banner', { hasText: 'Книга уже в печати, изменить её нельзя' }).waitFor()
check((await client.locator('.ed-toolbar, .ed-slot, .ed-text').count()) === 0, 'client sees the book read-only: no editing tools')
await client.screenshot({ path: `${out}/ow-readonly.png` })
const put = await fetch(`${apiBase}/api/books/${token}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ version: book.version, cover: book.cover, pages: book.pages.map((p, i) => (i === 0 ? { ...p, background: '#000000' } : p)), backCover: book.backCover }),
})
check(put.status === 409 && (await put.json()).error === 'book_locked', 'server refuses to save a book in print (409 book_locked)')
const upload = await fetch(`${apiBase}/api/books/${token}/assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: 'image/jpeg', size: 1000 }) })
check(upload.status === 409, 'photo upload into a book in print is refused')
const after = await api(`/books/${token}`)
check(after.version === book.version && after.pages[0].background === book.pages[0].background, 'book data untouched by the refused save')

await browser.close()
log(problems.length ? '\nPROBLEMS:\n' + problems.join('\n') : '\nALL ORDER WINDOW CHECKS PASSED')
process.exit(problems.length ? 1 : 0)
