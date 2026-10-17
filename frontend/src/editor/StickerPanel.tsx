import { stickerById } from '../book/stickers.ts'
import { t } from '../i18n/index.ts'
import type { Format, StickerElement } from '../types.ts'
import { resizeSticker, rotateSticker, STICKER_WIDTH } from './doc.ts'

type Props = {
  el: StickerElement
  format: Format
  // tag склеивает правки одного ползунка в один шаг «Отменить» (см. autosave.ts).
  onChange: (fn: (el: StickerElement) => StickerElement, tag?: string) => void
  onRemove: () => void
  onDone: () => void
}

// Панель внизу экрана для выбранного стикера: размер и поворот ползунками
// (на телефоне надёжнее, чем угловые ручки на маленьком стикере), удалить.
// Двигают сам стикер на странице — см. StickerOverlay.
export function StickerPanel({ el, format, onChange, onRemove, onDone }: Props) {
  const sticker = stickerById(el.stickerId)
  const rotation = el.rotation ?? 0

  return (
    <>
      <label className="ed-range">
        <span>{t.editor.stickerSize}</span>
        <input
          type="range"
          min={STICKER_WIDTH.min}
          max={STICKER_WIDTH.max}
          step={0.5}
          value={el.w}
          onChange={(e) => onChange((s) => resizeSticker(s, Number(e.target.value), sticker, format), 'size')}
        />
      </label>
      <label className="ed-range">
        <span>{t.editor.stickerRotation}</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={rotation}
          onChange={(e) => onChange((s) => rotateSticker(s, Number(e.target.value)), 'rotate')}
        />
        <output className="ed-range-value">{t.editor.degrees(rotation)}</output>
      </label>
      <div className="ed-toolbar-row">
        <button className="btn" onClick={onRemove}>
          {t.editor.deleteSticker}
        </button>
        <button className="btn btn-accent" onClick={onDone}>
          {t.editor.done}
        </button>
      </div>
      <p className="muted ed-hint">{t.editor.stickerHint}</p>
    </>
  )
}
