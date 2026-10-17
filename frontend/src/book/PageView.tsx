import { memo } from 'react'
import type { Format, Page, PageElement } from '../types.ts'
import { cropStyle } from './crop.ts'
import { fontFamily } from './fonts.ts'
import { box } from './geometry.ts'
import './PageView.css'

type Props = {
  page: Page
  format: Format
  // Откуда брать картинку по id фото. Нет функции — слоты рисуются пустыми
  // (например, в каталоге шаблонов).
  imageSrc?: (assetId: string) => string
}

// Один компонент рисует страницу везде: в каталоге, в редакторе, дальше —
// в превью и PDF (правило «превью = печать»). Все размеры — из формата книги.
//
// memo: страница перерисовывается, только если изменились её данные. Пока
// двигаешь фото на одной странице, остальные 20 в ленте не трогаются.
export const PageView = memo(function PageView({ page, format, imageSrc }: Props) {
  return (
    <div
      className="pv"
      style={{
        aspectRatio: `${format.widthMm} / ${format.heightMm}`,
        background: page.background || '#ffffff',
      }}
    >
      {page.elements.map((el) => (
        <ElementView key={el.id} el={el} format={format} imageSrc={imageSrc} />
      ))}
    </div>
  )
})

function ElementView({ el, format, imageSrc }: { el: PageElement; format: Format; imageSrc?: (id: string) => string }) {
  switch (el.type) {
    case 'photo_slot': {
      const src = el.assetId && imageSrc ? imageSrc(el.assetId) : undefined
      return (
        <div className="pv-el pv-slot" style={box(el)}>
          {src ? <img src={src} alt="" draggable={false} style={cropStyle(el.crop)} /> : <PhotoIcon />}
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

// Кегль задан в пунктах на бумаге (1 pt = 25.4/72 мм). Переводим в долю ширины
// страницы и задаём в cqw (1cqw = 1% ширины .pv, см. container-type в CSS):
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
