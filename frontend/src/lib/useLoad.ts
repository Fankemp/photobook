import { useEffect, useEffectEvent, useState } from 'react'
import { ApiError, toApiError } from '../api.ts'

export type Load<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; error: ApiError }

// Загружает данные при открытии экрана и заново при смене key (например, токена в URL).
// Если пользователь ушёл с экрана раньше, чем пришёл ответ, запрос отменяется.
//
//   const book = useLoad(token, (signal) => getBook(token, signal))
export function useLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>): Load<T> {
  // Результат помечен ключом, для которого он получен: так при смене key
  // старые данные не показываются, и не нужно вручную сбрасывать состояние.
  const [result, setResult] = useState<{ key: string; state: Load<T> }>()

  // load — новая функция на каждом рендере. useEffectEvent даёт эффекту вызвать
  // её свежую версию, но перезапускать загрузку только при смене key.
  const run = useEffectEvent(load)

  useEffect(() => {
    const ctrl = new AbortController()
    run(ctrl.signal).then(
      (data) => setResult({ key, state: { status: 'ok', data } }),
      (err) => {
        if (!ctrl.signal.aborted) setResult({ key, state: { status: 'error', error: toApiError(err) } })
      },
    )
    return () => ctrl.abort()
  }, [key])

  return result?.key === key ? result.state : { status: 'loading' }
}
