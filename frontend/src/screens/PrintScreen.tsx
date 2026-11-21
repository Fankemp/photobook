import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { getPrintData } from '../api.ts'
import { PageView } from '../book/PageView.tsx'
import { sheetMarginMm, type PageKind } from '../book/geometry.ts'
import { useLoad } from '../lib/useLoad.ts'
import type { Page, PrintData } from '../types.ts'

// Сервис рендера сообщает о готовности через эти поля window (см. render/server.mjs).
declare global {
  interface Window {
    __PRINT_READY__?: boolean
    __PRINT_ERROR__?: string
  }
}

// Печатная страница /print/<id заявки>?v=<версия заказа>&sheet=front|back|page&page=N&exp=…&sig=…
// Её открывает только Chromium сервиса рендера и печатает ОДИН лист PDF:
// переднюю обложку, заднюю или страницу блока N — точного размера, с вылетом,
// с оригиналами фото. Порядок листов в файле задаёт backend по настройке формата.
// Рисует тот же PageView, что редактор и превью (правило «превью = печать»).
export function PrintScreen() {
  const { orderId = '' } = useParams()
  const [search] = useSearchParams()
  const sheet = search.get('sheet') ?? 'page'
  const pageIndex = Number(search.get('page') ?? 0)
  // v — снимок заказа (версия), который печатаем; подпись ссылки покрывает и его.
  const query = new URLSearchParams({ v: search.get('v') ?? '', exp: search.get('exp') ?? '', sig: search.get('sig') ?? '' }).toString()
  const data = useLoad(orderId, (signal) => getPrintData(orderId, query, signal))
  const d = data.status === 'ok' ? data.data : null
  const page = d && (sheet === 'front' ? d.cover : sheet === 'back' ? d.backCover : d.pages[pageIndex])

  // Ошибки сообщаем сервису рендера — он не будет ждать «готово» до таймаута.
  useEffect(() => {
    if (data.status === 'error') window.__PRINT_ERROR__ = `данные: ${data.error.code}`
    else if (data.status === 'ok' && !page) window.__PRINT_ERROR__ = `нет листа ${sheet} ${pageIndex}`
  }, [data, page, sheet, pageIndex])

  if (!d || !page) return null
  const kind: PageKind = sheet === 'page' ? 'page' : 'cover'
  return <Sheet data={d} page={page} kind={kind} />
}

function Sheet({ data, page, kind }: { data: PrintData; page: Page; kind: PageKind }) {
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
        .print-sheet { width: ${widthMm}mm; height: ${heightMm}mm; overflow: hidden; }
      `}</style>
      <div className="print-sheet">
        <PageView
          page={page}
          format={data.format}
          imageSrc={(id) => data.images[id]}
          variant="print"
          showBleed
          kind={kind}
        />
      </div>
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
