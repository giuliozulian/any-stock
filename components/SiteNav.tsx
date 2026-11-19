'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/login/actions'
import { stopImpersonation } from '@/app/admin/actions'
import { Logo } from './Logo'
import styles from './SiteNav.module.css'

// Entries grouped by what they are for. On a desktop each group is a dropdown, with Watchlist, Minervini and Scopri always in view. On a phone those three stay in the bottom bar and the groups open from "Menu", each under its name.
interface NavItem {
  href: string
  label: string
  short: string
  hint?: string
  cta?: boolean
  badge?: string
}

type Entry = { kind: 'link'; item: NavItem } | { kind: 'group'; label: string; items: NavItem[] }

const ENTRIES: Entry[] = [
  { kind: 'link', item: { href: '/', label: 'Watchlist', short: 'Watchlist' } },
  {
    kind: 'group',
    label: 'Mercato',
    items: [
      { href: '/movimenti', label: 'Movimenti forti', short: 'Movimenti', hint: 'Chi si muove oggi' },
      { href: '/trimestrali', label: 'Trimestrali', short: 'Trimestrali', hint: 'Conti in uscita' },
      { href: '/ipo', label: 'IPO', short: 'IPO', hint: 'Nuove quotazioni' },
    ],
  },
  {
    kind: 'group',
    label: 'Chi compra',
    items: [
      { href: '/politici', label: 'Politici USA', short: 'Politici', hint: 'Acquisti dei parlamentari' },
      { href: '/insider', label: 'Cluster insider', short: 'Insider', hint: 'Dirigenti che comprano insieme', badge: 'New' },
    ],
  },
  { kind: 'link', item: { href: '/scanner', label: 'Minervini SCAN', short: 'Minervini', badge: 'New' } },
  { kind: 'link', item: { href: '/scopri', label: 'Scopri titoli', short: 'Scopri', cta: true } },
]
const ACCOUNT = 'account'

export function SiteNav({ signedIn, isAdmin = false, viewingAs = null, email = null }: { signedIn: boolean; isAdmin?: boolean; viewingAs?: string | null; email?: string | null }) {
  const pathname = usePathname()
  const entries = ENTRIES
  const [open, setOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const isActive = (href: string) => (href === '/' ? pathname === '/' || pathname.startsWith('/stock') : pathname.startsWith(href))
  const close = () => {
    setOpen(false)
    setOpenGroup(null)
  }
  // The Menu button looks active when the current page is one of the entries it hides.
  const menuActive = entries.some((e) => e.kind === 'group' && e.items.some((i) => isActive(i.href)))

  // A dropdown closes when the click lands anywhere outside the bar.
  useEffect(() => {
    if (!openGroup) return
    const onPointerDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenGroup(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [openGroup])

  return (
    <>
      {viewingAs && (
        <form action={stopImpersonation} className={styles.viewingAs}>
          <span>
            Stai guardando come <strong>{viewingAs}</strong>. Le modifiche valgono per questo utente.
          </span>
          <button type="submit">Torna al tuo account</button>
        </form>
      )}
    <nav ref={navRef} className={styles.bar} aria-label="Principale" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <Logo />
          Any Stock
        </Link>
        {signedIn && (
          <>
            {open && <button type="button" className={styles.scrim} tabIndex={-1} aria-hidden="true" onClick={close} />}
            <ul id="site-menu" className={styles.items} data-open={open} onClick={(e) => (e.target as HTMLElement).closest('a') && close()}>
              {entries.map((entry, n) => {
                // On a phone each group sits in its own slot above the bar.
                const slot = { '--slot': n * 10 } as CSSProperties
                if (entry.kind === 'link') {
                  const { item } = entry
                  const active = isActive(item.href)
                  return (
                    <li key={item.href} className={[item.cta ? styles.ctaItem : '', styles.primary, item.href === '/' ? styles.primaryFirst : ''].join(' ').trim()}>
                      <Link href={item.href} className={`${styles.link} ${item.cta ? styles.cta : ''} ${active ? styles.active : ''}`} aria-current={active ? 'page' : undefined}>
                        <span className={styles.full}>{item.label}</span>
                        <span className={styles.short}>{item.short}</span>
                        {item.badge && <span className={styles.badge}>{item.badge}</span>}
                      </Link>
                    </li>
                  )
                }
                const expanded = openGroup === entry.label
                const groupActive = entry.items.some((i) => isActive(i.href))
                return (
                  <li key={entry.label} className={styles.group} style={slot} data-open={expanded}>
                    <span className={styles.sheetLabel} aria-hidden="true">
                      {entry.label}
                    </span>
                    <button
                        type="button"
                        className={`${styles.trigger} ${groupActive || expanded ? styles.active : ''}`}
                        aria-expanded={expanded}
                        aria-haspopup="true"
                        onClick={() => setOpenGroup(expanded ? null : entry.label)}
                      >
                        {entry.label}
                        <svg className={styles.chevron} viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <ul className={styles.panel} aria-label={entry.label}>
                      {entry.items.map((item) => {
                        const active = isActive(item.href)
                        return (
                          <li key={item.href}>
                            <Link href={item.href} className={`${styles.panelLink} ${active ? styles.panelActive : ''}`} aria-current={active ? 'page' : undefined}>
                              <span className={styles.panelTitle}>
                                {item.label}
                                {item.badge && <span className={styles.badge}>{item.badge}</span>}
                              </span>
                              {item.hint && <span className={styles.panelHint}>{item.hint}</span>}
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                )
              })}
              <li className={styles.menuItem}>
                <button type="button" className={`${styles.menuButton} ${menuActive || open ? styles.active : ''}`} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((v) => !v)}>
                  {open ? 'Chiudi' : 'Menu'}
                </button>
              </li>
            </ul>
            <div className={styles.account} data-open={openGroup === ACCOUNT} onClick={(e) => (e.target as HTMLElement).closest('a') && close()}>
              <button type="button" className={styles.avatar} aria-label="Account" aria-expanded={openGroup === ACCOUNT} aria-haspopup="true" onClick={() => setOpenGroup(openGroup === ACCOUNT ? null : ACCOUNT)}>
                {(email ?? '?').trim().charAt(0).toUpperCase()}
              </button>
              <div className={styles.accountPanel}>
                {email && <p className={styles.accountEmail}>{email}</p>}
                {isAdmin && (
                  <Link href="/admin" className={`${styles.panelLink} ${isActive('/admin') ? styles.panelActive : ''}`} aria-current={isActive('/admin') ? 'page' : undefined}>
                    <span className={styles.panelTitle}>Admin</span>
                    <span className={styles.panelHint}>Utenti e accessi</span>
                  </Link>
                )}
                <form action={logout}>
                  <button type="submit" className={styles.logout}>
                    Esci
                  </button>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    </nav>
    </>
  )
}
