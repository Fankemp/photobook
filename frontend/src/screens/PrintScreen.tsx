import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { getPrintData } from '../api.ts'
import { PageView } from '../book/PageView.tsx'
import { sheetMarginMm, type PageKind } from '../book/geometry.ts'
import { useLoad } from '../lib/useLoad.ts'
import type { PrintData } from '../types.ts'

// Сервис рендера сообщает о готовности через эти поля window (см. render/server.mjs).
declare global {
  interface Window {
    __PRINT_READY__?: boolean
    __PRINT_ERROR__?: string
  }
}

// Печатная страница /print/<id заявки>?part=cover|block&page=N&exp=…&sig=…
// Её открывает только Chromium сервиса рендера и печатает в PDF: каждая
// страница книги — отдельный лист точного размера (с вылетом), фото — оригиналы.
// page=N — только одна страница блока: сервис печатает блок по странице,
// чтобы в памяти Chromium были фото одной страницы, а не всей книги.
// Рисует тот же PageView, что редактор и превью (правило «превью = печать»).
export function PrintScreen() {
  const { orderId = '' } = useParams()
  const [search] = useSearchParams()
  const part: PageKind = search.get('part') === 'cover' ? 'cover' : 'page'
  const pageParam = search.get('page')
  const only = pageParam === null ? null : Number(pageParam)
  const query = new URLSearchParams({ exp: search.get('exp') ?? '', sig: search.get('sig') ?? '' }).toString()
  const data = useLoad(orderId + part, (signal) => getPrintData(orderId, query, signal))

  useEffect(() => {
    if (data.status === 'error') window.__PRINT_ERROR__ = `данные: ${data.error.code}`
  }, [data])

  return data.status === 'ok' ? <Sheets data={data.data} kind={part} only={only} /> : null
}

function Sheets({ data, kind, only }: { data: PrintData; kind: PageKind; only: number | null }) {
  const all = kind === 'cover' ? [data.cover] : data.pages
  const pages = only === null ? all : all.slice(only, only + 1)
  const margin = sheetMarginMm(data.format, kind)
  const widthMm = data.format.widthMm + 2 * margin
  const heightMm = data.format.heightMm + 2 * margin

  useEffect(() => {
    whenPrintable().then(
      () => (window.__PRINT_READY__ = true),
      (err: Error) => (window.__PRINT_ERROR__ = err.message),
    )
  }, [])

  return (
    <>
      {/* Лист PDF — ровно страница с вылетом, без полей; фон сайта — белый. */}
      <style>{`
        @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        .print-sheet { width: ${widthMm}mm; height: ${heightMm}mm; overflow: hidden; break-after: page; }
        .print-sheet:last-child { break-after: auto; }
      `}</style>
      {pages.map((page) => (
        <div key={page.id} className="print-sheet">
          <PageView
            page={page}
            format={data.format}
            imageSrc={(id) => data.images[id]}
            variant="print"
            showBleed
            kind={kind}
          />
        </div>
      ))}
    </>
  )
}

// Печатать можно, когда загружены и декодированы все фото, загружены шрифты
// и после этого текст успел подобрать размер (TextView пересчитывает по шрифту).
async function whenPrintable() {
  const images = [...document.images]
  await Promise.all(
    images.map((img) =>
      img.decode().catch(() => {
        throw new Error(`фото не загрузилось: ${img.src.slice(0, 120)}`)
      }),
    ),
  )
  await document.fonts.ready
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  await document.fonts.ready
}
