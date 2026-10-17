import { useEffect, useState } from 'react'
import { getHealth, type Health } from './api.ts'
import { t } from './i18n/index.ts'

type State =
  | { kind: 'loading' }
  | { kind: 'loaded'; health: Health }
  | { kind: 'unreachable' }

// Временная стартовая страница каркаса: показывает, что фронт видит бэкенд,
// а бэкенд — базу и хранилище. Заменим на выбор шаблонов на шаге 2.
export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    // AbortController отменяет запрос, если компонент размонтирован
    // (в dev-режиме StrictMode специально монтирует компоненты дважды).
    const ctrl = new AbortController()
    getHealth(ctrl.signal)
      .then((health) => setState({ kind: 'loaded', health }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ kind: 'unreachable' })
      })
    return () => ctrl.abort()
  }, [])

  return (
    <main className="page">
      <h1>{t.appTitle}</h1>
      <section className="card">
        <h2>{t.health.title}</h2>
        {state.kind === 'loading' && <p>{t.health.loading}</p>}
        {state.kind === 'unreachable' && <p className="error">{t.health.unreachable}</p>}
        {state.kind === 'loaded' && (
          <ul className="checks">
            <Check label={t.health.backend} ok />
            <Check label={t.health.db} ok={state.health.checks.db === 'ok'} />
            <Check label={t.health.storage} ok={state.health.checks.storage === 'ok'} />
          </ul>
        )}
      </section>
    </main>
  )
}

function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li>
      <span>{label}</span>
      <span className={ok ? 'ok' : 'error'}>{ok ? t.health.ok : t.health.error}</span>
    </li>
  )
}
