import { useEffect, useRef, useState } from 'react'
import { PageView } from '../book/PageView.tsx'
import { t } from '../i18n/index.ts'
import type { Format, Page, TextElement } from '../types.ts'

// Столько символов хватает на подпись или цитату; сервер допускает с запасом.
export const MAX_TEXT_LENGTH = 500

type Props = {
  el: TextElement
  page: Page // страница уже с текущим текстом — для живого превью
  format: Format
  imageSrc: (id: string) => string
  onChange: (text: string) => void
  onClose: () => void
}

// Окно ввода текста. Поле — вверху экрана, чтобы на телефоне его не закрыла
// клавиатура; над ним — уменьшенная страница, где сразу видно, как текст
// ложится. «Отмена» (или Esc) возвращает текст, который был до открытия.
export function TextDialog({ el, page, format, imageSrc, onChange, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [original] = useState(el.text)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal() // модальное окно: страница под ним не нажимается
    return () => dialog?.close()
  }, [])

  function cancel() {
    onChange(original)
    onClose()
  }

  return (
    <dialog
      ref={ref}
      className="ed-dialog"
      aria-labelledby="text-dialog-title"
      onCancel={(e) => {
        e.preventDefault() // Esc: закрываем сами, вернув исходный текст
        cancel()
      }}
    >
      <h2 id="text-dialog-title">{t.editor.textDialogTitle}</h2>
      <div className="ed-dialog-preview">
        <PageView page={page} format={format} imageSrc={imageSrc} />
      </div>
      <textarea
        autoFocus
        rows={3}
        value={el.text}
        maxLength={MAX_TEXT_LENGTH}
        // Проверка орфографии браузера: опечатки подчёркиваются красным.
        // lang="ru" — словарь русского языка (на телефоне — клавиатуры).
        spellCheck
        lang="ru"
        placeholder={t.editor.textPlaceholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="ed-toolbar-row">
        <button className="btn" onClick={cancel}>
          {t.editor.cancel}
        </button>
        <button className="btn btn-accent" onClick={onClose}>
          {t.editor.done}
        </button>
      </div>
    </dialog>
  )
}
