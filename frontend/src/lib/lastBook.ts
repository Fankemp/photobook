// Последняя открытая книга — чтобы на главной показать «Продолжить мою книгу».
// Это только удобство: если localStorage недоступен (приватный режим, запрет
// cookies), молча ничего не запоминаем. Настоящий доступ к книге — по ссылке.
const KEY = 'photobook.lastBook'

export function getLastBook(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function saveLastBook(token: string) {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    // недоступен — не страшно
  }
}

export function forgetLastBook(token: string) {
  try {
    if (localStorage.getItem(KEY) === token) localStorage.removeItem(KEY)
  } catch {
    // недоступен — не страшно
  }
}
