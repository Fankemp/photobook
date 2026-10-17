import { useState } from 'react'
import { t } from '../i18n/index.ts'

// Ссылка на книгу — единственный «ключ» к ней (регистрации нет), поэтому
// показываем её на видном месте и даём скопировать в один тап.
export function ShareLink() {
  const url = window.location.href
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Буфер обмена недоступен (старый браузер или не HTTPS):
      // текст в поле выделяется по тапу, скопировать можно вручную.
    }
  }

  return (
    <section className="card share">
      <p>{t.book.saveLinkHint}</p>
      <div className="share-row">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t.book.saveLinkHint} />
        <button className="btn" onClick={copy}>
          {copied ? t.book.copied : t.book.copy}
        </button>
      </div>
    </section>
  )
}
