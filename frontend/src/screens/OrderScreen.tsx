import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError, assetImageUrl, createOrder, getBook, getOrderInfo, saveBook, toApiError } from '../api.ts'
import { PageView } from '../book/PageView.tsx'
import { findIssues, hasIssues } from '../book/spreads.ts'
import { BookIssues } from '../components/BookIssues.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { ShareLink } from '../components/ShareLink.tsx'
import { clearDraft, restoreDoc } from '../editor/draft.ts'
import { t } from '../i18n/index.ts'
import { bookPrice, formatTenge } from '../lib/money.ts'
import { formatPhone, normalizePhone } from '../lib/phone.ts'
import { useLoad } from '../lib/useLoad.ts'
import type { Book, Order, OrderInfo } from '../types.ts'
import './OrderScreen.css'

// Заявка /b/<токен>/order: форма, а после отправки — статус заявки.
export function OrderScreen() {
  const { token = '' } = useParams()
  const data = useLoad(token, async (signal) => {
    const [book, info] = await Promise.all([getBook(token, signal), getOrderInfo(token, signal)])
    return { book, info }
  })

  if (data.status === 'ok') return <OrderPage key={token} book={data.data.book} info={data.data.info} />
  return (
    <main className="page">
      {data.status === 'loading' && <p>{t.loading}</p>}
      {data.status === 'error' && (
        <>
          <ErrorMessage error={data.error} />
          <Link to="/">{t.book.toCatalog}</Link>
        </>
      )}
    </main>
  )
}

function OrderPage({ book, info }: { book: Book; info: OrderInfo }) {
  const [order, setOrder] = useState<Order | null>(info.order)
  // Заказываем ровно то, что клиент видел в редакторе: книга с этого устройства
  // (с несохранённым черновиком, если он есть — форма сначала его сохранит).
  const [restored] = useState(() => restoreDoc(book))
  return (
    <main className="page order">
      <header className="pp-header">
        <Link to={`/b/${book.token}/preview`} className="ed-back" aria-label={t.order.backToPreview}>
          ←
        </Link>
        <h1>{order ? t.order.placedTitle(order.number) : t.order.title}</h1>
      </header>
      <BookSummary book={book} pageCount={restored.doc.pages.length} />
      {order ? (
        <OrderStatus order={order} token={book.token} />
      ) : (
        <OrderForm book={book} info={info} restored={restored} onCreated={setOrder} />
      )}
    </main>
  )
}

// Что заказываем: обложка книги (тот же PageView) и формат.
// Страниц — по книге на этом устройстве (с черновиком): клиент мог только что удалить или добавить.
function BookSummary({ book, pageCount }: { book: Book; pageCount: number }) {
  return (
    <div className="order-book">
      <span className="order-book-cover">
        <PageView page={book.cover} format={book.format} imageSrc={(id) => assetImageUrl(book.token, id)} variant="print" />
      </span>
      <div>
        <p className="order-book-title">{t.book.title}</p>
        <p className="muted">{t.formatInfo(book.format.name, pageCount)}</p>
      </div>
    </div>
  )
}

type Fields = { name: string; phone: string; address: string; wantedDate: string; comment: string }
type FieldErrors = Partial<Record<keyof Fields, string>>

// Ошибка сервера по коду → какое поле подсветить.
const FIELD_BY_CODE: Record<string, keyof Fields> = {
  invalid_name: 'name',
  invalid_phone: 'phone',
  invalid_address: 'address',
  invalid_date: 'wantedDate',
  invalid_comment: 'comment',
}

type Sync = { status: 'saving' } | { status: 'ready'; version: number } | { status: 'error'; error: ApiError }

type FormProps = { book: Book; info: OrderInfo; restored: ReturnType<typeof restoreDoc>; onCreated: (o: Order) => void }

function OrderForm({ book, info, restored, onCreated }: FormProps) {
  // Заказываем ровно то, что клиент видел в редакторе: если на этом устройстве
  // остались несохранённые правки (черновик), сначала сохраняем их.
  const [sync, setSync] = useState<Sync>(() =>
    restored.fromDraft ? { status: 'saving' } : { status: 'ready', version: book.version },
  )
  const started = useRef(false) // в dev React запускает эффекты дважды — сохраняем один раз
  useEffect(() => {
    if (!restored.fromDraft || started.current) return
    started.current = true
    saveBook(book.token, { version: book.version, ...restored.doc }).then(
      (res) => {
        clearDraft(book.token)
        setSync({ status: 'ready', version: res.version })
      },
      (err) => setSync({ status: 'error', error: toApiError(err) }),
    )
  }, [book, restored])

  const pageCount = restored.doc.pages.length
  const price = bookPrice(book.format, pageCount)
  const sizes = useMemo(() => new Map(book.assets.map((a) => [a.id, a])), [book.assets])
  const issues = useMemo(
    () => findIssues(restored.doc, book.format, sizes),
    [restored, book.format, sizes],
  )

  const [fields, setFields] = useState<Fields>({ name: '', phone: '', address: '', wantedDate: '', comment: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<ApiError | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Правка поля сразу убирает его подсказку об ошибке: проверим заново при отправке.
  const set = (k: keyof Fields) => (e: { target: { value: string } }) => {
    setFields((f) => ({ ...f, [k]: e.target.value }))
    setErrors((errs) => (errs[k] ? { ...errs, [k]: undefined } : errs))
  }

  // Те же правила, что на сервере, — чтобы подсказать сразу, без запроса.
  function validate(): FieldErrors {
    const errs: FieldErrors = {}
    if (!fields.name.trim()) errs.name = t.order.errors.invalid_name
    if (!normalizePhone(fields.phone)) errs.phone = t.order.errors.invalid_phone
    if (fields.address.trim().length < 5) errs.address = t.order.errors.invalid_address
    if (!fields.wantedDate || fields.wantedDate < info.minWantedDate) errs.wantedDate = t.order.errors.invalid_date
    return errs
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const errs = validate()
    setErrors(errs)
    const firstInvalid = Object.keys(errs)[0] // поля проверяются сверху вниз
    if (firstInvalid) {
      // Фокус на первое поле с ошибкой: на телефоне иначе её можно не увидеть.
      // Ищем по id, а не по aria-invalid: React ещё не успел перерисовать форму.
      formRef.current?.querySelector<HTMLElement>(`#${firstInvalid}`)?.focus()
      return
    }
    if (sync.status !== 'ready') return
    setSubmitting(true)
    try {
      const order = await createOrder(book.token, {
        ...fields,
        phone: normalizePhone(fields.phone) ?? fields.phone,
        version: sync.version,
      })
      onCreated(order)
      window.scrollTo({ top: 0 })
    } catch (err) {
      const apiErr = toApiError(err)
      const field = FIELD_BY_CODE[apiErr.code]
      if (field) setErrors({ [field]: t.order.errors[apiErr.code as keyof typeof t.order.errors] })
      else setFormError(apiErr)
      setSubmitting(false)
    }
  }

  const mustConfirm = hasIssues(issues)

  return (
    <form ref={formRef} className="order-form" onSubmit={submit} noValidate>
      <BookIssues issues={issues} token={book.token} pageCount={restored.doc.pages.length} />
      {mustConfirm && (
        <label className="order-confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          {t.order.confirmIssues}
        </label>
      )}

      <Field id="name" label={t.order.name} error={errors.name}>
        <input id="name" autoComplete="name" value={fields.name} onChange={set('name')} {...invalid(errors.name, 'name')} />
      </Field>
      <Field id="phone" label={t.order.phone} error={errors.phone}>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+7 700 123 45 67"
          value={fields.phone}
          onChange={set('phone')}
          {...invalid(errors.phone, 'phone')}
        />
      </Field>
      <Field id="address" label={t.order.address} hint={t.order.addressHint} error={errors.address}>
        <textarea
          id="address"
          rows={2}
          autoComplete="street-address"
          placeholder={t.order.addressPlaceholder}
          value={fields.address}
          onChange={set('address')}
          {...invalid(errors.address, 'address')}
        />
      </Field>
      <Field id="wantedDate" label={t.order.wantedDate} hint={t.order.wantedDateHint(formatDate(info.minWantedDate))} error={errors.wantedDate}>
        <input
          id="wantedDate"
          type="date"
          min={info.minWantedDate}
          value={fields.wantedDate}
          onChange={set('wantedDate')}
          {...invalid(errors.wantedDate, 'wantedDate')}
        />
      </Field>
      <Field id="comment" label={t.order.comment} error={errors.comment}>
        <textarea
          id="comment"
          rows={3}
          maxLength={1000}
          placeholder={t.order.commentPlaceholder}
          value={fields.comment}
          onChange={set('comment')}
          {...invalid(errors.comment, 'comment')}
        />
      </Field>

      {/* Цена — по числу страниц книги (формат: цена + доплата за страницу); 0 — ещё не задана. */}
      <p className="order-price">{price > 0 ? t.order.price(formatTenge(price), pageCount) : t.order.priceLater}</p>

      {sync.status === 'error' && <ErrorMessage error={sync.error} />}
      {formError && <ErrorMessage error={formError} />}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={submitting || sync.status !== 'ready' || (mustConfirm && !confirmed)}
      >
        {sync.status === 'saving' ? t.order.syncing : submitting ? t.order.sending : t.order.submit}
      </button>
      <p className="muted order-note">{t.order.lockNote}</p>
    </form>
  )
}

// Поле формы: подпись, подсказка, ошибка. Ошибка связана с полем через
// aria-describedby — экранный диктор прочитает её вместе с полем.
function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className={error ? 'order-field has-error' : 'order-field'}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <p className="muted order-hint">{hint}</p>}
      {error && (
        <p className="error order-hint" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  )
}

function invalid(error: string | undefined, id: string) {
  return error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {}
}

function OrderStatus({ order, token }: { order: Order; token: string }) {
  const rows: [string, string][] = [
    [t.order.name, order.name],
    [t.order.phone, formatPhone(order.phone)],
    [t.order.address, order.address],
    [t.order.wantedDate, formatDate(order.wantedDate)],
  ]
  if (order.comment) rows.push([t.order.commentShort, order.comment])

  return (
    <div className="order-status">
      <section className="card order-status-card">
        <p className="order-status-name">{t.order.statusNames[order.status]}</p>
        <p>{t.order.statusHints[order.status](formatPhone(order.phone))}</p>
      </section>
      <dl className="order-details">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">{t.order.lockedNote}</p>
      <p>
        <Link to={`/b/${token}/preview`} className="btn order-view">
          {t.order.viewBook}
        </Link>
      </p>
      <ShareLink url={`${window.location.origin}/b/${token}`} />
    </div>
  )
}

// «20 октября 2026 г.» из «2026-10-20». Дату собираем по частям, без часовых поясов.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d))
}
