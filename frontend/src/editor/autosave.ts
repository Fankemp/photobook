import { useCallback, useEffect, useState } from 'react'
import { saveBook, toApiError } from '../api.ts'
import type { Book } from '../types.ts'
import type { Doc } from './doc.ts'
import { clearDraft, restoreDoc, writeDraft } from './draft.ts'

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'locked' | 'error'

const SAVE_DELAY = 1500 // мс тишины после правки, затем сохраняем
const RETRY_DELAY = 5000 // повтор, если нет связи

// Автосохранение — обычный класс, без React: проще читать и рассуждать.
//
// Правило: каждая правка → черновик в localStorage → через SAVE_DELAY
// отправка на сервер с номером версии. Сервер принимает, только если версия
// совпала (иначе книгу уже сохранили из другой вкладки — конфликт).
class AutoSaver {
  private readonly book: Book
  doc: Doc // текущее состояние в редакторе
  private saved: Doc // последнее, что точно лежит на сервере
  private version: number
  private timer: number | undefined
  private inFlight = false
  private stopped = false // после конфликта или ошибки больше не сохраняем
  private onStatus: (s: SaveStatus) => void = () => {}

  constructor(book: Book) {
    this.book = book
    this.version = book.version
    // Несохранённые правки с этого устройства (если есть) — поверх версии с сервера.
    // «Есть несохранённое» сравнивает объекты, а не содержимое, поэтому без
    // черновика doc и saved должны быть одним и тем же объектом.
    const { doc, fromDraft } = restoreDoc(book)
    this.saved = fromDraft ? { cover: book.cover, pages: book.pages, backCover: book.backCover } : doc
    this.doc = doc
  }

  // Куда сообщать о смене статуса (в React-состояние индикатора).
  listen(fn: (s: SaveStatus) => void) {
    this.onStatus = fn
  }

  hasUnsaved() {
    return this.doc !== this.saved
  }

  change(next: Doc) {
    this.doc = next
    if (this.stopped) return
    this.onStatus('pending')
    this.schedule(SAVE_DELAY)
  }

  schedule(delay: number) {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.save(), delay)
  }

  async save(keepalive = false) {
    window.clearTimeout(this.timer)
    if (this.stopped || !this.hasUnsaved()) return
    writeDraft(this.book.token, { doc: this.doc, baseVersion: this.version })
    if (this.inFlight) {
      this.schedule(500) // дождёмся ответа на предыдущий запрос
      return
    }

    const sending = this.doc
    this.inFlight = true
    this.onStatus('saving')
    try {
      const res = await saveBook(this.book.token, { version: this.version, ...sending }, keepalive)
      this.version = res.version
      this.saved = sending
      if (this.doc === sending) {
        clearDraft(this.book.token)
        this.onStatus('saved')
      } else {
        this.onStatus('pending') // пока сохраняли, появились новые правки
        this.schedule(SAVE_DELAY)
      }
    } catch (err) {
      const e = toApiError(err)
      if (e.code === 'version_conflict') {
        this.stopped = true
        this.onStatus('conflict')
      } else if (e.code === 'book_locked') {
        // По книге оформили заявку (например, с другого устройства) — правки больше не принимаются.
        this.stopped = true
        clearDraft(this.book.token)
        this.onStatus('locked')
      } else if (e.code === 'network' || e.status === 0 || e.status >= 500) {
        this.onStatus('offline') // черновик уже в localStorage, повторим позже
        this.schedule(RETRY_DELAY)
      } else {
        // 400 — книга не прошла проверку на сервере (ошибка в нашем коде).
        // Черновик убираем, иначе после перезагрузки снова упрёмся в ту же ошибку.
        this.stopped = true
        clearDraft(this.book.token)
        this.onStatus('error')
      }
    } finally {
      this.inFlight = false
    }
  }

  dispose() {
    window.clearTimeout(this.timer)
  }
}

const HISTORY_LIMIT = 100

// История правок для «Отменить» / «Повторить». Хранит снимки Doc целиком: правки
// неизменяемые, поэтому снимок — просто ссылка, а неизменённые страницы общие
// у всех снимков (памяти почти не тратит).
//
// Тег склеивает правки в один шаг: перетаскивание текста шлёт правку на каждое
// движение пальца, но отменяется целиком. Правки с одинаковым тегом подряд —
// один шаг; без тега каждая правка — отдельный шаг.
class History {
  private past: Doc[] = []
  private future: Doc[] = []
  private lastTag: string | undefined

  record(prev: Doc, tag?: string) {
    this.future = []
    if (tag !== undefined && tag === this.lastTag) return
    this.lastTag = tag
    this.past.push(prev)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
  }

  undo(current: Doc): Doc | undefined {
    const prev = this.past.pop()
    if (prev) this.future.push(current)
    this.lastTag = undefined
    return prev
  }

  redo(current: Doc): Doc | undefined {
    const next = this.future.pop()
    if (next) this.past.push(current)
    this.lastTag = undefined
    return next
  }

  state() {
    return { canUndo: this.past.length > 0, canRedo: this.future.length > 0 }
  }
}

// useBookDoc — состояние книги в редакторе + автосохранение + отмена правок.
// update(fn, tag) применяет правку: fn получает текущий Doc и возвращает новый
// (про tag — см. History). undo/redo возвращают восстановленный Doc или undefined.
// Отмена — тоже правка: сохраняется автоматически, как и всё остальное.
export function useBookDoc(book: Book) {
  const [saver] = useState(() => new AutoSaver(book))
  const [history] = useState(() => new History())
  const [doc, setDoc] = useState(saver.doc)
  const [status, setStatus] = useState<SaveStatus>(saver.hasUnsaved() ? 'pending' : 'saved')
  // Отдельным состоянием, чтобы не читать изменяемый объект истории во время отрисовки.
  const [undoState, setUndoState] = useState(history.state())

  const apply = useCallback(
    (next: Doc) => {
      saver.change(next)
      setDoc(next)
      const s = history.state()
      setUndoState((old) => (old.canUndo === s.canUndo && old.canRedo === s.canRedo ? old : s))
    },
    [saver, history],
  )

  const update = useCallback(
    (fn: (d: Doc) => Doc, tag?: string) => {
      const next = fn(saver.doc)
      if (next === saver.doc) return
      history.record(saver.doc, tag)
      apply(next)
    },
    [saver, history, apply],
  )

  const undo = useCallback(() => {
    const prev = history.undo(saver.doc)
    if (prev) apply(prev)
    return prev
  }, [saver, history, apply])

  const redo = useCallback(() => {
    const next = history.redo(saver.doc)
    if (next) apply(next)
    return next
  }, [saver, history, apply])

  useEffect(() => {
    saver.listen(setStatus)
    if (saver.hasUnsaved()) saver.schedule(0) // восстановили черновик — сохраняем сразу

    // Вкладку свернули или закрывают — сохраняем немедленно (keepalive переживёт закрытие).
    const onHide = () => {
      if (document.visibilityState === 'hidden') void saver.save(true)
    }
    // Есть несохранённое — браузер спросит «Покинуть страницу?».
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saver.hasUnsaved()) e.preventDefault()
    }
    const onOnline = () => saver.schedule(0)

    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('online', onOnline)
      void saver.save(true) // уходим из редактора внутри сайта — дохраняем
      saver.dispose()
    }
  }, [saver])

  return { doc, update, undo, redo, ...undoState, status }
}
