import type { Book } from '../types.ts'
import type { Doc } from './doc.ts'

// Черновик книги в localStorage — страховка на случай обрыва сети или
// закрытой вкладки: несохранённые правки не пропадут на этом устройстве.
// baseVersion — версия с сервера, поверх которой сделаны правки.
type Draft = { doc: Doc; baseVersion: number }

const key = (token: string) => `photobook.draft.${token}`

export function readDraft(token: string): Draft | null {
  try {
    const raw = localStorage.getItem(key(token))
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch {
    return null
  }
}

export function writeDraft(token: string, draft: Draft) {
  try {
    localStorage.setItem(key(token), JSON.stringify(draft))
  } catch {
    // нет места или запрещено — работаем без черновика
  }
}

// restoreDoc — что показывать: черновик с этого устройства или версию с сервера.
// Черновик берём, только если он сделан поверх той же версии, что на сервере,
// и отличается от неё. Иначе сервер новее (сохранили с другого устройства),
// и устаревший черновик удаляем. Общая логика для редактора и превью.
export function restoreDoc(book: Book): { doc: Doc; fromDraft: boolean } {
  const server: Doc = { cover: book.cover, pages: book.pages, backCover: book.backCover }
  const raw = readDraft(book.token)
  // Черновик, сохранённый до появления задней обложки, — дополняем ею с сервера.
  const draft = raw && { ...raw, doc: { ...raw.doc, backCover: raw.doc.backCover ?? book.backCover } }
  if (draft && draft.baseVersion === book.version && JSON.stringify(draft.doc) !== JSON.stringify(server)) {
    return { doc: draft.doc, fromDraft: true }
  }
  if (draft) clearDraft(book.token)
  return { doc: server, fromDraft: false }
}

export function clearDraft(token: string) {
  try {
    localStorage.removeItem(key(token))
  } catch {
    // недоступен — не страшно
  }
}
