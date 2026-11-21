import { ApiError } from '../api.ts'

// Очередь загрузки фото: много файлов за раз, по несколько параллельно
// (LIMITS.parallel), у каждого свой прогресс. Сбой сети — повтор с паузой
// (LIMITS.retries раз), потом файл попадает в список ошибок с «Повторить».
// Один сбойный файл остальные не останавливает. Одно и то же фото дважды
// не загружается: сначала сравниваем имя, размер и дату изменения файла
// (мгновенно), потом SHA-256 содержимого — с уже загруженными в книгу фото
// и с файлами в очереди (одно фото могли выбрать два раза под разными именами).
//
// Очередь не знает про React: Editor подписывается на изменения (subscribe)
// и перерисовывает лоток. Так её можно проверить тестами без браузера.

export type ItemStatus = 'waiting' | 'uploading' | 'done' | 'failed' | 'duplicate'

export type QueueItem = {
  key: string // локальный id элемента очереди
  file: File
  previewUrl?: string // локальное превью, показываем сразу
  status: ItemStatus
  progress: number // 0…1
  attempts: number
  error?: string // код ошибки для словаря (ErrorMessage)
  assetId?: string // загруженное фото (или то, чьей копией файл оказался)
}

export type QueueDeps = {
  // key — элемент очереди (для setPreview).
  upload: (file: File, sha256: string | null, onProgress: (f: number) => void, key: string) => Promise<{ assetId: string; duplicate: boolean }>
  hash: (file: File) => Promise<string | null>
  parallel: number
  retries: number
  wait?: (ms: number) => Promise<void> // пауза перед повтором (в тестах — без ожидания)
}

// Ошибки, которые повтор не исправит: не тот файл, лимит, книга закрыта.
const PERMANENT = new Set(['unsupported_type', 'file_too_large', 'bad_image', 'too_many_files', 'book_locked', 'book_not_found'])

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class UploadQueue {
  items: QueueItem[] = []
  private deps: QueueDeps
  private running = 0
  private seq = 0
  private byHash = new Map<string, string>() // хеш → id фото в книге (или '' — ещё грузится)
  private listeners = new Set<(items: QueueItem[]) => void>()
  private idle: (() => void)[] = []

  // known — хеши фото, которые уже есть в книге.
  constructor(deps: QueueDeps, known: { id: string; sha256?: string }[] = []) {
    this.deps = deps
    for (const a of known) if (a.sha256) this.byHash.set(a.sha256, a.id)
  }

  subscribe(fn: (items: QueueItem[]) => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  // Есть ли незаконченные загрузки (для предупреждения при закрытии вкладки).
  get busy() {
    return this.items.some((i) => i.status === 'waiting' || i.status === 'uploading')
  }

  // Ждать, пока всё загрузится или упадёт (для тестов).
  whenIdle(): Promise<void> {
    return this.busy ? new Promise((r) => this.idle.push(r)) : Promise.resolve()
  }

  // Новые файлы в очередь. Возвращает добавленные и сколько пропущено как
  // повтор файла, который уже в очереди (имя, размер и дата изменения совпали).
  add(files: File[]): { added: QueueItem[]; repeated: number } {
    const added: QueueItem[] = []
    let repeated = 0
    for (const file of files) {
      const same = (i: QueueItem) =>
        i.status !== 'failed' && i.file.name === file.name && i.file.size === file.size && i.file.lastModified === file.lastModified
      if (this.items.some(same) || added.some(same)) {
        repeated++
        continue
      }
      added.push({ key: `u${++this.seq}`, file, status: 'waiting', progress: 0, attempts: 0 })
    }
    this.items = [...this.items, ...added]
    this.emit()
    this.pump()
    return { added, repeated }
  }

  // Фото удалили из лотка (present = false) — его файл снова можно загрузить;
  // вернули («Отменить») — снова повтор.
  known(assetId: string, sha256: string | undefined, present: boolean) {
    if (!sha256) return
    if (present) this.byHash.set(sha256, assetId)
    else if (this.byHash.get(sha256) === assetId) this.byHash.delete(sha256)
  }

  // Локальное превью элемента (его делает загрузчик, пока идёт загрузка).
  setPreview(key: string, url: string) {
    this.patch(key, (i) => ({ ...i, previewUrl: url }))
  }

  // «Повторить» для файла из списка ошибок.
  retry(key: string) {
    this.patch(key, (i) => (i.status === 'failed' ? { ...i, status: 'waiting', progress: 0, attempts: 0, error: undefined } : i))
    this.pump()
  }

  retryAll() {
    for (const i of this.items) if (i.status === 'failed') this.retry(i.key)
  }

  // Убрать из списка законченные (загруженные и пропущенные) — ошибки остаются.
  clearFinished() {
    this.items = this.items.filter((i) => i.status !== 'done' && i.status !== 'duplicate')
    this.emit()
  }

  private pump() {
    while (this.running < this.deps.parallel) {
      const next = this.items.find((i) => i.status === 'waiting')
      if (!next) break
      this.running++
      this.patch(next.key, (i) => ({ ...i, status: 'uploading' }))
      void this.run(next.key).finally(() => {
        this.running--
        this.pump()
        if (!this.busy) this.idle.splice(0).forEach((r) => r())
      })
    }
  }

  private async run(key: string) {
    const item = this.items.find((i) => i.key === key)!
    let sha: string | null = null
    try {
      sha = await this.deps.hash(item.file)
    } catch {
      sha = null // не смогли прочитать файл — сервер всё равно проверит
    }
    if (sha !== null) {
      const existing = this.byHash.get(sha)
      if (existing !== undefined) {
        this.patch(key, (i) => ({ ...i, status: 'duplicate', progress: 1, assetId: existing || undefined }))
        return
      }
      this.byHash.set(sha, '') // занято: такой же файл позже в очереди — повтор
    }

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.deps.upload(item.file, sha, (progress) => this.patch(key, (i) => ({ ...i, progress })), key)
        if (sha !== null) this.byHash.set(sha, res.assetId)
        this.patch(key, (i) => ({ ...i, status: res.duplicate ? 'duplicate' : 'done', progress: 1, attempts: attempt + 1, assetId: res.assetId }))
        return
      } catch (err) {
        const code = err instanceof ApiError ? err.code : 'upload_failed'
        if (PERMANENT.has(code) || attempt >= this.deps.retries) {
          if (sha !== null) this.byHash.delete(sha) // можно будет выбрать этот файл снова
          this.patch(key, (i) => ({ ...i, status: 'failed', attempts: attempt + 1, error: code }))
          return
        }
        this.patch(key, (i) => ({ ...i, progress: 0, attempts: attempt + 1 }))
        await (this.deps.wait ?? sleep)(1500 * 2 ** attempt) // 1,5 с, затем 3 с
      }
    }
  }

  private patch(key: string, fn: (i: QueueItem) => QueueItem) {
    this.items = this.items.map((i) => (i.key === key ? fn(i) : i))
    this.emit()
  }

  private emit() {
    for (const fn of this.listeners) fn(this.items)
  }
}
