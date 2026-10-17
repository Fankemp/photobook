import { memo, useEffectEvent, useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { Format, Page, PageElement, TextElement } from '../types.ts'
import { cropStyle } from './crop.ts'
import { fontFamily } from './fonts.ts'
import { bleedBox, box, sheetMarginMm, type PageKind } from './geometry.ts'
import { stickerById, stickerUrl } from './stickers.ts'
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
  // Сообщает, поместился ли текст в свой блок (редактор показывает предупреждение).
  onTextFit?: (elId: string, fits: boolean) => void
  // cover — обложка: за линией реза кроме вылета ещё загиб на картон (format.wrapMm).
  kind?: PageKind
}

// Ниже этого кегля автоподбор не уменьшает: мельче на печати не прочитать.
export const MIN_TEXT_PT = 8

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
  onTextFit,
  kind = 'page',
}: Props) {
  const { widthMm: w, heightMm: h } = format
  const b = sheetMarginMm(format, kind) // поле за линией реза: вылет (+ загиб у обложки)
  const sheetW = w + 2 * b
  const sheetH = h + 2 * b

  // Холст (лист с вылетом) относительно видимой рамки .pv.
  const sheet: CSSProperties = showBleed
    ? { left: 0, top: 0, width: '100%', height: '100%' }
    : { left: pct(-b, w), top: pct(-b, h), width: pct(sheetW, w), height: pct(sheetH, h) }
  // Страница по линии реза внутри холста.
  const trim: CSSProperties = { left: pct(b, sheetW), top: pct(b, sheetH), width: pct(w, sheetW), height: pct(h, sheetH) }

  return (
    <div
      className={variant === 'print' ? 'pv pv-print' : 'pv'}
      style={{ aspectRatio: showBleed ? `${sheetW} / ${sheetH}` : `${w} / ${h}` }}
    >
      <div className="pv-sheet" style={{ ...sheet, background: page.background || '#ffffff' }}>
        <div className="pv-trim" style={trim}>
          {page.elements.map((el) => (
            <ElementView
              key={el.id}
              el={el}
              format={format}
              imageSrc={imageSrc}
              lazy={lazy}
              variant={variant}
              onTextFit={onTextFit}
              marginMm={b}
            />
          ))}
          {guides && <Guides format={format} />}
        </div>
      </div>
    </div>
  )
})

const pct = (part: number, whole: number) => `${(part / whole) * 100}%`

type ElementProps = Pick<Props, 'format' | 'imageSrc' | 'lazy' | 'variant' | 'onTextFit'> & {
  el: PageElement
  marginMm: number
}

function ElementView({ el, format, imageSrc, lazy, variant, onTextFit, marginMm }: ElementProps) {
  switch (el.type) {
    case 'photo_slot': {
      const src = el.assetId && imageSrc ? imageSrc(el.assetId) : undefined
      if (!src && variant === 'print') return null // пустая рамка на бумаге не печатается
      return (
        <div className="pv-el pv-slot" style={bleedBox(el, format, marginMm)}>
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
      return <TextView el={el} format={format} onFit={onTextFit} />
    case 'sticker': {
      const sticker = stickerById(el.stickerId)
      if (!sticker) return null // такого стикера нет в наборе — не рисуем пустое место
      // Поворот — вокруг центра; рисунок вписан в блок без искажений (object-fit: contain).
      return (
        <img
          className="pv-el pv-sticker"
          src={stickerUrl(sticker)}
          alt=""
          draggable={false}
          style={{ ...box(el), transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }}
        />
      )
    }
  }
}

// Текст с автоподбором кегля: если при заданном размере текст не влезает
// в блок, берём самый крупный размер, при котором влезает (но не меньше
// MIN_TEXT_PT). Подбор идёт по настоящей вёрстке с настоящим шрифтом, поэтому
// и в редакторе, и в превью, и в PDF он видит одно и то же. Пересчёт — при
// изменении текста, размера блока на экране и когда догрузился шрифт.
function TextView({ el, format, onFit }: { el: TextElement; format: Format; onFit?: (id: string, fits: boolean) => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const report = useEffectEvent((fits: boolean) => onFit?.(el.id, fits))

  useLayoutEffect(() => {
    const boxEl = boxRef.current
    const textEl = textRef.current
    if (!boxEl || !textEl) return

    const fitsAt = (pt: number) => {
      textEl.style.fontSize = fontSize(pt, format)
      return textEl.offsetHeight <= boxEl.clientHeight + 0.5
    }
    const fit = () => {
      const max = el.size
      const min = Math.min(MIN_TEXT_PT, el.size)
      if (fitsAt(max)) return report(true)
      if (!fitsAt(min)) return report(false) // не влезает даже мелко — лишнее обрежется
      let lo = min
      let hi = max
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2
        if (fitsAt(mid)) lo = mid
        else hi = mid
      }
      fitsAt(lo)
      report(true)
    }

    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(boxEl)
    document.fonts.addEventListener('loadingdone', fit)
    return () => {
      ro.disconnect()
      document.fonts.removeEventListener('loadingdone', fit)
    }
  }, [el.text, el.size, el.font, el.bold, el.w, el.h, format])

  return (
    <div
      ref={boxRef}
      className="pv-el pv-text"
      style={{
        ...box(el),
        fontFamily: fontFamily(el.font),
        color: el.color ?? '#000000',
        textAlign: el.align,
        fontWeight: el.bold ? 700 : 400,
      }}
    >
      <div ref={textRef} style={{ fontSize: fontSize(el.size, format) }}>
        {el.text}
      </div>
    </div>
  )
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
