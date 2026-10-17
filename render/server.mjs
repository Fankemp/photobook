// Сервис рендера печатных PDF. Backend присылает адрес печатной страницы сайта
// и размер листа в мм; Chromium (Playwright) открывает страницу, ждёт, пока она
// скажет «готово» (фото и шрифты загружены), и печатает её в PDF.
// Затем PDF проверяется (pdfinfo, pdffonts) и, если просили, переводится
// в CMYK через Ghostscript. Один рендер за раз — Chromium прожорлив по памяти.
//
// Многостраничный документ (блок) печатается ПО ОДНОЙ странице (?page=N),
// а затем страницы склеиваются qpdf без пересжатия. Так в памяти Chromium
// всегда фото только одной страницы, сколько бы их ни было в книге.
//
// POST /render  {url, widthMm, heightMm, pages, cmyk} → 200 application/pdf
//   заголовки X-Pdf-Pages, X-Pdf-Width-Mm, X-Pdf-Height-Mm, X-Pdf-Fonts, X-Pdf-Color
// GET  /health  → 200
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const run = promisify(execFile)
const PORT = Number(process.env.PORT ?? 3000)
const PAGE_TIMEOUT = 120_000 // загрузка страницы со всеми оригиналами фото
const PT_TO_MM = 25.4 / 72

let browser = null
async function getBrowser() {
  // Браузер один на все рендеры; если упал — запускаем заново.
  if (!browser || !browser.isConnected()) {
    // --disable-dev-shm-usage: в Docker /dev/shm маленький, Chromium падает без этого флага.
    browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] })
  }
  return browser
}

// Печать документа: одна страница — сразу, несколько — по одной и склейка.
async function renderDocument({ url, widthMm, heightMm, pages }, dir) {
  const out = join(dir, 'out.pdf')
  if (pages <= 1) {
    await writeFile(out, await renderPdf({ url, widthMm, heightMm }))
    return out
  }
  const parts = []
  for (let i = 0; i < pages; i++) {
    const t = Date.now()
    const part = join(dir, `page-${i}.pdf`)
    await writeFile(part, await renderPdf({ url: `${url}&page=${i}`, widthMm, heightMm }))
    parts.push(part)
    console.log(`  page ${i + 1}/${pages}: ${Date.now() - t} ms`)
  }
  const t = Date.now()
  await run('qpdf', ['--empty', '--pages', ...parts, '--', out])
  console.log(`  merge: ${Date.now() - t} ms`)
  return out
}

async function renderPdf({ url, widthMm, heightMm }) {
  const context = await (await getBrowser()).newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(url, { waitUntil: 'load', timeout: PAGE_TIMEOUT })
    // Печатная страница ставит window.__PRINT_READY__, когда загружены все фото
    // и шрифты (document.fonts.ready) и подобран размер текста.
    await page.waitForFunction(() => window.__PRINT_READY__ === true || window.__PRINT_ERROR__, null, {
      timeout: PAGE_TIMEOUT,
    })
    const pageError = await page.evaluate(() => window.__PRINT_ERROR__)
    if (pageError) throw new Error(`печатная страница: ${pageError}`)
    if (errors.length) throw new Error(`ошибка на странице: ${errors[0]}`)
    return await page.pdf({
      width: `${widthMm}mm`,
      height: `${heightMm}mm`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })
  } finally {
    await context.close()
  }
}

// Перевод в CMYK через Ghostscript (выключено, пока типографии нужен RGB).
// Фото не уменьшаются; JPEG пересжимается с качеством 95 (для CMYK иначе нельзя).
async function toCmyk(input, output) {
  await run('gs', [
    '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET',
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.6',
    '-sColorConversionStrategy=CMYK', '-sProcessColorModel=DeviceCMYK',
    '-dAutoRotatePages=/None',
    '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false',
    '-dAutoFilterColorImages=false', '-dColorImageFilter=/DCTEncode', '-dJPEGQ=95',
    '-o', output, input,
  ])
}

// Что получилось: страниц, размер первой страницы, встроенные шрифты, цвет.
async function inspect(file) {
  const { stdout: info } = await run('pdfinfo', [file])
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1])
  const size = /^Page size:\s+([\d.]+) x ([\d.]+) pts/m.exec(info)
  const { stdout: fontsOut } = await run('pdffonts', [file])
  // pdffonts: две строки заголовка, дальше «имя тип кодировка emb sub uni объект»
  const fonts = fontsOut.split('\n').slice(2).filter(Boolean).map((line) => {
    const cols = line.trim().split(/\s+/)
    const emb = cols.at(-5) === 'yes'
    return { name: cols[0], embedded: emb }
  })
  const notEmbedded = fonts.filter((f) => !f.embedded)
  if (notEmbedded.length) {
    throw new Error(`шрифты не встроены в PDF: ${notEmbedded.map((f) => f.name).join(', ')}`)
  }
  // Фото по pdfimages: цвет (icc — RGB с профилем sRGB, cmyk, gray) и как
  // вложены: jpeg — как есть, без пересжатия; image — разжаты (PNG, повороты).
  const { stdout: images } = await run('pdfimages', ['-list', file])
  const rows = images.split('\n').slice(2).filter(Boolean).map((l) => l.trim().split(/\s+/))
  const colors = [...new Set(rows.map((r) => r[5]))]
  const jpeg = rows.filter((r) => r[8] === 'jpeg').length
  return {
    pages,
    widthMm: (Number(size?.[1]) * PT_TO_MM).toFixed(2),
    heightMm: (Number(size?.[2]) * PT_TO_MM).toFixed(2),
    fonts: [...new Set(fonts.map((f) => f.name))],
    color: colors.length ? colors.join('+') : 'none', // заголовки HTTP — только ASCII
    images: `jpeg=${jpeg},other=${rows.length - jpeg}`,
  }
}

// Очередь: следующий рендер начинается только после предыдущего.
let queue = Promise.resolve()
function enqueue(task) {
  const result = queue.then(task, task)
  queue = result.catch(() => {})
  return result
}

async function handleRender(body) {
  const { url, widthMm, heightMm, pages = 1, cmyk } = JSON.parse(body)
  if (typeof url !== 'string' || !(widthMm > 0) || !(heightMm > 0)) throw new Error('нужны url, widthMm, heightMm')
  const dir = await mkdtemp(join(tmpdir(), 'render-'))
  try {
    let file = await renderDocument({ url, widthMm, heightMm, pages }, dir)
    if (cmyk) {
      const converted = join(dir, 'cmyk.pdf')
      await toCmyk(file, converted)
      file = converted
    }
    // Файл отдаётся потоком (см. ниже), а не читается целиком в память:
    // блок с оригиналами фото весит сотни мегабайт. Папку удалит отправка.
    return { file, dir, size: (await stat(file)).size, info: await inspect(file) }
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    throw err
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
    return
  }
  if (req.method !== 'POST' || req.url !== '/render') {
    res.writeHead(404).end()
    return
  }
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const started = Date.now()
    enqueue(() => handleRender(body)).then(
      ({ file, dir, size, info }) => {
        console.log(`rendered ${info.pages} p, ${(size / 1e6).toFixed(1)} MB in ${Date.now() - started} ms`)
        const cleanup = () => rm(dir, { recursive: true, force: true })
        try {
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Length': size,
            'X-Pdf-Pages': String(info.pages),
            'X-Pdf-Width-Mm': info.widthMm,
            'X-Pdf-Height-Mm': info.heightMm,
            'X-Pdf-Fonts': info.fonts.join(','),
            'X-Pdf-Color': info.color,
            'X-Pdf-Images': info.images,
          })
          const stream = createReadStream(file)
          stream.pipe(res)
          stream.on('close', cleanup)
        } catch (err) {
          cleanup()
          // Ошибка при отправке ответа не должна ронять весь сервис.
          console.error('send failed:', err.message)
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'send failed: ' + err.message }))
        }
      },
      (err) => {
        console.error('render failed:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: err.message }))
      },
    )
  })
})

server.listen(PORT, () => console.log(`render service on :${PORT}`))
