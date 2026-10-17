import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, createBook, getTemplate, toApiError } from '../api.ts'
import { PagesGrid } from '../book/PagesGrid.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { t } from '../i18n/index.ts'
import { saveLastBook } from '../lib/lastBook.ts'
import { useLoad } from '../lib/useLoad.ts'

// Просмотр шаблона перед выбором. Книга создаётся только по кнопке,
// чтобы просто листающие каталог не плодили пустые книги в базе.
export function TemplateScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const template = useLoad(id, (signal) => getTemplate(id, signal))
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<ApiError | null>(null)

  async function create() {
    setCreating(true)
    setCreateError(null)
    try {
      const { token } = await createBook(id)
      saveLastBook(token)
      navigate(`/b/${token}`)
    } catch (err) {
      setCreateError(toApiError(err))
      setCreating(false)
    }
  }

  return (
    <main className="page">
      <Link to="/" className="back">
        {t.template.back}
      </Link>

      {template.status === 'loading' && <p>{t.loading}</p>}
      {template.status === 'error' && <ErrorMessage error={template.error} />}
      {template.status === 'ok' && (
        <>
          <h1>{template.data.name}</h1>
          <p className="muted">{t.formatInfo(template.data.format.name, template.data.pageCount)}</p>

          <PagesGrid cover={template.data.cover} pages={template.data.pages} format={template.data.format} />

          {/* Кнопка прилипает к низу экрана: на телефоне её не нужно искать, листая вниз. */}
          <div className="sticky-actions">
            {createError && <ErrorMessage error={createError} />}
            <button className="btn btn-primary" onClick={create} disabled={creating}>
              {creating ? t.template.creating : t.template.create}
            </button>
          </div>
        </>
      )}
    </main>
  )
}
