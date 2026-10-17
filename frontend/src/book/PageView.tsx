import type { CSSProperties } from 'react'
import type { Format, Page, PageElement } from '../types.ts'
import { fontFamily } from './fonts.ts'
import './PageView.css'

// Один компонент рисует страницу везде: в каталоге, в книге, дальше — в редакторе,
// превью и PDF (правило «превью = печать»). Все размеры — из формата книги.
export function PageView({ page, format }: { page: Page; format: Format }) {
  return (
    <div
      className="pv"
      style={{
        aspectRatio: `${format.widthMm} / ${format.heightMm}`,
        background: page.background || '#ffffff',
      }}
    >
      {page.elements.map((el) => (
        <ElementView key={el.id} el={el} format={format} />
      ))}
    </div>
  )
}

function ElementView({ el, format }: { el: PageElement; format: Format }) {
  switch (el.type) {
    case 'photo_slot':
      // Фото появятся на шаге 3; пока любой слот рисуется как пустой.
      return (
        <div className="pv-el pv-slot" style={box(el)}>
          <PhotoIcon />
        </div>
      )
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

// Координаты в процентах → абсолютное позиционирование внутри страницы.
function box(el: PageElement): CSSProperties {
  return { left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }
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
