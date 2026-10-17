import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, createBook, getTemplate, toApiError } from '../api.ts'
import { PagesGrid } from '../book/PagesGrid.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { SiteFooter, SiteHeader } from '../components/Site.tsx'
import { t } from '../i18n/index.ts'
import { demoImageSrc, withDemoPhotos } from '../landing/demo.ts'
import { saveLastBook } from '../lib/lastBook.ts'
import { useLoad } from '../lib/useLoad.ts'

// Просмотр шаблона перед выбором. Рамки заняты примерами фото — видно, как
// книга будет выглядеть; в книгу они не попадают. Книга создаётся только
// по кнопке, чтобы просто листающие каталог не плодили пустые книги в базе.
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

  const tpl = template.status === 'ok' ? template.data : null
  // Сцены идут подряд через обложку и страницы (useMemo: не пересчитывать на каждый рендер).
  const demo = useMemo(() => {
    if (!tpl) return null
    const [cover, ...rest] = withDemoPhotos([tpl.cover, ...tpl.pages, tpl.backCover], tpl.occasion)
    return { cover, pages: rest.slice(0, -1), backCover: rest[rest.length - 1] }
  }, [tpl])

  return (
    <>
    <SiteHeader />
    <main className="page page-wide">
      <Link to={{ pathname: '/', hash: '#templates' }} className="back">
        {t.template.back}
      </Link>

      {template.status === 'loading' && <p>{t.loading}</p>}
      {template.status === 'error' && <ErrorMessage error={template.error} />}
      {template.status === 'ok' && (
        <>
          <h1>{template.data.name}</h1>
          <p className="muted">{t.formatInfo(template.data.format.name, template.data.pageCount)}</p>
          <p className="muted">{t.template.demoNote}</p>

          {demo && (
            <PagesGrid
              cover={demo.cover}
              pages={demo.pages}
              backCover={demo.backCover}
              format={template.data.format}
              imageSrc={demoImageSrc}
              variant="print"
            />
          )}

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
    <SiteFooter />
    </>
  )
}
