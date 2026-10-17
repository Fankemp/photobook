// Сквозной тест печатного PDF (шаг 8): книга с настоящими фото и текстом →
// заявка → сервис рендера собирает PDF по настройке формата (по умолчанию —
// один book.pdf: передняя обложка, страницы, задняя обложка) → проверка.
// Запуск: make e2e (нужен ADMIN_PASSWORD в .env — PDF скачиваем через админку).
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const apiBase = process.env.API_URL ?? 'http://localhost:8080'
const password = process.env.ADMIN_PASSWORD
const out = 'shots'
mkdirSync(out, { recursive: true })

const problems = []
const log = (...a) => console.log(...a)
const check = (cond, msg) => {
  if (!cond) problems.push('FAIL: ' + msg)
  log((cond ? 'ok   ' : 'FAIL ') + msg)
}
const api = async (path, init) => {
  const r = await fetch(`${apiBase}/api${path}`, init)
  return r.json()
}
const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${password}`).toString('base64') }
const admin = (path, init = {}) => fetch(`${apiBase}/admin${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } })

// 1. Фото: генерируем в браузере (canvas → JPEG). Крупное 4000×3000 и «телефонное»
//    1200×800 с пометкой EXIF «повернуть на 90°» (на печати должно стоять вертикально).
const browser = await chromium.launch()
const gen = await browser.newPage()
async function jpeg(w, h, label, colors) {
  const dataUrl = await gen.evaluate(
    ([w, h, label, colors]) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')
      const grd = g.createLinearGradient(0, 0, w, h)
      grd.addColorStop(0, colors[0])
      grd.addColorStop(1, colors[1])
      g.fillStyle = grd
      g.fillRect(0, 0, w, h)
      // Шум, как у настоящей фотографии: иначе JPEG весит копейки и тест нечестный.
      const img = g.getImageData(0, 0, w, h)
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 60
        img.data[i] += n
        img.data[i + 1] += n
        img.data[i + 2] += n
      }
      g.putImageData(img, 0, 0)
      g.fillStyle = '#fff'
      g.font = `bold ${Math.round(h / 6)}px sans-serif`
      g.fillText(label, w * 0.08, h * 0.55)
      return c.toDataURL('image/jpeg', 0.92)
    },
    [w, h, label, colors],
  )
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}
function withExifRotation(jpg) {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0])
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload])
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)])
}
const photos = [
  { file: await jpeg(4000, 3000, 'ОБЛОЖКА', ['#1e3a5f', '#f6ad55']), w: 4000, h: 3000 },
  { file: withExifRotation(await jpeg(1200, 800, 'ВЕРХ →', ['#2b6cb0', '#f6ad55'])), w: 800, h: 1200 }, // как видит человек
  { file: await jpeg(4000, 3000, 'МОРЕ', ['#0f766e', '#a7f3d0']), w: 4000, h: 3000 },
  { file: await jpeg(3000, 4000, 'ГОРЫ', ['#4c1d95', '#fbcfe8']), w: 3000, h: 4000 },
]
await gen.close()

// 2. Книга «Путешествие», загрузка фото по API (как это делает редактор).
const { token } = await api('/books', { method: 'POST', body: JSON.stringify({ templateId: 'travel-minimal' }) })
const ids = []
for (const p of photos) {
  const { assetId, uploadUrl } = await api(`/books/${token}/assets`, {
    method: 'POST',
    body: JSON.stringify({ contentType: 'image/jpeg', size: p.file.length }),
  })
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: p.file })
  if (!put.ok) throw new Error(`upload failed: ${put.status}`)
  await api(`/books/${token}/assets/${assetId}/complete`, { method: 'POST', body: JSON.stringify({ width: p.w, height: p.h }) })
  ids.push(assetId)
}
log(`uploaded ${ids.length} photos (${(photos.reduce((s, p) => s + p.file.length, 0) / 1e6).toFixed(1)} MB)`)
// Ждём обработку фото (миниатюры, повёрнутая печатная копия) — как и сам рендер.
for (const id of ids) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${apiBase}/api/books/${token}/assets/${id}/image`, { redirect: 'manual' })
    if ((r.headers.get('location') ?? '').includes('/thumbs/')) break
    await new Promise((res) => setTimeout(res, 500))
  }
}

// 3. Раскладываем фото и текст: обложка, стр. 1 (на всю страницу, повёрнутое фото),
//    стр. 2 (два фото), стр. 3 (фото + подпись Caveat), стр. 7 (четыре фото).
let book = await api(`/books/${token}`)
const setSlot = (page, i, assetId, crop) => {
  const slots = page.elements.filter((e) => e.type === 'photo_slot')
  slots[i].assetId = assetId
  if (crop) slots[i].crop = crop
}
setSlot(book.cover, 0, ids[0], { zoom: 1.2, offsetX: -0.5, offsetY: 0 })
book.cover.elements.find((e) => e.type === 'text').text = 'АЛМАТЫ — БАЛИ'
setSlot(book.pages[0], 0, ids[1])
setSlot(book.pages[1], 0, ids[2])
setSlot(book.pages[1], 1, ids[3])
setSlot(book.pages[2], 0, ids[2], { zoom: 2, offsetX: 1, offsetY: 1 })
Object.assign(book.pages[2].elements.find((e) => e.type === 'text'), { text: 'Съешь же ещё этих мягких французских булок', font: 'caveat', size: 16 })
for (let i = 0; i < 4; i++) setSlot(book.pages[6], i, ids[i])
// Стикеры (SVG): повёрнутое сердце на стр. 3, веточка на задней обложке.
// В PDF они должны остаться вектором, а не картинкой (проверка «0 разжато» ниже).
book.pages[2].elements.push({ type: 'sticker', id: 'st-pdf1', x: 72, y: 6, w: 22, h: 22, stickerId: 'love-heart', rotation: 15 })
book.backCover.elements.push({ type: 'sticker', id: 'st-pdf2', x: 40, y: 30, w: 20, h: 20, stickerId: 'nature-leaves', rotation: 0 })
// Повёрнутый текст на стр. 5 — для сверки «редактор = PDF» (см. шаг 5б). Ярко-красный,
// чтобы найти его по пикселям; фото на этой странице нет.
book.pages[4].elements.push({ type: 'text', id: 'ut-rot', x: 18, y: 30, w: 64, h: 22, text: 'ПОВОРОТ', font: 'montserrat', bold: true, size: 40, color: '#e00000', align: 'center', rotation: -25 })
// Свой текст на задней обложке (по умолчанию она пустая, с фоном обложки).
book.backCover.elements.push({ type: 'text', id: 'ut-back1', x: 8, y: 82, w: 84, h: 10, text: 'Спасибо за путешествие!', font: 'lora', size: 14, color: '#000000', align: 'center' })
const saved = await api(`/books/${token}`, {
  method: 'PUT',
  body: JSON.stringify({ version: book.version, cover: book.cover, pages: book.pages, backCover: book.backCover }),
})
check(saved.version === book.version + 1, 'book with photos and text saved')

// Страница 5 в редакторе (компьютер) — снимок для сверки с PDF. Снимаем до заявки:
// после неё книга закрыта и ссылка на редактор ведёт на статус заявки.
const ed = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await ed.goto(`${base}/b/${token}?page=5`)
await ed.locator('.ed-page .pv-text', { hasText: 'ПОВОРОТ' }).waitFor()
await ed.evaluate(() => document.fonts.ready)
const editorShot = await ed.locator('.ed-page .pv').screenshot()
writeFileSync(`${out}/pr-editor-p5.png`, editorShot)
await ed.close()

// 4. Заявка → PDF собирается в фоне.
const info = await api(`/books/${token}/order`)
const order = await api(`/books/${token}/order`, {
  method: 'POST',
  body: JSON.stringify({ name: 'Тест Печати', phone: '+77001112233', address: 'Алматы, Абая 1', wantedDate: info.minWantedDate, comment: '', version: saved.version }),
})
check(order.number > 0, `order №${order.number} placed`)

async function waitPdf(number) {
  for (let i = 0; i < 120; i++) {
    const html = await (await admin(`/orders/${number}`)).text()
    if (html.includes('.pdf (')) return html.replace(/&#43;/g, '+').replace(/<[^>]+>/g, ' ')
    if (html.includes('не собран (попыток')) return html.replace(/<[^>]+>/g, ' ')
    await new Promise((r) => setTimeout(r, 1000))
  }
  return ''
}
const started = Date.now()
let page = await waitPdf(order.number)
log(`  pdf built in ~${((Date.now() - started) / 1000).toFixed(0)} s`)
const pdfInfo = /book\.pdf — [^<]*?(?=\s{2,}|$)/.exec(page)?.[0] ?? page.slice(0, 300)
log('  ' + pdfInfo)
check(page.includes('book.pdf — 22 стр.: передняя обложка, страницы 1–20, задняя обложка; 206×206 мм'), 'one book.pdf: front cover, pages 1–20, back cover, all 206×206 mm (200 + 2×3 bleed)')
check(page.includes('цвет фото: RGB'), 'photos are RGB (PDF_CMYK=false)')
check(/фото: \d+ JPEG без пересжатия, 0 разжато/.test(page), 'every photo embedded as JPEG without recompression (rotated one via its upright print copy); stickers stay vector, no extra images')
check(/шрифты встроены:[^.]*Caveat/.test(page) && /шрифты встроены:[^.]*Montserrat-Bold/.test(page) && /шрифты встроены:[^.]*Lora/.test(page), 'fonts embedded: Caveat (caption), Montserrat-Bold (cover title), Lora (back cover)')

// 5. Скачивание из админки: один файл, правильное имя.
let pdfBytes
{
  const r = await admin(`/orders/${order.number}/pdf/book`)
  const buf = Buffer.from(await r.arrayBuffer())
  writeFileSync(`${out}/pr-book.pdf`, buf)
  pdfBytes = buf
  const cd = r.headers.get('content-disposition') ?? ''
  check(r.ok && buf.subarray(0, 5).toString() === '%PDF-' && cd.includes(`photobook-${order.number}.pdf`), `book.pdf downloads as photobook-${order.number}.pdf (${(buf.length / 1e6).toFixed(1)} MB)`)
}

// 5б. Редактор = PDF: страница 5 из PDF (pdf.js рисует её в браузере) и снимок
//     редактора. По ярко-красным пикселям текста считаем центр, наклон главной
//     оси и длину надписи в долях страницы по линии реза — должны совпасть.
{
  const f = book.format
  const sheet = f.widthMm + 2 * f.bleedMm
  const check5b = await browser.newPage()
  const pdfjsDir = 'node_modules/pdfjs-dist/build'
  await check5b.route('http://pdfcheck.local/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' })
    if (path === '/book.pdf') return route.fulfill({ contentType: 'application/pdf', body: pdfBytes })
    if (!path.endsWith('.mjs')) return route.fulfill({ status: 404 })
    return route.fulfill({ contentType: 'text/javascript', body: readFileSync(pdfjsDir + path) })
  })
  await check5b.goto('http://pdfcheck.local/')
  const stats = await check5b.evaluate(async ({ png, pageNo, margin }) => {
    // pdf.js без отдельного Web Worker: обработчик воркера — в основном потоке.
    const pdfjs = await import('/pdf.min.mjs')
    globalThis.pdfjsWorker = await import('/pdf.worker.min.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

    // Красные пиксели внутри страницы по линии реза (margin — доля вылета от листа).
    function redStats(canvas, margin) {
      const { width: W, height: H } = canvas
      const { data } = canvas.getContext('2d').getImageData(0, 0, W, H)
      const x0 = margin * W, x1 = W - margin * W, y0 = margin * H, y1 = H - margin * H
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
      for (let y = Math.ceil(y0); y < y1; y++) {
        for (let x = Math.ceil(x0); x < x1; x++) {
          const i = (y * W + x) * 4
          if (data[i] > 150 && data[i + 1] < 70 && data[i + 2] < 70) {
            const u = (x - x0) / (x1 - x0), v = (y - y0) / (y1 - y0)
            n++; sx += u; sy += v; sxx += u * u; syy += v * v; sxy += u * v
          }
        }
      }
      const cx = sx / n, cy = sy / n
      const vxx = sxx / n - cx * cx, vyy = syy / n - cy * cy, vxy = sxy / n - cx * cy
      const angle = (0.5 * Math.atan2(2 * vxy, vxx - vyy) * 180) / Math.PI
      const spread = Math.sqrt((vxx + vyy) / 2 + Math.sqrt(((vxx - vyy) / 2) ** 2 + vxy * vxy)) // вдоль главной оси
      return { n, cx, cy, angle, spread }
    }

    const doc = await pdfjs.getDocument({ url: '/book.pdf' }).promise
    const page = await doc.getPage(pageNo)
    const vp = page.getViewport({ scale: 3 })
    const pdfCanvas = document.createElement('canvas')
    pdfCanvas.width = Math.round(vp.width)
    pdfCanvas.height = Math.round(vp.height)
    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp }).promise

    const img = new Image()
    img.src = 'data:image/png;base64,' + png
    await img.decode()
    const edCanvas = document.createElement('canvas')
    edCanvas.width = img.naturalWidth
    edCanvas.height = img.naturalHeight
    edCanvas.getContext('2d').drawImage(img, 0, 0)

    return { pdf: redStats(pdfCanvas, margin), editor: redStats(edCanvas, 0), pdfPng: pdfCanvas.toDataURL('image/png') }
  }, { png: editorShot.toString('base64'), pageNo: 1 + 5, margin: f.bleedMm / sheet })
  writeFileSync(`${out}/pr-pdf-p5.png`, Buffer.from(stats.pdfPng.split(',')[1], 'base64'))
  await check5b.close()

  const { pdf: p, editor: e } = stats
  const fmt = (s) => `центр ${(s.cx * 100).toFixed(1)}%, ${(s.cy * 100).toFixed(1)}%; наклон ${s.angle.toFixed(1)}°; длина ${(s.spread * 100).toFixed(2)}`
  log(`  редактор: ${fmt(e)}\n  PDF:      ${fmt(p)}`)
  check(p.n > 500 && e.n > 500, `rotated text found in the editor (${e.n} px) and in the PDF (${p.n} px)`)
  check(Math.abs(p.cx - e.cx) < 0.005 && Math.abs(p.cy - e.cy) < 0.005, 'PDF: rotated text in the same place as in the editor (±1 mm)')
  check(Math.abs(p.angle - e.angle) < 1 && Math.abs(p.angle + 25) < 1.5, 'PDF: same tilt as in the editor (−25°)')
  check(Math.abs(p.spread / e.spread - 1) < 0.03, 'PDF: same text size relative to the page as in the editor')
}

// 6. Печатная страница с оригиналами — только по подписи backend.
const { status: noSig } = await fetch(`${apiBase}/api/print/00000000-0000-0000-0000-000000000000`)
check(noSig === 403, 'print data without a signature → 403')
const { status: badSig } = await fetch(`${apiBase}/api/print/00000000-0000-0000-0000-000000000000?exp=9999999999&sig=abc`)
check(badSig === 403, 'print data with a forged signature → 403')

// 7. «Пересобрать PDF» из админки.
const re = await admin(`/orders/${order.number}/render`, { method: 'POST', redirect: 'manual' })
check(re.status === 303, 're-render requested from admin')
page = await waitPdf(order.number)
check(page.includes('book.pdf — 22 стр.'), 'PDF rebuilt')

await browser.close()
log(problems.length ? '\nPROBLEMS:\n' + problems.join('\n') : '\nALL PRINT CHECKS PASSED')
process.exit(problems.length ? 1 : 0)
