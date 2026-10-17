import { useEffect, useRef } from 'react'
import { STICKER_SETS, stickerUrl, type StickerInfo } from '../book/stickers.ts'
import { t } from '../i18n/index.ts'

type Props = {
  onPick: (sticker: StickerInfo) => void
  onClose: () => void
}

// Окно выбора стикера: наборы друг под другом, тап по стикеру — добавить
// его на текущую страницу. Сверху — вкладки наборов (прилипают к верху окна),
// тап — прокрутить к набору. Esc или «Отмена» — закрыть без изменений.
export function StickerPicker({ onPick, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const sections = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal() // модальное окно: страница под ним не нажимается
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className="ed-dialog ed-picker"
      aria-labelledby="sticker-picker-title"
      onCancel={(e) => {
        e.preventDefault() // Esc: закрываем сами, чтобы состояние редактора совпадало
        onClose()
      }}
    >
      <h2 id="sticker-picker-title">{t.editor.stickersTitle}</h2>
      <nav className="ed-picker-tabs" aria-label={t.editor.stickerSets}>
        {STICKER_SETS.map((set) => (
          <button
            key={set.id}
            className="ed-picker-tab"
            onClick={() => sections.current.get(set.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
          >
            {set.name}
          </button>
        ))}
      </nav>
      {STICKER_SETS.map((set) => (
        <section
          key={set.id}
          className="ed-picker-set"
          ref={(el) => {
            if (el) sections.current.set(set.id, el)
            else sections.current.delete(set.id)
          }}
        >
          <h3>{set.name}</h3>
          <div className="ed-picker-grid">
            {set.stickers.map((s) => (
              <button key={s.id} className="ed-picker-item" title={s.name} aria-label={s.name} onClick={() => onPick(s)}>
                <img src={stickerUrl(s)} alt="" draggable={false} />
              </button>
            ))}
          </div>
        </section>
      ))}
      <div className="ed-toolbar-row ed-picker-actions">
        <button className="btn" onClick={onClose}>
          {t.editor.cancel}
        </button>
      </div>
    </dialog>
  )
}
