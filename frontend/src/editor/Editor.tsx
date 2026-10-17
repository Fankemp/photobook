import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'
import { ApiError, assetImageUrl, toApiError } from '../api.ts'
import { DEFAULT_CROP, MAX_ZOOM, zoomCrop } from '../book/crop.ts'
import { isLowDpi } from '../book/dpi.ts'
import { PageView } from '../book/PageView.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { ShareLink } from '../components/ShareLink.tsx'
import { HomeMark } from '../components/Site.tsx'
import { t } from '../i18n/index.ts'
import type { StickerInfo } from '../book/stickers.ts'
import type { Book, Crop, Format, Page, PhotoSlotElement, TextElement } from '../types.ts'
import { useBookDoc, type SaveStatus } from './autosave.ts'
import {
  addElement,
  allPagesOf,
  bringToFront,
  duplicateText,
  elKey,
  findElement,
  MAX_ELEMENTS_PER_PAGE,
  moveSticker,
  newStickerElement,
  newTextElement,
  removeElement,
  sameEl,
  slotKey,
  updateSlot,
  updateSticker,
  updateText,
  type Doc,
  type ElRef,
  type SlotRef,
} from './doc.ts'
import { SlotOverlay, type UploadState } from './SlotOverlay.tsx'
import { StickerOverlay } from './StickerOverlay.tsx'
import { StickerPanel } from './StickerPanel.tsx'
import { StickerPicker } from './StickerPicker.tsx'
import { TextDialog } from './TextDialog.tsx'
import { TextOverlay } from './TextOverlay.tsx'
import { TextPanel } from './TextPanel.tsx'
import { nearCutLine, type Guides } from './transform.ts'
import { ACCEPT, checkFile, readImageSize, uploadPhoto, type Size } from './upload.ts'
import './Editor.css'

type LocalImage = Size & { url: string }

// Редактор: листаем страницы, тап по пустому слоту — выбор фото,
// тап по фото — выделение, затем двигаем и масштабируем кадр;
// тап по тексту — выделение: тянем, меняем размер и поворачиваем ручками,
// панель шрифта, размера, цвета; повторный тап — окно ввода текста;
// стикеры добавляются из окна выбора, их можно двигать, вращать и менять размер.
// Все правки сохраняются автоматически (см. autosave.ts), их можно отменить.
// initialPage — с какой страницы открыть (0 — обложка, последняя — задняя обложка),
// например по ссылке из превью.
export function Editor({ book, initialPage = 0 }: { book: Book; initialPage?: number }) {
  const { doc, update, undo, redo, canUndo, canRedo, status } = useBookDoc(book)
  const [pageIndex, setPageIndex] = useState(() => Math.max(0, Math.min(book.pages.length + 1, initialPage)))
  const [selected, setSelected] = useState<ElRef | null>(null)
  const [editingText, setEditingText] = useState<ElRef | null>(null) // открыто окно ввода
  const [pickingSticker, setPickingSticker] = useState(false) // открыто окно выбора стикера
  const [guides, setGuides] = useState<Guides | null>(null) // линии привязки, пока тянем текст
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

  const allPages = allPagesOf(doc) // 0 — обложка, 1..N — страницы, N+1 — задняя обложка
  const lastIndex = allPages.length - 1
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
      setPageIndex(Math.max(0, Math.min(doc.pages.length + 1, i)))
      setSelected(null)
    },
    [doc.pages.length],
  )

  // «Отменить» / «Повторить». Правка могла быть на другой странице — тогда
  // переходим на неё, чтобы было видно, что изменилось.
  function showRestored(before: Doc, restored: Doc | undefined) {
    if (!restored) return
    const was = allPagesOf(before)
    const changed = allPagesOf(restored).findIndex((p, i) => p !== was[i])
    if (changed >= 0 && changed !== pageIndex) goTo(changed)
  }
  const onUndo = () => showRestored(doc, undo())
  const onRedo = () => showRestored(doc, redo())

  // Клавиатура на компьютере: стрелки ← → листают страницы, Ctrl+Z — отменить,
  // Ctrl+Shift+Z или Ctrl+Y — повторить (⌘ на Mac). Смотрим e.code — физическую
  // клавишу: в русской раскладке e.key у Z — «я».
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || editingText || pickingSticker) return
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      e.preventDefault()
      if (e.code === 'KeyY' || e.shiftKey) onRedo()
      else onUndo()
      return
    }
    if (e.key === 'ArrowLeft') goTo(pageIndex - 1)
    if (e.key === 'ArrowRight') goTo(pageIndex + 1)
  })
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

  // Подряд идущие сдвиги и масштаб кадра одного фото — один шаг «Отменить».
  const setCrop = (target: SlotRef, crop: Crop) =>
    update((d) => updateSlot(d, target, (el) => ({ ...el, crop })), `crop:${slotKey(target)}`)

  function addText() {
    const el = newTextElement(doc, page)
    const target = { pageId: page.id, elId: el.id }
    update((d) => addElement(d, page.id, el))
    setSelected(target)
    setEditingText(target)
  }

  // Удалить добавленный текст или стикер.
  function removeEl(target: ElRef) {
    update((d) => removeElement(d, target))
    setSelected(null)
  }

  function addSticker(sticker: StickerInfo) {
    setPickingSticker(false)
    const el = newStickerElement(page, sticker, book.format)
    update((d) => addElement(d, page.id, el))
    setSelected({ pageId: page.id, elId: el.id }) // сразу можно подвинуть
  }

  // Копия текста — поверх оригинала, со сдвигом; сразу выбрана.
  function duplicate(el: TextElement) {
    const copy = duplicateText(page, el, book.format)
    update((d) => addElement(d, page.id, copy))
    setSelected({ pageId: page.id, elId: copy.id })
  }

  // На полной странице новые элементы сервер не сохранит.
  const pageFull = page.elements.length >= MAX_ELEMENTS_PER_PAGE

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
      // На телефоне панель прибита к низу экрана и закрывает его часть; на широком
      // экране она колонкой справа и ничего не закрывает.
      const barAtBottom = getComputedStyle(bar).position === 'fixed'
      const visibleBottom = window.innerHeight - (barAtBottom ? bar.offsetHeight : 0) - 12
      if (r.bottom > visibleBottom) window.scrollBy({ top: r.bottom - visibleBottom, behavior: 'smooth' })
      else if (r.top < 8) window.scrollBy({ top: r.top - 8, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedId])

  // Выбранный элемент на текущей странице — для него показываем панель внизу.
  const active = selected && selected.pageId === page.id ? selected : null
  const activeEl = active ? findElement(doc, active) : undefined
  const editingEl = editingText ? findElement(doc, editingText) : undefined
  const pageLabel =
    pageIndex === 0 ? t.book.cover : pageIndex === lastIndex ? t.book.backCover : t.editor.pageOf(pageIndex, doc.pages.length)

  return (
    <div className="editor" ref={rootRef}>
      <header className="ed-header">
        <HomeMark label={t.editor.back} />
        <div className="ed-title">
          <h1>{t.editor.title}</h1>
          <SaveIndicator status={status} />
        </div>
        <div className="ed-history">
          <button className="btn ed-icon-btn" onClick={onUndo} disabled={!canUndo} aria-label={t.editor.undo} title={t.editor.undo}>
            <UndoIcon />
          </button>
          <button className="btn ed-icon-btn" onClick={onRedo} disabled={!canRedo} aria-label={t.editor.redo} title={t.editor.redo}>
            <UndoIcon redo />
          </button>
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
            if (el.type === 'sticker') {
              return (
                <StickerOverlay
                  key={el.id}
                  el={el}
                  selected={sameEl(selected, ref)}
                  onTap={() => setSelected(ref)}
                  onMove={(x, y) => update((d) => updateSticker(d, ref, (s) => moveSticker(s, x, y)), `sticker-move:${elKey(ref)}`)}
                />
              )
            }
            if (el.type === 'text') {
              return (
                <TextOverlay
                  key={el.id}
                  el={el}
                  format={book.format}
                  selected={sameEl(selected, ref)}
                  overflow={!!overflow[elKey(ref)]}
                  nearCut={nearCutLine(el, book.format)}
                  onSelect={() => setSelected(ref)}
                  onEdit={() => setEditingText(ref)}
                  onPlace={(p, gesture) => update((d) => updateText(d, ref, (e) => ({ ...e, ...p })), `gesture:${gesture}`)}
                  onGuides={setGuides}
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
          {/* Линии привязки к центру и краям страницы, пока тянем текст. */}
          {guides?.x != null && <div className="ed-guide ed-guide-v" style={{ left: `${(guides.x / book.format.widthMm) * 100}%` }} />}
          {guides?.y != null && <div className="ed-guide ed-guide-h" style={{ top: `${(guides.y / book.format.heightMm) * 100}%` }} />}
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
          disabled={pageIndex === lastIndex}
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
              overflow={!!overflow[elKey(active)]}
              nearCut={nearCutLine(activeEl, book.format)}
              onTop={page.elements.at(-1)?.id === activeEl.id}
              canCopy={!pageFull}
              onChange={(fn, tag) => update((d) => updateText(d, active, fn), tag && `${tag}:${elKey(active)}`)}
              onEdit={() => setEditingText(active)}
              onDuplicate={() => duplicate(activeEl)}
              onFront={() => update((d) => bringToFront(d, active))}
              onRemove={() => removeEl(active)}
              onDone={() => setSelected(null)}
            />
          ) : active && activeEl?.type === 'sticker' ? (
            <StickerPanel
              el={activeEl}
              format={book.format}
              onChange={(fn, tag) => update((d) => updateSticker(d, active, fn), tag && `${tag}:${elKey(active)}`)}
              onRemove={() => removeEl(active)}
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
              <div className="ed-toolbar-row">
                <button className="btn" onClick={addText} disabled={pageFull}>
                  {t.editor.addText}
                </button>
                <button className="btn" onClick={() => setPickingSticker(true)} disabled={pageFull}>
                  {t.editor.addSticker}
                </button>
              </div>
              {pageFull && <p className="muted ed-hint">{t.editor.pageFull}</p>}
            </div>
          )}
        </div>
      </div>

      <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={onFileChosen} />

      {pickingSticker && <StickerPicker onPick={addSticker} onClose={() => setPickingSticker(false)} />}

      {editingText && editingEl?.type === 'text' && (
        <TextDialog
          el={editingEl}
          page={allPages.find((p) => p.id === editingText.pageId) ?? page}
          format={book.format}
          imageSrc={imageSrc}
          onChange={(text) => update((d) => updateText(d, editingText, (e) => ({ ...e, text })), `text:${elKey(editingText)}`)}
          onClose={() => setEditingText(null)}
        />
      )}
    </div>
  )
}

// Изогнутая стрелка «отменить»; redo — она же, отражённая.
function UndoIcon({ redo = false }: { redo?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={redo ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
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
  // scrollIntoView прокрутил бы ещё и всю страницу. Лента горизонтальная
  // на телефоне и вертикальная колонка на широком экране.
  useEffect(() => {
    const list = listRef.current
    const item = list?.children[current] as HTMLElement | undefined
    if (!list || !item) return
    if (list.scrollHeight > list.clientHeight + 1) {
      list.scrollTo({ top: item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2, behavior: 'smooth' })
    } else {
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
            aria-label={pageName(i, pages.length) + (warnings[i] ? `. ${t.editor.lowDpiShort}` : '')}
            onClick={() => onSelect(i)}
          >
            <PageView page={p} format={format} imageSrc={imageSrc} lazy />
            <span>
              {warnings[i] && <span className="ed-strip-warn" aria-hidden="true" />}
              {i === 0 ? t.editor.coverShort : i === pages.length - 1 ? t.editor.backShort : i}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

// Название страницы по номеру в ленте (всего — count, с обеими обложками).
function pageName(i: number, count: number) {
  return i === 0 ? t.book.cover : i === count - 1 ? t.book.backCover : t.book.page(i)
}

function without<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...obj }
  delete copy[key]
  return copy
}
