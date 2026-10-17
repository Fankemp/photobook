import { FONTS, fontFamily, fontHasBold } from '../book/fonts.ts'
import { t } from '../i18n/index.ts'
import type { TextElement } from '../types.ts'
import { TEXT_POSITIONS, textPosition, type TextPosition } from './doc.ts'

// Цвета текста. Первые — нейтральные, дальше — спокойные, хорошо печатаются.
const TEXT_COLORS = ['#000000', '#ffffff', '#4a3426', '#8a1c1c', '#c2410c', '#1e3a5f', '#2f5d3a', '#6b7280']

const SIZE_MIN = 6
const SIZE_MAX = 72

type Props = {
  el: TextElement
  movable: boolean // текст добавлен клиентом — можно выбрать место
  overflow: boolean
  onChange: (fn: (el: TextElement) => TextElement) => void
  onEdit: () => void
  onRemove: () => void
  onDone: () => void
}

// Панель внизу экрана для выбранного текста. Все настройки применяются сразу
// и видны на странице; сохраняются автоматически, как и остальные правки.
export function TextPanel({ el, movable, overflow, onChange, onEdit, onRemove, onDone }: Props) {
  const set = (patch: Partial<TextElement>) => onChange((e) => ({ ...e, ...patch }))
  const hasBold = fontHasBold(el.font)

  return (
    <div className="ed-text-panel">
      {overflow && <p className="ed-dpi-warning">{t.editor.textOverflow}</p>}

      <div className="ed-toolbar-row ed-text-actions">
        <button className="btn" onClick={onEdit}>
          {t.editor.editText}
        </button>
        <button className="btn" onClick={onRemove}>
          {t.editor.deleteText}
        </button>
        <button className="btn btn-accent" onClick={onDone}>
          {t.editor.done}
        </button>
      </div>

      {/* Каждый шрифт показан им самим — так проще выбрать. */}
      <div className="ed-fonts" role="radiogroup" aria-label={t.editor.font}>
        {FONTS.map((f) => (
          <button
            key={f.id}
            role="radio"
            aria-checked={el.font === f.id}
            className={el.font === f.id ? 'ed-chip is-on' : 'ed-chip'}
            style={{ fontFamily: fontFamily(f.id) }}
            title={t.editor.fontCategory[f.category]}
            // Без жирного начертания «Ж» выключаем, чтобы на печати не было сюрприза.
            onClick={() => set({ font: f.id, bold: f.bold ? el.bold : false })}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div className="ed-text-row">
        <div className="ed-group" role="group" aria-label={t.editor.size}>
          <button className="btn ed-icon-btn" aria-label={t.editor.smaller} disabled={el.size <= SIZE_MIN} onClick={() => set({ size: el.size - 1 })}>
            −
          </button>
          <span className="ed-size">{t.editor.sizeValue(el.size)}</span>
          <button className="btn ed-icon-btn" aria-label={t.editor.larger} disabled={el.size >= SIZE_MAX} onClick={() => set({ size: el.size + 1 })}>
            +
          </button>
        </div>

        <div className="ed-group" role="radiogroup" aria-label={t.editor.align}>
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={el.align === a}
              aria-label={t.editor.alignNames[a]}
              className={el.align === a ? 'btn ed-icon-btn is-on' : 'btn ed-icon-btn'}
              onClick={() => set({ align: a })}
            >
              <AlignIcon align={a} />
            </button>
          ))}
        </div>

        <button
          className={el.bold ? 'btn ed-icon-btn ed-bold is-on' : 'btn ed-icon-btn ed-bold'}
          aria-pressed={!!el.bold}
          aria-label={hasBold ? t.editor.bold : t.editor.boldUnavailable}
          title={hasBold ? undefined : t.editor.boldUnavailable}
          disabled={!hasBold}
          onClick={() => set({ bold: !el.bold })}
        >
          Ж
        </button>
      </div>

      <div className="ed-colors" role="radiogroup" aria-label={t.editor.color}>
        {TEXT_COLORS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={(el.color ?? '#000000') === c}
            aria-label={t.editor.colorNames[c] ?? c}
            className={(el.color ?? '#000000') === c ? 'ed-swatch is-on' : 'ed-swatch'}
            style={{ background: c }}
            onClick={() => set({ color: c })}
          />
        ))}
        {/* Любой другой цвет — системная палитра (на телефоне тоже работает). */}
        <label className="ed-swatch ed-swatch-custom" title={t.editor.customColor}>
          <input
            type="color"
            value={el.color ?? '#000000'}
            aria-label={t.editor.customColor}
            onChange={(e) => set({ color: e.target.value })}
          />
        </label>
      </div>

      {movable && (
        <div className="ed-group ed-positions" role="radiogroup" aria-label={t.editor.position}>
          {(Object.keys(TEXT_POSITIONS) as TextPosition[]).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={textPosition(el) === p}
              className={textPosition(el) === p ? 'btn is-on' : 'btn'}
              onClick={() => set({ y: TEXT_POSITIONS[p] })}
            >
              {t.editor.positionNames[p]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Три строки разной длины, выровненные как текст.
function AlignIcon({ align }: { align: 'left' | 'center' | 'right' }) {
  const widths = [16, 10, 13]
  const x = (w: number) => (align === 'left' ? 4 : align === 'right' ? 20 - w : 12 - w / 2)
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {widths.map((w, i) => (
        <rect key={i} x={x(w)} y={6 + i * 5} width={w} height="2" rx="1" fill="currentColor" />
      ))}
    </svg>
  )
}
