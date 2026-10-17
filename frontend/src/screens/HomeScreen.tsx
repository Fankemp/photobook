import { useEffect, useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { getTemplate, listTemplates } from '../api.ts'
import { PageView } from '../book/PageView.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { CropMarks, SiteFooter, SiteHeader } from '../components/Site.tsx'
import { t } from '../i18n/index.ts'
import { demoImageSrc, withDemoCaptions, withDemoPhotos } from '../landing/demo.ts'
import { Flipbook, type Leaf } from '../landing/Flipbook.tsx'
import { getLastBook } from '../lib/lastBook.ts'
import { formatTenge } from '../lib/money.ts'
import { useLoad } from '../lib/useLoad.ts'
import type { Format, Page, Template, TemplateSummary } from '../types.ts'
import './HomeScreen.css'

// Книга на главной: этот шаблон с примерами фото. SHOWCASE_PAGES — какие его
// страницы (номера с 1) и в каком порядке лягут на листы: книга раскрывается
// на развороте «надпись от руки + фото на всю страницу», дальше — раскладки
// с фото и одна страница-пауза с фразой.
const SHOWCASE = 'family-album'
const SHOWCASE_PAGES = [2, 3, 4, 5, 6, 7, 8]

// Поводы в порядке словаря (так они идут в фильтре).
const OCCASIONS = Object.keys(t.occasions)

// Главная: книга, которую можно листать, шаблоны с фильтром по поводу
// (/?occasion=mom — ссылкой можно поделиться), как всё устроено, что вы
// получите, вопросы. Страницы шаблонов рисует тот же PageView, что и печать.
export function HomeScreen() {
  const templates = useLoad('all', (signal) => listTemplates(signal))
  const showcase = useLoad(SHOWCASE, (signal) => getTemplate(SHOWCASE, signal))
  const [search, setSearch] = useSearchParams()
  const { hash } = useLocation()
  const lastBook = getLastBook()

  // Ссылки «/#templates» из шапки других страниц: прокручиваем к разделу,
  // когда он отрисован (шаблоны грузятся с сервера).
  const loaded = templates.status === 'ok'
  useEffect(() => {
    if (hash && loaded) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [hash, loaded])

  const format = templates.status === 'ok' ? templates.data[0]?.format : undefined

  return (
    <>
      <SiteHeader />
      <main className="home">
        <section className="hero">
          <div className="hero-text">
            <h1>{t.home.title}</h1>
            <p className="hero-lead">{t.home.lead}</p>
            <div className="hero-actions">
              <a className="btn-cta" href="#templates">
                {t.home.start}
              </a>
              {lastBook ? (
                <Link className="hero-link" to={`/b/${lastBook}`}>
                  {t.home.continueBook}
                </Link>
              ) : (
                <a className="hero-link" href="#how">
                  {t.home.how}
                </a>
              )}
            </div>
          </div>
          <div className="hero-book">
            {showcase.status === 'ok' ? <Showcase template={showcase.data} /> : <div className="hero-book-space" />}
          </div>
        </section>

        <section id="templates" className="home-section">
          <h2>{t.home.templatesTitle}</h2>
          <p className="section-lead">{t.home.templatesLead}</p>
          {templates.status === 'loading' && <p>{t.loading}</p>}
          {templates.status === 'error' && <ErrorMessage error={templates.error} />}
          {templates.status === 'ok' && (
            <Templates
              list={templates.data}
              occasion={search.get('occasion')}
              // replace: смена фильтра не копится в истории — «назад» уводит со страницы.
              onOccasion={(o) => setSearch(o ? { occasion: o } : {}, { replace: true, preventScrollReset: true })}
            />
          )}
        </section>

        <section id="how" className="home-section">
          <h2>{t.home.stepsTitle}</h2>
          {/* Шаги — настоящая последовательность, поэтому с номерами. */}
          <ol className="steps">
            {t.home.steps.map((s, i) => (
              <li key={s.title}>
                <span className="step-n" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {format && (
          <section className="home-section">
            <h2>{t.home.specTitle}</h2>
            <Spec format={format} />
          </section>
        )}

        <section className="home-section">
          <h2>{t.home.faqTitle}</h2>
          <div className="faq">
            {t.home.faq.map((x) => (
              <details key={x.q}>
                <summary>{x.q}</summary>
                <p>{x.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}

// Книга-витрина: обложка, форзац с надписью от руки и первые развороты
// шаблона с примерами фото и подписей.
function Showcase({ template }: { template: Template }) {
  const leaves = useMemo(() => {
    const [cover] = withDemoPhotos([template.cover], template.occasion)
    const picked = SHOWCASE_PAGES.map((n) => template.pages[n - 1]).filter(Boolean)
    const pages = withDemoCaptions(withDemoPhotos(picked, template.occasion, 1), t.home.demoCaptions)
    const endpaper: Page = {
      id: 'endpaper',
      background: template.pages[0]?.background ?? '#ffffff',
      elements: [
        { type: 'text', id: 'd1', x: 14, y: 36, w: 72, h: 28, text: t.home.dedication, font: 'caveat', size: 22, color: '#3f3f3f', align: 'center', rotation: -4 },
      ],
    }
    const list: Leaf[] = [
      { front: cover, back: endpaper },
      { front: pages[0], back: pages[1] },
      { front: pages[2], back: pages[3] },
      { front: pages[4], back: pages[5] },
    ]
    return { list, last: pages[6] }
  }, [template])

  return (
    <>
      <Flipbook leaves={leaves.list} last={leaves.last} format={template.format} imageSrc={demoImageSrc} />
      <p className="hero-note">{t.home.bookNote(template.name)}</p>
    </>
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
      {/* Фильтр в виде закладок-разделителей, как в папке с образцами. */}
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
      <ul className="shelf">
        {shown.map((tpl) => (
          <li key={tpl.id}>
            <Link className="tpl-card" to={`/templates/${tpl.id}`}>
              <span className="tpl-book">
                <PageView page={withDemoPhotos([tpl.cover], tpl.occasion)[0]} format={tpl.format} imageSrc={demoImageSrc} variant="print" />
              </span>
              <span className="tpl-card-name">{tpl.name}</span>
              <span className="tpl-card-occasion">{t.occasions[tpl.occasion] ?? tpl.occasion}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

// «Что вы получите» — как техкарта заказа в типографии: строки с отточием.
// Цена — только если задана в формате (formats.price_kzt).
function Spec({ format }: { format: Format }) {
  const s = t.home.spec
  const rows: [string, string][] = [
    [s.format, s.formatValue(format.widthMm / 10, format.heightMm / 10)],
    [s.pages, s.pagesValue(format.minPages, format.maxPages)],
    ...(format.priceKzt > 0 ? ([[s.price, formatTenge(format.priceKzt)]] as [string, string][]) : []),
    [s.print, s.printValue],
    [s.delivery, s.deliveryValue],
    [s.payment, s.paymentValue],
  ]
  return (
    <CropMarks className="ticket">
      <dl>
        {rows.map(([k, v]) => (
          <div className="ticket-row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </CropMarks>
  )
}
