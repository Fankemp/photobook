import { Link } from 'react-router'
import { t } from '../i18n/index.ts'

export function NotFoundScreen() {
  return (
    <main className="page">
      <h1>{t.notFound.title}</h1>
      <Link to="/">{t.notFound.home}</Link>
    </main>
  )
}
