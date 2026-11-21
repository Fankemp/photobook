import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react'
import { t } from '../i18n/index.ts'
import type { Format } from '../types.ts'
import { canAdd, canRemove, leafOf, nextCounts } from './pages.ts'

type BarProps = {
  format: Format
  count: number // страниц блока сейчас
  blockIndex: number | null // текущая страница блока (с 0); null — открыта обложка
  onDelete: () => void
  onAdd: () => void
  children?: ReactNode // сообщение «Страницы 5–6 удалены — Отменить» — под кнопками, ничего не закрывает
}

// Под страницей: «Удалить страницы 5–6», «Добавить 2 страницы» и счётчик
// «Страниц: 18 из 20» с подсказкой, сколько можно. Обложки не удаляются —
// на них кнопки «Удалить» нет. Отключённая кнопка объясняет почему (минимум,
// максимум) — подсказка под кнопками и в title.
export function PagesBar({ format, count, blockIndex, onDelete, onAdd, children }: BarProps) {
  // Число страниц фиксировано (min = max = число страниц книги) — кнопок нет.
  if (format.minPages === format.maxPages && count === format.maxPages) return children ? <div className="ed-pages">{children}</div> : null
  const step = format.pageStep
  const leaf = blockIndex === null ? null : leafOf(blockIndex, step)
  const removable = canRemove(count, format)
  const addable = canAdd(count, format)
  const { down, up } = nextCounts(count, format)

  return (
    <div className="ed-pages">
      <div className="ed-pages-actions">
        {leaf && (
          <button
            className="btn"
            onClick={onDelete}
            disabled={!removable}
            title={removable ? undefined : t.editor.minPagesReached(format.minPages)}
            aria-describedby="pages-hint"
          >
            {t.editor.deletePages(leaf.start + 1, Math.min(leaf.end, count))}
          </button>
        )}
        <button
          className="btn"
          onClick={onAdd}
          disabled={!addable}
          title={addable ? undefined : t.editor.maxPagesReached(format.maxPages)}
          aria-describedby="pages-hint"
        >
          {t.editor.addPages(step)}
        </button>
      </div>
      <p className="ed-pages-count" id="pages-hint">
        <strong>{t.editor.pagesCount(count, format.maxPages)}.</strong>{' '}
        <span className="muted">{t.editor.pagesHint(down, up, step, format.minPages, format.maxPages)}</span>
      </p>
      {children}
    </div>
  )
}

type ConfirmProps = {
  title: string
  text: string
  confirm: string
  onConfirm: () => void
  onCancel: () => void
}

// Подтверждение действия, которое трудно не заметить (удаление страниц с фото).
// Модальное окно: страница под ним не нажимается; Esc — отмена.
export function ConfirmDialog({ title, text, confirm, onConfirm, onCancel }: ConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className="ed-dialog ed-confirm"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <h2 id="confirm-title">{title}</h2>
      <p>{text}</p>
      <div className="ed-toolbar-row">
        <button className="btn" onClick={onCancel}>
          {t.editor.cancel}
        </button>
        <button className="btn btn-danger" onClick={onConfirm} autoFocus>
          {confirm}
        </button>
      </div>
    </dialog>
  )
}

type ToastProps = {
  text: string
  onUndo?: () => void // нет — сообщение без кнопки
  undoDisabled?: boolean
  onClose: () => void
}

const TOAST_MS = 10_000

// Короткое сообщение под кнопками страниц: «Страницы 5–6 удалены — Отменить».
// Само исчезает через 10 секунд; новое сообщение заменяет старое (key в Editor).
export function Toast({ text, onUndo, undoDisabled, onClose }: ToastProps) {
  const close = useEffectEvent(onClose)
  useEffect(() => {
    const timer = setTimeout(() => close(), TOAST_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="ed-toast" role="status">
      <span>{text}</span>
      {onUndo && (
        <button className="btn" onClick={onUndo} disabled={undoDisabled}>
          {t.editor.undo}
        </button>
      )}
    </div>
  )
}
