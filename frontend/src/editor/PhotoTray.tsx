import { useEffect, useEffectEvent, useState, type DragEvent, type ReactNode } from 'react'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { ApiError } from '../api.ts'
import { t } from '../i18n/index.ts'
import type { AssetInfo } from '../types.ts'
import type { SlotRef } from './doc.ts'
import type { QueueItem } from './uploadQueue.ts'

// Тип данных при перетаскивании фото из лотка в рамку (компьютер).
export const DRAG_TYPE = 'application/x-sakta-photo'

// Режим лотка: просто «Мои фото» или выбор фото для рамок (тап по пустой
// рамке, «Заменить»). targets — рамки по порядку: выбранные фото встают в них
// в порядке выбора.
export type TrayMode = { kind: 'browse' } | { kind: 'pick'; targets: SlotRef[] }

type Props = {
  open: boolean // телефон: шторка открыта (на компьютере лоток виден всегда)
  mode: TrayMode
  photos: AssetInfo[] // фото лотка по порядку (см. tray.ts, trayPhotos)
  usage: Map<string, number> // сколько рамок занимает фото
  lowRes: (a: AssetInfo) => boolean
  imageSrc: (id: string) => string
  queue: QueueItem[]
  emptyOnPage: number // пустых рамок на открытой странице
  notices: string[] // сообщения о последней загрузке: лимиты, повторы
  fresh: string[] // только что загруженные фото — в режиме выбора отмечаются сами
  disabled: boolean // книга закрыта для изменений
  onAdd: () => void // открыть выбор файлов
  onAutoLayout: () => void
  onPlace: (ids: string[]) => void // в рамки режима выбора или в пустые рамки страницы
  onDelete: (ids: string[]) => void
  onRetry: (key: string) => void
  onRetryAll: () => void
  onCancelPick: () => void
  onClose: () => void
  children?: ReactNode // сообщение с «Отменить» (раскладка, удаление)
}

// Лоток «Мои фото»: все фото книги миниатюрами. Тап — отметить (номер на
// миниатюре — порядок выбора), затем действие внизу: вставить в рамки,
// поставить на страницу, удалить. Галочка с числом — фото уже в книге (столько
// рамок), жёлтый знак — фото маленькое. На компьютере миниатюру можно
// перетащить мышью в рамку.
export function PhotoTray(props: Props) {
  const { open, mode, photos, usage, lowRes, imageSrc, queue, emptyOnPage, notices, fresh, disabled } = props
  const [selected, setSelected] = useState<string[]>([])
  const picking = mode.kind === 'pick'
  const max = picking ? mode.targets.length : Infinity

  // Новый режим — новый выбор.
  const modeKey = picking ? mode.targets.map((r) => `${r.pageId}/${r.elId}`).join(',') : 'browse'
  const [shownFor, setShownFor] = useState(modeKey)
  if (shownFor !== modeKey) {
    setShownFor(modeKey)
    setSelected([])
  }

  // Фото, загруженные кнопкой «Загрузить ещё» в режиме выбора, отмечаются сами:
  // останется нажать «Вставить». (Состояние подправляется прямо при отрисовке —
  // так React советует вместо эффекта.)
  const [seenFresh, setSeenFresh] = useState<string[]>([])
  if (fresh !== seenFresh) {
    setSeenFresh(fresh)
    const added = fresh.filter((id) => !seenFresh.includes(id))
    if (picking && added.length > 0) {
      const next = [...selected]
      for (const id of added) if (!next.includes(id) && next.length < max) next.push(id)
      setSelected(next)
    }
  }

  // Esc закрывает шторку на телефоне.
  const onEsc = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) props.onClose()
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => onEsc(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  function tap(id: string) {
    if (disabled) return
    if (picking && max === 1) {
      props.onPlace([id]) // одна рамка — сразу ставим
      return
    }
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < max ? [...sel, id] : sel))
  }

  function onDragStart(e: DragEvent, id: string) {
    e.dataTransfer.setData(DRAG_TYPE, id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const usedCount = photos.filter((a) => usage.has(a.id)).length
  const pending = queue.filter((i) => i.status === 'waiting' || i.status === 'uploading')
  const failed = queue.filter((i) => i.status === 'failed')
  const place = () => {
    props.onPlace(selected)
    setSelected([])
  }

  return (
    <>
      {open && <div className="ed-tray-backdrop" onClick={props.onClose} aria-hidden="true" />}
      <section className={`ed-tray${open ? ' is-open' : ''}`} aria-labelledby="tray-title">
        <header className="ed-tray-head">
          <div>
            <h2 id="tray-title">{t.tray.title}</h2>
            {photos.length > 0 && <p className="muted">{t.tray.used(usedCount, photos.length)}</p>}
          </div>
          <button className="btn ed-icon-btn ed-tray-close" onClick={props.onClose} aria-label={t.tray.close}>
            ✕
          </button>
        </header>

        {picking && (
          <div className="ed-tray-pick" role="status">
            <span>{max === 1 ? t.tray.pickOne : t.tray.pickMany(max)}</span>
            <button className="btn" onClick={props.onCancelPick}>
              {t.tray.cancelPick}
            </button>
          </div>
        )}

        <div className="ed-tray-actions">
          <button className={`btn${photos.length === 0 ? ' btn-accent' : ''}`} onClick={props.onAdd} disabled={disabled}>
            {photos.length === 0 ? t.tray.add : t.tray.addMore}
          </button>
          {!picking && photos.length > 0 && (
            <button className="btn" onClick={props.onAutoLayout} disabled={disabled}>
              {t.tray.autoLayout}
            </button>
          )}
        </div>

        <div className="ed-tray-scroll">
          {props.children}
          {notices.map((n) => (
            <p key={n} className="ed-tray-note">
              {n}
            </p>
          ))}
          {pending.length > 0 && <p className="muted ed-tray-note">{t.tray.uploading(pending.length)}</p>}
          {failed.length > 0 && (
            <div className="ed-tray-failed">
              <span>{t.tray.failed(failed.length)}</span>
              {failed.length > 1 && (
                <button className="btn" onClick={props.onRetryAll}>
                  {t.tray.retryAll}
                </button>
              )}
            </div>
          )}

          {photos.length === 0 && queue.length === 0 && <p className="muted">{t.tray.empty}</p>}

          <ul className="ed-tray-grid">
            {/* Загружаются и не загрузились — первыми, с локальным превью. */}
            {[...pending, ...failed].map((item) => (
              <li key={item.key} className={`ed-tray-item is-${item.status}`}>
                <div className="ed-tray-photo">
                  {item.previewUrl && <img src={item.previewUrl} alt="" />}
                  {item.status === 'failed' ? (
                    <div className="ed-tray-error">
                      <span className="ed-tray-name">{item.file.name}</span>
                      <ErrorMessage error={new ApiError(item.error ?? 'upload_failed', 0)} />
                      <button className="btn" onClick={() => props.onRetry(item.key)}>
                        {t.tray.retry}
                      </button>
                    </div>
                  ) : (
                    <div className="ed-progress" role="progressbar" aria-label={item.file.name} aria-valuenow={Math.round(item.progress * 100)}>
                      <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    </div>
                  )}
                </div>
              </li>
            ))}
            {photos.map((a, i) => {
              const count = usage.get(a.id) ?? 0
              const order = selected.indexOf(a.id)
              const low = lowRes(a)
              const label = [t.tray.photo(i + 1), count > 0 && t.tray.usedTimes(count), low && t.tray.lowRes].filter(Boolean).join(', ')
              return (
                <li key={a.id}>
                  <button
                    className="ed-tray-photo"
                    aria-pressed={order >= 0}
                    aria-label={label}
                    title={label}
                    data-asset-id={a.id}
                    draggable={!disabled && a.viewable}
                    onDragStart={(e) => onDragStart(e, a.id)}
                    onClick={() => tap(a.id)}
                    disabled={disabled || (order < 0 && selected.length >= max)}
                  >
                    {a.viewable ? <img src={imageSrc(a.id)} alt="" loading="lazy" draggable={false} /> : <span className="ed-tray-wait">{t.tray.processing}</span>}
                    {count > 0 && (
                      <span className="ed-tray-used" aria-hidden="true">
                        ✓{count > 1 && count}
                      </span>
                    )}
                    {low && (
                      <span className="ed-tray-low" aria-hidden="true">
                        !
                      </span>
                    )}
                    {order >= 0 && (
                      <span className="ed-tray-order" aria-hidden="true">
                        {order + 1}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {!picking && photos.length > 0 && <p className="muted ed-tray-note ed-tray-drag">{t.tray.dragHint}</p>}
        </div>

        {selected.length > 0 && (
          <footer className="ed-tray-bar">
            <span className="muted">{t.tray.selected(selected.length)}</span>
            <div className="ed-toolbar-row">
              {picking ? (
                <button className="btn btn-accent" onClick={place}>
                  {t.tray.insert(selected.length)}
                </button>
              ) : (
                <>
                  <button className="btn btn-accent" onClick={place} disabled={emptyOnPage === 0} title={emptyOnPage === 0 ? t.tray.noEmptyOnPage : undefined}>
                    {t.tray.placeOnPage(Math.min(selected.length, emptyOnPage) || selected.length)}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      props.onDelete(selected)
                      setSelected([])
                    }}
                  >
                    {t.tray.deleteSelected(selected.length)}
                  </button>
                </>
              )}
              <button className="btn" onClick={() => setSelected([])}>
                {t.tray.clearSelection}
              </button>
            </div>
          </footer>
        )}
      </section>
    </>
  )
}
