import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'
import { ApiError, assetImageUrl, toApiError } from '../api.ts'
import { DEFAULT_CROP, MAX_ZOOM, zoomCrop } from '../book/crop.ts'
import { isLowDpi } from '../book/dpi.ts'
import { PageView } from '../book/PageView.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { ShareLink } from '../components/ShareLink.tsx'
import { t } from '../i18n/index.ts'
import type { Book, Crop, Format, Page, PhotoSlotElement, TextElement } from '../types.ts'
import { useBookDoc, type SaveStatus } from './autosave.ts'
import {
  addElement,
  elKey,
  findElement,
  newTextElement,
  removeElement,
  sameEl,
  slotKey,
  updateSlot,
  updateText,
  USER_TEXT_PREFIX,
  type ElRef,
  type SlotRef,
} from './doc.ts'
import { SlotOverlay, type UploadState } from './SlotOverlay.tsx'
import { TextDialog } from './TextDialog.tsx'
import { TextOverlay } from './TextOverlay.tsx'
import { TextPanel } from './TextPanel.tsx'
import { ACCEPT, checkFile, readImageSize, uploadPhoto, type Size } from './upload.ts'
import './Editor.css'

type LocalImage = Size & { url: string }

// Редактор: листаем страницы, тап по пустому слоту — выбор фото,
// тап по фото — выделение, затем двигаем и масштабируем кадр;
// тап по тексту — панель шрифта, размера, цвета и окно ввода текста.
// Все правки сохраняются автоматически (см. autosave.ts).
// initialPage — с какой страницы открыть (0 — обложка), например по ссылке из превью.
export function Editor({ book, initialPage = 0 }: { book: Book; initialPage?: number }) {
  const { doc, update, status } = useBookDoc(book)
  const [pageIndex, setPageIndex] = useState(() => Math.max(0, Math.min(book.pages.length, initialPage)))
  const [selected, setSelected] = useState<ElRef | null>(null)
  const [editingText, setEditingText] = useState<ElRef | null>(null) // открыто окно ввода
  const [overflow, setOverflow] = useState<Record<string, boolean>>({}) // текст не влезает
  const [uploads, setUploads] = useState<Record<string, UploadState>>({})
  const [localImages, setLocalImages] = useState<Record<string, LocalImage>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pickTarget = useRef<SlotRef | null>(null)
  const objectUrls = useRef<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  // Нижняя панель фиксированная, а её высота меняется (подсказка, кнопки,
  // предупреждение). Даём редактору снизу отступ ровно по её высоте,
  // чтобы она не закрывала ленту страниц.
  useEffect(() => {
    const bar = toolbarRef.current
    const root = rootRef.current
    if (!bar || !root) return
    const ro = new ResizeObserver(() => root.style.setProperty('--toolbar-h', `${bar.offsetHeight}px`))
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  const allPages = [doc.cover, ...doc.pages]
  const page = allPages[pageIndex]

  // PageView сообщает, влез ли текст в блок; храним для предупреждений.
  const onTextFit = (elId: string, fits: boolean) => {
    const key = elKey({ pageId: page.id, elId })
    setOverflow((o) => (o[key] === !fits ? o : { ...o, [key]: !fits }))
  }

  // Только что загруженные фото показываем прямо из памяти устройства
  // (мгновенно, без скачивания обратно), остальные — с сервера.
  const imageSrc = useCallback(
    (id: string) => localImages[id]?.url ?? assetImageUrl(book.token, id),
    [localImages, book.token],
  )
  const serverSizes = useMemo(() => new Map(book.assets.map((a) => [a.id, a])), [book.assets])
  const sizeOf = (id: string): Size | undefined => localImages[id] ?? serverSizes.get(id)

  // Хватит ли пикселей фото для печати этого слота при текущем увеличении.
  const lowDpi = (el: PhotoSlotElement) => {
    const size = el.assetId ? sizeOf(el.assetId) : undefined
    return !!size && isLowDpi(el, book.format, size)
  }
  const pageHasLowDpi = (p: Page) => p.elements.some((el) => el.type === 'photo_slot' && lowDpi(el))

  // Освобождаем память под локальные превью, когда редактор закрывается.
  useEffect(() => {
    const urls = objectUrls.current
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  const goTo = useCallback(
    (i: number) => {
      setPageIndex(Math.max(0, Math.min(doc.pages.length, i)))
      setSelected(null)
    },
    [doc.pages.length],
  )

  // Стрелки ← → на клавиатуре листают страницы (удобно на компьютере).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || editingText) return
      if (e.key === 'ArrowLeft') goTo(pageIndex - 1)
      if (e.key === 'ArrowRight') goTo(pageIndex + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, pageIndex, editingText])

  function pickPhoto(target: SlotRef) {
    pickTarget.current = target
    fileInput.current?.click() // открыть галерею/файлы; должно быть прямо в обработчике тапа
  }

  function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // чтобы тот же файл можно было выбрать ещё раз
    if (file && pickTarget.current) void addPhoto(pickTarget.current, file)
  }

  async function addPhoto(target: SlotRef, file: File) {
    setError(null)
    const bad = checkFile(file)
    if (bad) {
      setError(new ApiError(bad, 0))
      return
    }
    const key = slotKey(target)
    const previewUrl = URL.createObjectURL(file)
    try {
      const size = await readImageSize(previewUrl)
      // Превью показываем сразу, пока файл ещё грузится.
      setUploads((u) => ({ ...u, [key]: { previewUrl, progress: 0 } }))
      const assetId = await uploadPhoto(book.token, file, size, (progress) =>
        setUploads((u) => (u[key] ? { ...u, [key]: { previewUrl, progress } } : u)),
      )
      objectUrls.current.push(previewUrl)
      setLocalImages((m) => ({ ...m, [assetId]: { url: previewUrl, ...size } }))
      update((d) => updateSlot(d, target, (el) => ({ ...el, assetId, crop: DEFAULT_CROP })))
      setSelected(target) // сразу можно подвинуть кадр
    } catch (err) {
      URL.revokeObjectURL(previewUrl)
      setError(toApiError(err))
    } finally {
      setUploads((u) => without(u, key))
    }
  }

  function onTapSlot(el: PhotoSlotElement) {
    const target = { pageId: page.id, elId: el.id }
    if (uploads[slotKey(target)]) return
    if (el.assetId) {
      setSelected(target)
    } else {
      setSelected(null)
      pickPhoto(target)
    }
  }

  const setCrop = (target: SlotRef, crop: Crop) => update((d) => updateSlot(d, target, (el) => ({ ...el, crop })))

  // Тап по тексту: выбрать; пустой — сразу открыть ввод.
  function onTapText(el: TextElement) {
    const target = { pageId: page.id, elId: el.id }
    setSelected(target)
    if (el.text.trim() === '') setEditingText(target)
  }

  function addText() {
    const el = newTextElement(doc, page)
    const target = { pageId: page.id, elId: el.id }
    update((d) => addElement(d, page.id, el))
    setSelected(target)
    setEditingText(target)
  }

  function removeText(target: ElRef) {
    update((d) => removeElement(d, target))
    setSelected(null)
  }

  function removePhoto(target: SlotRef) {
    update((d) => updateSlot(d, target, (el) => ({ ...el, assetId: null, crop: DEFAULT_CROP })))
    setSelected(null)
  }

  // Выбранный элемент не должен прятаться под панелью внизу экрана (на телефоне
  // она занимает пол-экрана, а подписи часто внизу страницы). После того как
  // панель отрисовалась, докручиваем страницу, чтобы элемент был над ней.
  const selectedId = selected?.elId
  useEffect(() => {
    if (!selectedId) return
    const frame = requestAnimationFrame(() => {
      const node = rootRef.current?.querySelector(`[data-el-id="${selectedId}"]`)
      const bar = toolbarRef.current
      if (!node || !bar) return
      const r = node.getBoundingClientRect()
      const visibleBottom = window.innerHeight - bar.offsetHeight - 12
      if (r.bottom > visibleBottom) window.scrollBy({ top: r.bottom - visibleBottom, behavior: 'smooth' })
      else if (r.top < 8) window.scrollBy({ top: r.top - 8, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedId])

  // Выбранный элемент на текущей странице — для него показываем панель внизу.
  const active = selected && selected.pageId === page.id ? selected : null
  const activeEl = active ? findElement(doc, active) : undefined
  const editingEl = editingText ? findElement(doc, editingText) : undefined
  const pageLabel = pageIndex === 0 ? t.book.cover : t.editor.pageOf(pageIndex, doc.pages.length)

  return (
    <div className="editor" ref={rootRef}>
      <header className="ed-header">
        <Link to="/" className="ed-back" aria-label={t.editor.back}>
          ←
        </Link>
        <div className="ed-title">
          <h1>{t.book.title}</h1>
          <SaveIndicator status={status} />
        </div>
        {/* Уход в превью — обычный переход: редактор при закрытии дохраняет правки. */}
        <Link to={`/b/${book.token}/preview`} className="btn ed-preview-link">
          {t.editor.preview}
        </Link>
      </header>

      {status === 'conflict' && (
        <div className="ed-banner">
          <p>{t.editor.conflict}</p>
          <button className="btn" onClick={() => window.location.reload()}>
            {t.editor.reload}
          </button>
        </div>
      )}
      {status === 'locked' && (
        <div className="ed-banner">
          <p>{t.editor.locked}</p>
          <Link className="btn" to={`/b/${book.token}/order`}>
            {t.editor.toOrder}
          </Link>
        </div>
      )}
      {status === 'error' && (
        <div className="ed-banner">
          <p>{t.editor.saveError}</p>
          <button className="btn" onClick={() => window.location.reload()}>
            {t.editor.reload}
          </button>
        </div>
      )}

      {/* Тап по пустому месту вокруг слотов снимает выделение. */}
      <div className="ed-stage" onClick={() => setSelected(null)}>
        <div className="ed-page">
          <PageView page={page} format={book.format} imageSrc={imageSrc} onTextFit={onTextFit} />
          {page.elements.map((el) => {
            const ref = { pageId: page.id, elId: el.id }
            if (el.type === 'text') {
              return (
                <TextOverlay
                  key={el.id}
                  el={el}
                  selected={sameEl(selected, ref)}
                  overflow={!!overflow[elKey(ref)]}
                  onTap={() => onTapText(el)}
                />
              )
            }
            if (el.type !== 'photo_slot') return null
            return (
              <SlotOverlay
                key={el.id}
                el={el}
                selected={sameEl(selected, ref)}
                imageSize={el.assetId ? sizeOf(el.assetId) : undefined}
                upload={uploads[slotKey(ref)]}
                lowDpi={lowDpi(el)}
                label={el.assetId ? t.editor.slotFilled : t.editor.slotEmpty}
                onTap={() => onTapSlot(el)}
                onCrop={(crop) => setCrop(ref, crop)}
              />
            )
          })}
        </div>
      </div>

      <nav className="ed-pager">
        <button className="btn" onClick={() => goTo(pageIndex - 1)} disabled={pageIndex === 0} aria-label={t.editor.prevPage}>
          ‹
        </button>
        <span>{pageLabel}</span>
        <button
          className="btn"
          onClick={() => goTo(pageIndex + 1)}
          disabled={pageIndex === doc.pages.length}
          aria-label={t.editor.nextPage}
        >
          ›
        </button>
      </nav>

      <PageStrip
        pages={allPages}
        current={pageIndex}
        format={book.format}
        imageSrc={imageSrc}
        warnings={allPages.map(pageHasLowDpi)}
        onSelect={goTo}
      />

      {/* Чистая ссылка на книгу, без ?page= и прочего из адресной строки. */}
      <ShareLink url={`${window.location.origin}/b/${book.token}`} />

      {/* Панель внизу экрана: подсказка или управление выбранным фото. */}
      <div className="ed-toolbar" ref={toolbarRef}>
        <div className="ed-toolbar-inner">
          {error && <ErrorMessage error={error} />}
          {active && activeEl?.type === 'text' ? (
            <TextPanel
              el={activeEl}
              movable={activeEl.id.startsWith(USER_TEXT_PREFIX)}
              overflow={!!overflow[elKey(active)]}
              onChange={(fn) => update((d) => updateText(d, active, fn))}
              onEdit={() => setEditingText(active)}
              onRemove={() => removeText(active)}
              onDone={() => setSelected(null)}
            />
          ) : active && activeEl?.type === 'photo_slot' && activeEl.assetId ? (
            <>
              {lowDpi(activeEl) && <p className="ed-dpi-warning">{t.editor.lowDpi}</p>}
              <label className="ed-zoom">
                <span>{t.editor.zoom}</span>
                <input
                  type="range"
                  min={1}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={activeEl.crop?.zoom ?? 1}
                  onChange={(e) => setCrop(active, zoomCrop(activeEl.crop ?? DEFAULT_CROP, Number(e.target.value)))}
                />
              </label>
              <div className="ed-toolbar-row">
                <button className="btn" onClick={() => pickPhoto(active)}>
                  {t.editor.replace}
                </button>
                <button className="btn" onClick={() => removePhoto(active)}>
                  {t.editor.remove}
                </button>
                <button className="btn btn-accent" onClick={() => setSelected(null)}>
                  {t.editor.done}
                </button>
              </div>
              <p className="muted ed-hint">{t.editor.adjustHint}</p>
            </>
          ) : (
            <div className="ed-idle">
              <p className="muted ed-hint">{t.editor.hint}</p>
              <button className="btn" onClick={addText}>
                {t.editor.addText}
              </button>
            </div>
          )}
        </div>
      </div>

      <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={onFileChosen} />

      {editingText && editingEl?.type === 'text' && (
        <TextDialog
          el={editingEl}
          page={allPages.find((p) => p.id === editingText.pageId) ?? page}
          format={book.format}
          imageSrc={imageSrc}
          onChange={(text) => update((d) => updateText(d, editingText, (e) => ({ ...e, text })))}
          onClose={() => setEditingText(null)}
        />
      )}
    </div>
  )
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text: Record<SaveStatus, string> = {
    saved: t.editor.status.saved,
    pending: t.editor.status.saving,
    saving: t.editor.status.saving,
    offline: t.editor.status.offline,
    conflict: t.editor.status.error,
    locked: t.editor.status.error,
    error: t.editor.status.error,
  }
  return (
    <span className={`ed-status is-${status}`} role="status">
      {text[status]}
    </span>
  )
}

type StripProps = {
  pages: Page[]
  current: number
  format: Format
  imageSrc: (id: string) => string
  warnings: boolean[] // на странице есть фото с низким разрешением
  onSelect: (i: number) => void
}

// Лента миниатюр всех страниц для быстрого перехода.
function PageStrip({ pages, current, format, imageSrc, warnings, onSelect }: StripProps) {
  const listRef = useRef<HTMLOListElement>(null)

  // Текущая миниатюра — по центру ленты. Крутим только саму ленту:
  // scrollIntoView прокрутил бы ещё и всю страницу.
  useEffect(() => {
    const list = listRef.current
    const item = list?.children[current] as HTMLElement | undefined
    if (list && item) {
      list.scrollTo({ left: item.offsetLeft - list.clientWidth / 2 + item.clientWidth / 2, behavior: 'smooth' })
    }
  }, [current])

  return (
    <ol className="ed-strip" ref={listRef}>
      {pages.map((p, i) => (
        <li key={p.id}>
          <button
            className={i === current ? 'is-current' : undefined}
            aria-current={i === current ? 'page' : undefined}
            aria-label={(i === 0 ? t.book.cover : t.book.page(i)) + (warnings[i] ? `. ${t.editor.lowDpiShort}` : '')}
            onClick={() => onSelect(i)}
          >
            <PageView page={p} format={format} imageSrc={imageSrc} lazy />
            <span>
              {warnings[i] && <span className="ed-strip-warn" aria-hidden="true" />}
              {i === 0 ? t.editor.coverShort : i}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

function without<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...obj }
  delete copy[key]
  return copy
}
