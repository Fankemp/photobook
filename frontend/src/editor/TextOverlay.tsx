import { box } from '../book/geometry.ts'
import { t } from '../i18n/index.ts'
import type { TextElement } from '../types.ts'

type Props = {
  el: TextElement
  selected: boolean
  overflow: boolean // текст не влезает даже мелким шрифтом
  onTap: () => void
}

// Прозрачный слой над текстовым блоком: тап — выбрать текст.
// Сам текст рисует PageView; здесь только рамка выбора, подсказка
// в пустом блоке и предупреждение. На печать ничего из этого не попадает.
export function TextOverlay({ el, selected, overflow, onTap }: Props) {
  const empty = el.text.trim() === ''
  return (
    <div
      className={selected ? 'ed-text is-selected' : 'ed-text'}
      style={box(el)}
      data-el-id={el.id}
      role="button"
      aria-label={empty ? t.editor.textEmpty : t.editor.textFilled}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation() // клик по пустому месту страницы снимает выбор — а этот нет
        onTap()
      }}
    >
      {empty && <span className="ed-text-placeholder">{t.editor.textPlaceholder}</span>}
      {overflow && <span className="ed-dpi-badge">{t.editor.textOverflowShort}</span>}
    </div>
  )
}
