import { Link, useSearchParams } from 'react-router'
import { listTemplates } from '../api.ts'
import { PageView } from '../book/PageView.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { t } from '../i18n/index.ts'
import { getLastBook } from '../lib/lastBook.ts'
import { useLoad } from '../lib/useLoad.ts'
import type { TemplateSummary } from '../types.ts'

// Поводы в порядке словаря (так они идут в фильтре).
const OCCASIONS = Object.keys(t.occasions)

// Главная: каталог шаблонов. Карточка показывает обложку шаблона
// тем же компонентом, что рисует книгу. Фильтр по поводу хранится в адресе
// (/?occasion=mom): ссылкой можно поделиться, перезагрузка его не сбрасывает.
export function CatalogScreen() {
  const templates = useLoad('all', (signal) => listTemplates(signal))
  const [search, setSearch] = useSearchParams()
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
        <Templates
          list={templates.data}
          occasion={search.get('occasion')}
          // replace: смена фильтра не копится в истории — «назад» уводит со страницы.
          onOccasion={(o) => setSearch(o ? { occasion: o } : {}, { replace: true })}
        />
      )}
    </main>
  )
}

type TemplatesProps = {
  list: TemplateSummary[]
  occasion: string | null // из адреса; неизвестный повод — показываем все
  onOccasion: (occasion: string | null) => void
}

function Templates({ list, occasion, onOccasion }: TemplatesProps) {
  // В фильтре — только поводы, для которых есть шаблоны.
  const present = OCCASIONS.filter((o) => list.some((tpl) => tpl.occasion === o))
  const active = occasion && present.includes(occasion) ? occasion : null
  const shown = active ? list.filter((tpl) => tpl.occasion === active) : list

  return (
    <>
      {present.length > 1 && (
        <div className="chips" role="group" aria-label={t.catalog.filter}>
          <button className="chip" aria-pressed={active === null} onClick={() => onOccasion(null)}>
            {t.catalog.all}
          </button>
          {present.map((o) => (
            <button key={o} className="chip" aria-pressed={active === o} onClick={() => onOccasion(o)}>
              {t.occasions[o]}
            </button>
          ))}
        </div>
      )}
      <ul className="grid">
        {shown.map((tpl) => (
          <li key={tpl.id}>
            <Link className="tpl-card" to={`/templates/${tpl.id}`}>
              <PageView page={tpl.cover} format={tpl.format} />
              <span className="tpl-card-name">{tpl.name}</span>
              <span className="muted">{t.occasions[tpl.occasion] ?? tpl.occasion}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
