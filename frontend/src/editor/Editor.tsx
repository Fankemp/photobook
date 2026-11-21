import { Fragment, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'
import { ApiError, assetImageUrl, listAssets, removeAsset, toApiError } from '../api.ts'
import { DEFAULT_CROP, MAX_ZOOM, zoomCrop } from '../book/crop.ts'
import { isLowDpi } from '../book/dpi.ts'
import { PAGE_LINKS, PAGE_NAMES, PAGE_SHORT, pageLabel, pageOfWords } from '../book/pageLabel.ts'
import { PageView } from '../book/PageView.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { ShareLink } from '../components/ShareLink.tsx'
import { HomeMark } from '../components/Site.tsx'
import { t } from '../i18n/index.ts'
import type { StickerInfo } from '../book/stickers.ts'
import type { AssetInfo, Book, Crop, Format, Page, PhotoSlotElement, TextElement } from '../types.ts'
import { useBookDoc, type SaveStatus } from './autosave.ts'
import {
  addElement,
  allPagesOf,
  bringToFront,
  duplicateText,
  elKey,
  findElement,
  findSlot,
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
import { PhotoTray, type TrayMode } from './PhotoTray.tsx'
import { SlotOverlay } from './SlotOverlay.tsx'
import { StickerOverlay } from './StickerOverlay.tsx'
import { StickerPanel } from './StickerPanel.tsx'
import { StickerPicker } from './StickerPicker.tsx'
import { TextDialog } from './TextDialog.tsx'
import { TextOverlay } from './TextOverlay.tsx'
import { TextPanel } from './TextPanel.tsx'
import { nearCutLine, type Guides } from './transform.ts'
import { canAdd, canRemove, hasContent, insertLeaf, leafOf, removeLeaf, restoreLeaf, type Removed } from './pages.ts'
import { ConfirmDialog, PagesBar, Toast } from './PagesBar.tsx'
import { autoLayout, emptySlotsOf, freeAssets, pagesUsing, placePhotos, restorePlacements, trayPhotos, unplace, usageCounts, type Placement } from './tray.ts'
import { ACCEPT, LIMITS, checkFile, fileHash, isHeif, localPreview, uploadPhoto, type Size } from './upload.ts'
import { UploadQueue, type QueueItem } from './uploadQueue.ts'
import './Editor.css'

type LocalImage = Size & { url: string }

// Прозрачная картинка 1×1 — пока у HEIC готовится миниатюра (в рамке виден фон).
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

// Рамка «пол-страницы» без вылета: по ней лоток предупреждает о маленьком фото,
// которое ещё не стоит в книге (совсем маленькое будет нечётким почти в любой рамке).
const HALF_SLOT: PhotoSlotElement = { type: 'photo_slot', id: '', x: 25, y: 25, w: 50, h: 50 }

// Редактор: листаем страницы, тап по пустому слоту — лоток «Мои фото» (фото
// книги загружаются туда пачкой и раскладываются по рамкам, см. PhotoTray),
// тап по фото — выделение, затем двигаем и масштабируем кадр;
// тап по тексту — выделение: тянем, меняем размер и поворачиваем ручками,
// панель шрифта, размера, цвета; повторный тап — окно ввода текста;
// стикеры добавляются из окна выбора, их можно двигать, вращать и менять размер.
// Страницы блока можно удалять и добавлять листами (см. pages.ts).
// Все правки сохраняются автоматически (см. autosave.ts), их можно отменить.
// initialPage — с какой страницы открыть (0 — обложка, последняя — задняя обложка),
// например по ссылке из превью.
export function Editor({ book, initialPage = 0 }: { book: Book; initialPage?: number }) {
  const { doc, update, undo, redo, canUndo, canRedo, status } = useBookDoc(book)
  const [rawPageIndex, setPageIndex] = useState(() => Math.max(0, Math.min(book.pages.length + 1, initialPage)))
  const [selected, setSelected] = useState<ElRef | null>(null)
  const [editingText, setEditingText] = useState<ElRef | null>(null) // открыто окно ввода
  const [pickingSticker, setPickingSticker] = useState(false) // открыто окно выбора стикера
  const [guides, setGuides] = useState<Guides | null>(null) // линии привязки, пока тянем текст
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null) // спрашиваем про удаление листа этой страницы
  const [toast, setToast] = useState<{ id: number; text: string; removed?: Removed } | null>(null)
  const [overflow, setOverflow] = useState<Record<string, boolean>>({}) // текст не влезает
  const [localImages, setLocalImages] = useState<Record<string, LocalImage>>({})
  const [error, setError] = useState<ApiError | null>(null)
  // Лоток «Мои фото»: фото книги (в порядке загрузки), шторка на телефоне,
  // режим выбора фото для рамок, очередь загрузки и сообщения о ней.
  const [assets, setAssets] = useState<AssetInfo[]>(book.assets)
  const [trayOpen, setTrayOpen] = useState(false)
  const [trayMode, setTrayMode] = useState<TrayMode>({ kind: 'browse' })
  const [queueItems, setQueueItems] = useState<QueueItem[]>([])
  const [notices, setNotices] = useState<string[]>([])
  const [repeated, setRepeated] = useState(0) // пропущено как повтор при добавлении
  const [fresh, setFresh] = useState<string[]>([]) // загружены в режиме выбора — отметить
  const [trayToast, setTrayToast] = useState<{ id: number; text: string; onUndo?: () => void } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string[] | null>(null) // спрашиваем про удаление фото
  const fileInput = useRef<HTMLInputElement>(null)
  const objectUrls = useRef<string[]>([])
  const pickingRef = useRef(false) // для загрузчика: открыт ли выбор фото для рамок
  const placeFresh = useRef<(id: string) => boolean>(() => false)
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
  // Страниц могло стать меньше (удалили, отменили добавление) — номер не дальше последней.
  const pageIndex = Math.min(rawPageIndex, lastIndex)
  const page = allPages[pageIndex]

  // PageView сообщает, влез ли текст в блок; храним для предупреждений.
  const onTextFit = (elId: string, fits: boolean) => {
    const key = elKey({ pageId: page.id, elId })
    setOverflow((o) => (o[key] === !fits ? o : { ...o, [key]: !fits }))
  }

  // Только что загруженные фото показываем прямо из памяти устройства
  // (мгновенно, без скачивания обратно), остальные — с сервера.
  const serverSizes = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])
  const imageSrc = useCallback(
    (id: string) => localImages[id]?.url ?? (serverSizes.get(id)?.viewable === false ? BLANK : assetImageUrl(book.token, id)),
    [localImages, serverSizes, book.token],
  )
  const sizeOf = (id: string): Size | undefined => {
    const s = localImages[id] ?? serverSizes.get(id)
    return s && s.width > 0 ? s : undefined // HEIC: размеры появятся после обработки на сервере
  }

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
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || editingText || pickingSticker || confirmDelete !== null || confirmRemove !== null) return
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

  // ---------- Лоток «Мои фото» и загрузка ----------
  // Очередь одна на редактор: загружает по LIMITS.parallel файлов, повторяет при сбое.
  const [queue] = useState(
    () =>
      new UploadQueue(
        {
          parallel: LIMITS.parallel,
          retries: LIMITS.retries,
          hash: fileHash,
          upload: async (file, sha, onProgress, key) => {
            // Превью и размеры — сразу, до загрузки. HEIC браузер может не открыть:
            // тогда размеры узнает сервер, а картинка появится, когда он сделает миниатюру.
            const preview = await localPreview(file)
            if (!preview && !isHeif(file)) throw new ApiError('bad_image', 0)
            if (preview) {
              objectUrls.current.push(preview.url)
              queue.setPreview(key, preview.url)
            }
            const res = await uploadPhoto(book.token, file, preview, sha, onProgress)
            const id = res.info.id
            if (!res.duplicate) {
              if (preview) setLocalImages((m) => ({ ...m, [id]: preview }))
              setAssets((list) => (list.some((a) => a.id === id) ? list : [...list, res.info]))
              if (pickingRef.current && !placeFresh.current(id)) setFresh((f) => [...f, id])
            }
            return { assetId: id, duplicate: res.duplicate }
          },
        },
        book.assets.filter((a) => !a.removed),
      ),
  )
  useEffect(() => queue.subscribe(setQueueItems), [queue])

  // Закрывают вкладку, пока фото грузятся, — браузер переспросит.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!queue.busy) return
      e.preventDefault()
      e.returnValue = '' // для старых браузеров; текст вопроса браузер пишет свой
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [queue])

  // HEIC: миниатюру сервер делает несколько секунд — спрашиваем, готова ли.
  const waitingThumbs = assets.some((a) => !a.viewable && !a.removed && !localImages[a.id])
  useEffect(() => {
    if (!waitingThumbs) return
    const timer = setInterval(() => {
      listAssets(book.token).then(setAssets, () => {}) // сбой — спросим в следующий раз
    }, 3000)
    return () => clearInterval(timer)
  }, [waitingThumbs, book.token])

  const usage = useMemo(() => usageCounts(doc), [doc])
  const photos = useMemo(() => trayPhotos(assets, usage), [assets, usage])

  // Выбрали файлы (в одном окне — сколько угодно фото): проверка формата
  // и размера, лимиты, затем в очередь. Повторы очередь пропустит сама.
  function onFilesChosen(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // чтобы те же файлы можно было выбрать ещё раз
    if (files.length === 0) return
    setError(null)
    queue.clearFinished()
    const notes: string[] = []
    const ok = files.filter((f) => !checkFile(f))
    if (ok.length < files.length) notes.push(t.tray.rejected(files.length - ok.length))
    // Сервер считает все фото книги, и удалённые из лотка тоже (их файлы хранятся).
    const inFlight = queue.items.filter((i) => i.status === 'waiting' || i.status === 'uploading').length
    const room = Math.max(0, LIMITS.maxPerBook - assets.length - inFlight)
    const cap = Math.min(room, LIMITS.maxFilesPerBatch)
    let take = ok
    if (ok.length > 0 && room === 0) {
      notes.push(t.tray.bookFull(LIMITS.maxPerBook))
      take = []
    } else if (ok.length > cap) {
      notes.push(cap < LIMITS.maxFilesPerBatch ? t.tray.bookAlmostFull(cap, LIMITS.maxPerBook) : t.tray.tooManyAtOnce(cap, ok.length - cap))
      take = ok.slice(0, cap)
    }
    setNotices(notes)
    setRepeated(queue.add(take).repeated)
  }

  const duplicates = repeated + queueItems.filter((i) => i.status === 'duplicate').length
  const trayNotices = duplicates > 0 ? [...notices, t.tray.duplicates(duplicates)] : notices

  // Выбор фото для рамок: тап по пустой рамке — она и остальные пустые рамки
  // страницы по порядку; «Заменить» — одна рамка.
  function openPick(targets: SlotRef[]) {
    setTrayMode({ kind: 'pick', targets })
    pickingRef.current = true
    setFresh([])
    setTrayOpen(true)
    setSelected(null)
    // На компьютере лоток — колонка справа: докручиваем, чтобы он был виден.
    requestAnimationFrame(() => rootRef.current?.querySelector('.ed-tray')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  function closeTray() {
    setTrayOpen(false)
    setTrayMode({ kind: 'browse' })
    pickingRef.current = false
  }

  function onTapSlot(el: PhotoSlotElement) {
    const target = { pageId: page.id, elId: el.id }
    if (el.assetId) {
      setSelected(target)
      return
    }
    openPick([target, ...emptySlotsOf(page).filter((r) => r.elId !== el.id)])
  }

  // Фото из лотка — в рамки режима выбора или в пустые рамки открытой страницы.
  function placeFromTray(ids: string[]) {
    const targets = trayMode.kind === 'pick' ? trayMode.targets : emptySlotsOf(page)
    const out: { placed: Placement[] } = { placed: [] }
    update((d) => {
      const r = placePhotos(d, targets, ids)
      out.placed = r.placed
      return r.doc
    })
    closeTray()
    const first = out.placed[0]
    if (first) {
      setPageIndex(allPages.findIndex((p) => p.id === first.pageId))
      setSelected(first) // сразу можно подвинуть кадр
    }
  }

  // Выбирали фото для одной рамки и загрузили новое — оно сразу встаёт в рамку
  // (как раньше: тап по рамке → «Добавить фото» → фото на месте). Загрузчик
  // вызывает это из очереди, поэтому функция в ref — всегда свежая.
  useEffect(() => {
    placeFresh.current = (id: string) => {
      if (!pickingRef.current || trayMode.kind !== 'pick' || trayMode.targets.length !== 1) return false
      placeFromTray([id]) // закрывает выбор: следующие фото останутся в лотке
      return true
    }
  })

  // Перетащили миниатюру в рамку (компьютер): пустая — заполняется, с фото — замена.
  function dropPhoto(target: SlotRef, assetId: string) {
    if (!assets.some((a) => a.id === assetId)) return
    update((d) => placePhotos(d, [target], [assetId]).doc)
    setSelected(target)
  }

  function runAutoLayout() {
    const out: { r?: ReturnType<typeof autoLayout> } = {}
    update((d) => {
      out.r = autoLayout(d, assets)
      return out.r.placed.length > 0 ? out.r.doc : d
    })
    const r = out.r!
    if (r.placed.length === 0) {
      const anyEmpty = allPages.some((p) => emptySlotsOf(p).length > 0)
      setTrayToast({ id: Date.now(), text: anyEmpty ? t.tray.nothingToPlace : t.tray.noEmptySlots })
      return
    }
    setTrayToast({
      id: Date.now(),
      text: t.tray.laidOut(r.placed.length) + (r.leftover > 0 ? ` ${t.tray.leftover(r.leftover)}` : ''),
      onUndo: () => {
        update((d) => unplace(d, r.placed))
        setTrayToast(null)
      },
    })
  }

  // Удаление из лотка: если фото стоит в книге — сначала спросить.
  function askRemovePhotos(ids: string[]) {
    if (ids.some((id) => usage.has(id))) setConfirmRemove(ids)
    else void removePhotos(ids)
  }

  async function removePhotos(ids: string[]) {
    setConfirmRemove(null)
    const gone = new Set(ids)
    const out: { freed: Placement[] } = { freed: [] }
    update((d) => {
      const r = freeAssets(d, gone)
      out.freed = r.freed
      return r.freed.length > 0 ? r.doc : d
    })
    const freed = out.freed
    // Удалённое фото можно загрузить снова: очередь перестаёт считать его повтором.
    const mark = (removed: boolean) => {
      setAssets((list) => list.map((a) => (gone.has(a.id) ? { ...a, removed } : a)))
      for (const a of assets) if (gone.has(a.id)) queue.known(a.id, a.sha256, !removed)
    }
    mark(true)
    try {
      await Promise.all(ids.map((id) => removeAsset(book.token, id, true)))
    } catch (err) {
      mark(false)
      update((d) => restorePlacements(d, freed))
      setError(toApiError(err))
      return
    }
    setTrayToast({
      id: Date.now(),
      text: t.tray.deleted(ids.length),
      onUndo: () => {
        setTrayToast(null)
        mark(false)
        update((d) => restorePlacements(d, freed))
        Promise.all(ids.map((id) => removeAsset(book.token, id, false))).catch((err) => setError(toApiError(err)))
      },
    })
  }

  // Предупреждение «маленькое фото» в лотке: в режиме выбора — для рамки, куда
  // ставим; фото в книге — по его рамкам; остальные — для рамки в пол-страницы.
  function photoLowRes(a: AssetInfo): boolean {
    const size = sizeOf(a.id)
    if (!size) return false
    if (trayMode.kind === 'pick') {
      const el = findSlot(doc, trayMode.targets[0])
      return !!el && isLowDpi({ ...el, crop: DEFAULT_CROP }, book.format, size)
    }
    if (usage.has(a.id)) {
      return allPages.some((p) => p.elements.some((el) => el.type === 'photo_slot' && el.assetId === a.id && lowDpi(el)))
    }
    return isLowDpi(HALF_SLOT, book.format, size)
  }

  // «обложка, стр. 3, задняя обложка» — где стоят удаляемые фото.
  function usedOnPages(ids: string[]): string {
    const nums = [...new Set(ids.flatMap((id) => pagesUsing(doc, id)))].sort((a, b) => a - b)
    return nums.map((n) => pageLabel(n, lastIndex, PAGE_LINKS)).join(', ')
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

  // ---------- Страницы: удалить и добавить листом ----------
  const fmt = book.format
  const count = doc.pages.length
  const blockIndex = pageIndex >= 1 && pageIndex <= count ? pageIndex - 1 : null // открыта страница блока, не обложка

  // Пустой лист удаляем сразу; если на нём есть фото, текст или стикеры — спрашиваем.
  function askDeletePages() {
    if (blockIndex === null || !canRemove(count, fmt)) return
    const { start, end } = leafOf(blockIndex, fmt.pageStep)
    if (doc.pages.slice(start, end).some(hasContent)) setConfirmDelete(blockIndex)
    else deletePages(blockIndex)
  }

  function deletePages(index: number) {
    setConfirmDelete(null)
    const out: { removed?: Removed } = {}
    update((d) => {
      if (!canRemove(d.pages.length, fmt)) return d // двойной тап: второй раз не удаляем
      const r = removeLeaf(d, index, fmt.pageStep)
      out.removed = r.removed
      return r.doc
    })
    const r = out.removed
    if (!r) return
    setPageIndex(Math.min(r.at + 1, count - r.pages.length)) // встаёт следующая страница (или последняя)
    setSelected(null)
    setToast({ id: Date.now(), text: t.editor.pagesDeleted(r.at + 1, r.at + r.pages.length), removed: r })
  }

  // «Отменить» в сообщении: страницы — на то же место. Фото удалённых страниц
  // остались в хранилище, поэтому вернутся вместе со страницами. Если их уже
  // вернула общая «Отменить» (Ctrl+Z), второй раз не вставляем — иначе id
  // страниц повторятся и сервер не примет книгу.
  function undoDelete(r: Removed) {
    update((d) => {
      const back = d.pages.some((p) => r.pages.some((q) => q.id === p.id))
      return !back && d.pages.length + r.pages.length <= fmt.maxPages ? restoreLeaf(d, r) : d
    })
    setPageIndex(r.at + 1)
    setSelected(null)
    setToast(null)
  }

  // Добавить лист: после листа открытой страницы; с передней обложки — в начало,
  // с задней и из ленты — в конец. Новые страницы повторяют устройство соседнего листа.
  function addPages(where: 'here' | 'end') {
    const step = fmt.pageStep
    const at = where === 'end' || pageIndex === lastIndex ? count : blockIndex === null ? 0 : Math.min(leafOf(blockIndex, step).end, count)
    const samples = at === 0 ? doc.pages.slice(0, step) : doc.pages.slice(Math.max(0, at - step), at)
    update((d) => (canAdd(d.pages.length, fmt) ? insertLeaf(d, at, step, samples.length > 0 ? samples : [d.cover]) : d))
    setPageIndex(at + 1)
    setSelected(null)
    setToast({ id: Date.now(), text: t.editor.pagesAdded(at + 1, at + step) })
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

  // Сообщение «Страницы 5–6 удалены — Отменить» стоит под кнопками страниц;
  // на телефоне его может закрыть панель внизу — докручиваем, чтобы было видно.
  const toastId = toast?.id
  useEffect(() => {
    if (!toastId) return
    const frame = requestAnimationFrame(() => {
      const node = rootRef.current?.querySelector('.ed-toast')
      const bar = toolbarRef.current
      if (!node || !bar) return
      const r = node.getBoundingClientRect()
      const barAtBottom = getComputedStyle(bar).position === 'fixed'
      const visibleBottom = window.innerHeight - (barAtBottom ? bar.offsetHeight : 0) - 12
      if (r.bottom > visibleBottom) window.scrollBy({ top: r.bottom - visibleBottom, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [toastId])

  // Выбранный элемент на текущей странице — для него показываем панель внизу.
  const active = selected && selected.pageId === page.id ? selected : null
  const activeEl = active ? findElement(doc, active) : undefined
  const editingEl = editingText ? findElement(doc, editingText) : undefined
  const pageTitle = pageLabel(pageIndex, lastIndex, pageOfWords(doc.pages.length))

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
      {/* Заявка уже есть, но заказ ещё не в печати: менять можно, мы пересоберём макет. */}
      {book.order && status !== 'locked' && (
        <div className="ed-banner ed-banner-info" role="status">
          <p>{t.editor.orderOpen(book.order.number)}</p>
          <Link className="btn" to={`/b/${book.token}/order`}>
            {t.editor.orderLink}
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
                lowDpi={lowDpi(el)}
                label={el.assetId ? t.editor.slotFilled : t.editor.slotEmpty}
                onTap={() => onTapSlot(el)}
                onCrop={(crop) => setCrop(ref, crop)}
                onDropPhoto={(id) => dropPhoto(ref, id)}
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
        <span>{pageTitle}</span>
        <button
          className="btn"
          onClick={() => goTo(pageIndex + 1)}
          disabled={pageIndex === lastIndex}
          aria-label={t.editor.nextPage}
        >
          ›
        </button>
      </nav>

      <PagesBar format={fmt} count={count} blockIndex={blockIndex} onDelete={askDeletePages} onAdd={() => addPages('here')}>
        {toast && (
          <Toast
            key={toast.id}
            text={toast.text}
            onUndo={toast.removed ? () => undoDelete(toast.removed!) : undefined}
            undoDisabled={!!toast.removed && count + toast.removed.pages.length > fmt.maxPages}
            onClose={() => setToast(null)}
          />
        )}
      </PagesBar>

      <PageStrip
        pages={allPages}
        current={pageIndex}
        format={book.format}
        imageSrc={imageSrc}
        warnings={allPages.map(pageHasLowDpi)}
        onSelect={goTo}
        showAddEnd={fmt.minPages !== fmt.maxPages}
        canAddEnd={canAdd(count, fmt)}
        addEndLabel={canAdd(count, fmt) ? t.editor.addPagesToEnd(fmt.pageStep) : t.editor.maxPagesReached(fmt.maxPages)}
        onAddEnd={() => addPages('end')}
      />

      {/* Чистая ссылка на книгу, без ?page= и прочего из адресной строки. */}
      <ShareLink url={`${window.location.origin}/b/${book.token}`} />

      {/* Панель внизу экрана: подсказка или управление выбранным фото. На широком
          экране вместе с лотком «Мои фото» — колонка справа (ed-side). */}
      <div className="ed-side">
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
                <button className="btn" onClick={() => openPick([active])}>
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
              {/* На телефоне лоток открывается шторкой; на компьютере он виден всегда. */}
              <button className="btn ed-tray-open" onClick={() => setTrayOpen(true)}>
                {t.editor.myPhotos(photos.length)}
              </button>
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

      <PhotoTray
        open={trayOpen}
        mode={trayMode}
        photos={photos}
        usage={usage}
        lowRes={photoLowRes}
        imageSrc={imageSrc}
        queue={queueItems}
        emptyOnPage={emptySlotsOf(page).length}
        notices={trayNotices}
        fresh={fresh}
        disabled={status === 'locked'}
        onAdd={() => fileInput.current?.click()}
        onAutoLayout={runAutoLayout}
        onPlace={placeFromTray}
        onDelete={askRemovePhotos}
        onRetry={(key) => queue.retry(key)}
        onRetryAll={() => queue.retryAll()}
        onCancelPick={closeTray}
        onClose={closeTray}
      >
        {trayToast && (
          <Toast key={trayToast.id} text={trayToast.text} onUndo={trayToast.onUndo} onClose={() => setTrayToast(null)} />
        )}
      </PhotoTray>
      </div>

      {/* Выбор фото: сразу много (multiple), на телефоне — галерея с отметками. */}
      <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={onFilesChosen} />

      {confirmRemove && (
        <ConfirmDialog
          title={t.tray.confirmDeleteTitle(confirmRemove.length)}
          text={t.tray.confirmDeleteText(usedOnPages(confirmRemove))}
          confirm={t.tray.confirmDelete}
          onConfirm={() => void removePhotos(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      {pickingSticker && <StickerPicker onPick={addSticker} onClose={() => setPickingSticker(false)} />}

      {confirmDelete !== null && (
        <ConfirmDialog
          title={t.editor.confirmDeleteTitle(
            leafOf(confirmDelete, fmt.pageStep).start + 1,
            Math.min(leafOf(confirmDelete, fmt.pageStep).end, count),
          )}
          text={t.editor.confirmDeleteText}
          confirm={t.editor.confirmDelete}
          onConfirm={() => deletePages(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}


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
  showAddEnd: boolean // число страниц можно менять (иначе плитки «+» нет)
  canAddEnd: boolean
  addEndLabel: string // «Добавить 2 страницы в конец» или почему нельзя
  onAddEnd: () => void
}

// Лента миниатюр всех страниц для быстрого перехода. Перед задней обложкой —
// плитка «+»: добавить лист в конец книги.
function PageStrip({ pages, current, format, imageSrc, warnings, onSelect, showAddEnd, canAddEnd, addEndLabel, onAddEnd }: StripProps) {
  const listRef = useRef<HTMLOListElement>(null)

  // Текущая миниатюра — по центру ленты. Крутим только саму ленту:
  // scrollIntoView прокрутил бы ещё и всю страницу. Лента горизонтальная
  // на телефоне и вертикальная колонка на широком экране.
  useEffect(() => {
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>(`[data-strip="${current}"]`)
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
        <Fragment key={p.id}>
          {i === pages.length - 1 && showAddEnd && (
            <li className="ed-strip-add">
              <button onClick={onAddEnd} disabled={!canAddEnd} aria-label={addEndLabel} title={addEndLabel}>
                <span className="ed-strip-plus" style={{ aspectRatio: `${format.widthMm} / ${format.heightMm}` }} aria-hidden="true">
                  +
                </span>
                <span>+{format.pageStep}</span>
              </button>
            </li>
          )}
        <li data-strip={i}>
          <button
            className={i === current ? 'is-current' : undefined}
            aria-current={i === current ? 'page' : undefined}
            aria-label={pageLabel(i, pages.length - 1, PAGE_NAMES) + (warnings[i] ? `. ${t.editor.lowDpiShort}` : '')}
            onClick={() => onSelect(i)}
          >
            <PageView page={p} format={format} imageSrc={imageSrc} lazy />
            <span>
              {warnings[i] && <span className="ed-strip-warn" aria-hidden="true" />}
              {pageLabel(i, pages.length - 1, PAGE_SHORT)}
            </span>
          </button>
        </li>
        </Fragment>
      ))}
    </ol>
  )
}

