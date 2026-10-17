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

export function clearDraft(token: string) {
  try {
    localStorage.removeItem(key(token))
  } catch {
    // недоступен — не страшно
  }
}
