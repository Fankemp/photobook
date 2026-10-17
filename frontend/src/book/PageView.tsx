import { memo, type CSSProperties } from 'react'
import type { Format, Page, PageElement } from '../types.ts'
import { cropStyle } from './crop.ts'
import { fontFamily } from './fonts.ts'
import { bleedBox, box } from './geometry.ts'
import './PageView.css'

type Props = {
  page: Page
  format: Format
  // Откуда брать картинку по id фото. Нет функции — слоты рисуются пустыми
  // (например, в каталоге шаблонов).
  imageSrc?: (assetId: string) => string
  // Картинки грузить, только когда страница видна на экране (лента миниатюр).
  // Для печати не включать: в PDF всё должно загрузиться сразу.
  lazy?: boolean
  // screen — редактор и каталог: пустые рамки видны, чтобы было куда нажать.
  // print — как на бумаге (превью и PDF): пустая рамка не печатается, виден фон.
  variant?: 'screen' | 'print'
  // Показать поля вылета за линией реза. Без него видна ровно обрезанная страница.
  showBleed?: boolean
  // Линия реза и безопасная зона поверх страницы — подсказка в превью, не для печати.
  guides?: boolean
}

// Один компонент рисует страницу везде: в каталоге, в редакторе, в превью,
// дальше — в PDF (правило «превью = печать»). Все размеры — из формата книги.
//
// Внутри всегда рисуется лист целиком, с вылетом (холст), а внутри него —
// страница по линии реза. Фото у края заходят в вылет. Без showBleed наружу
// видна только часть по линии реза, поэтому кадр в редакторе = кадр на печати.
//
// memo: страница перерисовывается, только если изменились её данные. Пока
// двигаешь фото на одной странице, остальные 20 в ленте не трогаются.
export const PageView = memo(function PageView({
  page,
  format,
  imageSrc,
  lazy,
  variant = 'screen',
  showBleed = false,
  guides = false,
}: Props) {
  const { widthMm: w, heightMm: h, bleedMm: b } = format
  const sheetW = w + 2 * b
  const sheetH = h + 2 * b

  // Холст (лист с вылетом) относительно видимой рамки .pv.
  const sheet: CSSProperties = showBleed
    ? { left: 0, top: 0, width: '100%', height: '100%' }
    : { left: pct(-b, w), top: pct(-b, h), width: pct(sheetW, w), height: pct(sheetH, h) }
  // Страница по линии реза внутри холста.
  const trim: CSSProperties = { left: pct(b, sheetW), top: pct(b, sheetH), width: pct(w, sheetW), height: pct(h, sheetH) }

  return (
    <div className="pv" style={{ aspectRatio: showBleed ? `${sheetW} / ${sheetH}` : `${w} / ${h}` }}>
      <div className="pv-sheet" style={{ ...sheet, background: page.background || '#ffffff' }}>
        <div className="pv-trim" style={trim}>
          {page.elements.map((el) => (
            <ElementView key={el.id} el={el} format={format} imageSrc={imageSrc} lazy={lazy} variant={variant} />
          ))}
          {guides && <Guides format={format} />}
        </div>
      </div>
    </div>
  )
})

const pct = (part: number, whole: number) => `${(part / whole) * 100}%`

type ElementProps = Pick<Props, 'format' | 'imageSrc' | 'lazy' | 'variant'> & { el: PageElement }

function ElementView({ el, format, imageSrc, lazy, variant }: ElementProps) {
  switch (el.type) {
    case 'photo_slot': {
      const src = el.assetId && imageSrc ? imageSrc(el.assetId) : undefined
      if (!src && variant === 'print') return null // пустая рамка на бумаге не печатается
      return (
        <div className="pv-el pv-slot" style={bleedBox(el, format)}>
          {src ? (
            <img
              src={src}
              alt=""
              draggable={false}
              loading={lazy ? 'lazy' : undefined}
              decoding="async"
              style={cropStyle(el.crop)}
            />
          ) : (
            <PhotoIcon />
          )}
        </div>
      )
    }
    case 'text':
      return (
        <div
          className="pv-el pv-text"
          style={{
            ...box(el),
            fontFamily: fontFamily(el.font),
            fontSize: fontSize(el.size, format),
            color: el.color ?? '#000000',
            textAlign: el.align,
            fontWeight: el.bold ? 700 : 400,
          }}
        >
          {el.text}
        </div>
      )
    case 'sticker':
      return null // стикеры — шаг 9
  }
}

// Линия реза (всё за ней затемнено — уйдёт в обрезки) и безопасная зона
// (текст и важное держать внутри: рез может сместиться на пару миллиметров).
function Guides({ format }: { format: Format }) {
  const sx = pct(format.safeMm, format.widthMm)
  const sy = pct(format.safeMm, format.heightMm)
  return (
    <>
      <div className="pv-cut" />
      <div className="pv-safe" style={{ left: sx, right: sx, top: sy, bottom: sy }} />
    </>
  )
}

// Кегль задан в пунктах на бумаге (1 pt = 25.4/72 мм). Переводим в долю ширины
// страницы и задаём в cqw (1cqw = 1% ширины .pv-trim, см. container-type в CSS):
// текст масштабируется вместе со страницей, как картинка, на любом экране.
function fontSize(pt: number, format: Format): string {
  const mm = (pt * 25.4) / 72
  return `${(mm / format.widthMm) * 100}cqw`
}

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
