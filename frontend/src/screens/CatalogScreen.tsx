import { Link } from 'react-router'
import { listTemplates } from '../api.ts'
import { PageView } from '../book/PageView.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { t } from '../i18n/index.ts'
import { getLastBook } from '../lib/lastBook.ts'
import { useLoad } from '../lib/useLoad.ts'

// Главная: каталог шаблонов. Карточка показывает обложку шаблона
// тем же компонентом, что рисует книгу.
export function CatalogScreen() {
  const templates = useLoad('all', (signal) => listTemplates(signal))
  const lastBook = getLastBook()

  return (
    <main className="page">
      <h1>{t.catalog.title}</h1>
      <p className="muted">{t.catalog.subtitle}</p>

      {lastBook && (
        <Link className="banner" to={`/b/${lastBook}`}>
          {t.catalog.continueBook} →
        </Link>
      )}

      {templates.status === 'loading' && <p>{t.loading}</p>}
      {templates.status === 'error' && <ErrorMessage error={templates.error} />}
      {templates.status === 'ok' && (
        <ul className="grid">
          {templates.data.map((tpl) => (
            <li key={tpl.id}>
              <Link className="tpl-card" to={`/templates/${tpl.id}`}>
                <PageView page={tpl.cover} format={tpl.format} />
                <span className="tpl-card-name">{tpl.name}</span>
                <span className="muted">{t.occasions[tpl.occasion] ?? tpl.occasion}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
