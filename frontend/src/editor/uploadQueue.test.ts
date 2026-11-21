import { describe, expect, it } from 'vitest'
import { ApiError } from '../api.ts'
import { UploadQueue, type QueueDeps } from './uploadQueue.ts'

const file = (name: string, content = name, lastModified = 1) => new File([content], name, { type: 'image/jpeg', lastModified })

// Хеш в тестах — само содержимое файла: одинаковое содержимое = один хеш.
const hash = async (f: File) => `h:${await f.text()}`

function deps(upload: QueueDeps['upload'], extra: Partial<QueueDeps> = {}): QueueDeps {
  return { upload, hash, parallel: 3, retries: 2, wait: async () => {}, ...extra }
}

describe('UploadQueue', () => {
  it('uploads 20 files, 3 at a time; one failing file does not stop the others', async () => {
    let active = 0
    let maxActive = 0
    const calls = new Map<string, number>()
    const q = new UploadQueue(
      deps(async (f, _sha, onProgress) => {
        calls.set(f.name, (calls.get(f.name) ?? 0) + 1)
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 1))
        onProgress(0.5)
        active--
        if (f.name === 'photo-7.jpg') throw new ApiError('upload_failed', 0)
        return { assetId: `id-${f.name}`, duplicate: false }
      }),
    )
    q.add(Array.from({ length: 20 }, (_, i) => file(`photo-${i}.jpg`)))
    await q.whenIdle()

    expect(maxActive).toBe(3)
    expect(q.items.filter((i) => i.status === 'done')).toHaveLength(19)
    const failed = q.items.filter((i) => i.status === 'failed')
    expect(failed.map((i) => i.file.name)).toEqual(['photo-7.jpg'])
    expect(calls.get('photo-7.jpg')).toBe(3) // первая попытка и два автоматических повтора
    expect(failed[0].error).toBe('upload_failed')
    expect(q.busy).toBe(false)
  })

  it('retries automatically after a network glitch and by the «Retry» button', async () => {
    let failures = 2
    const q = new UploadQueue(
      deps(async (f) => {
        if (f.name === 'flaky.jpg' && failures-- > 0) throw new ApiError('network', 0)
        if (f.name === 'down.jpg') throw new ApiError('upload_failed', 503)
        return { assetId: f.name, duplicate: false }
      }, { retries: 2 }),
    )
    q.add([file('flaky.jpg'), file('down.jpg')])
    await q.whenIdle()
    expect(q.items.find((i) => i.file.name === 'flaky.jpg')).toMatchObject({ status: 'done', attempts: 3 })
    const down = q.items.find((i) => i.file.name === 'down.jpg')!
    expect(down.status).toBe('failed')

    // Сеть вернулась — «Повторить».
    q['deps'].upload = async (f) => ({ assetId: f.name, duplicate: false })
    q.retry(down.key)
    await q.whenIdle()
    expect(q.items.find((i) => i.key === down.key)?.status).toBe('done')
  })

  it('does not retry errors that a retry cannot fix', async () => {
    let calls = 0
    const q = new UploadQueue(
      deps(async () => {
        calls++
        throw new ApiError('bad_image', 400)
      }),
    )
    q.add([file('broken.jpg')])
    await q.whenIdle()
    expect(calls).toBe(1)
    expect(q.items[0]).toMatchObject({ status: 'failed', error: 'bad_image' })
  })

  it('skips duplicates: same file twice, same content under another name, a photo already in the book', async () => {
    const uploaded: string[] = []
    const q = new UploadQueue(
      deps(async (f) => {
        uploaded.push(f.name)
        return { assetId: `id-${f.name}`, duplicate: false }
      }),
      [{ id: 'old', sha256: 'h:already in book' }],
    )
    const a = file('a.jpg', 'sea')
    const { repeated } = q.add([a, a, file('IMG_1.jpg', 'sea', 5), file('b.jpg', 'already in book'), file('c.jpg', 'mountains')])
    await q.whenIdle()

    expect(repeated).toBe(1) // тот же файл (имя, размер, дата) — сразу
    expect(uploaded.sort()).toEqual(['a.jpg', 'c.jpg'])
    const dups = q.items.filter((i) => i.status === 'duplicate')
    expect(dups.map((i) => i.file.name).sort()).toEqual(['IMG_1.jpg', 'b.jpg'])
    expect(dups.find((i) => i.file.name === 'b.jpg')?.assetId).toBe('old')

    // Позже выбрали тот же файл ещё раз — тоже пропуск.
    q.add([file('again.jpg', 'mountains', 9)])
    await q.whenIdle()
    expect(q.items.at(-1)).toMatchObject({ status: 'duplicate', assetId: 'id-c.jpg' })
  })

  it('accepts the server saying the photo is a duplicate', async () => {
    const q = new UploadQueue(deps(async () => ({ assetId: 'existing', duplicate: true }), { hash: async () => null }))
    q.add([file('x.jpg')])
    await q.whenIdle()
    expect(q.items[0]).toMatchObject({ status: 'duplicate', assetId: 'existing' })
  })
})
