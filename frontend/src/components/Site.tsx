import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { t } from '../i18n/index.ts'
import './Site.css'

// Общие части сайта (не редактора): знак, шапка, подвал, метки реза.

// Знак: название и ляссе — красная ленточка-закладка из переплёта книги.
export function Logo() {
  return (
    <Link to="/" className="logo" aria-label={t.site.home}>
      <svg className="logo-ribbon" viewBox="0 0 10 24" aria-hidden="true">
        <path d="M0 0H10V24L5 19L0 24Z" />
      </svg>
      <span className="logo-word">{t.site.name}</span>
    </Link>
  )
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Logo />
        <nav className="site-nav" aria-label={t.site.nav}>
          <Link to={{ pathname: '/', hash: '#how' }} className="site-nav-secondary">
            {t.site.how}
          </Link>
          <Link to={{ pathname: '/', hash: '#templates' }}>{t.site.templates}</Link>
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <Logo />
        <p>{t.site.footer}</p>
      </div>
    </footer>
  )
}

// Метки реза по углам, как на листе в типографии: «это лист, который пойдёт
// в печать». Рисуются снаружи блока и не занимают места в раскладке.
export function CropMarks({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className ? `crop ${className}` : 'crop'}>
      {children}
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <span key={c} className={`crop-mark crop-${c}`} aria-hidden="true" />
      ))}
    </div>
  )
}
