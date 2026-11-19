'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/login/actions'
import { stopImpersonation } from '@/app/admin/actions'
import { Logo } from './Logo'
import styles from './SiteNav.module.css'

const ITEMS = [
  { href: '/', label: 'Watchlist', short: 'Watchlist' },
  { href: '/movimenti', label: 'Movimenti forti', short: 'Movimenti' },
  { href: '/trimestrali', label: 'Trimestrali', short: 'Trimestrali' },
  { href: '/ipo', label: 'IPO', short: 'IPO' },
  { href: '/politici', label: 'Politici USA', short: 'Politici' },
  { href: '/scanner', label: 'Minervini SCAN', short: 'Minervini', badge: 'New' },
  { href: '/scopri', label: 'Scopri titoli', short: 'Scopri', cta: true },
]

export function SiteNav({ signedIn, isAdmin = false, viewingAs = null }: { signedIn: boolean; isAdmin?: boolean; viewingAs?: string | null }) {
  const pathname = usePathname()
  const items = isAdmin ? [...ITEMS, { href: '/admin', label: 'Utenti', short: 'Utenti' }] : ITEMS
  return (
    <>
      {viewingAs && (
        <form action={stopImpersonation} className={styles.viewingAs}>
          <span>
            Stai guardando come <strong>{viewingAs}</strong>
          </span>
          <button type="submit">Torna al tuo account</button>
        </form>
      )}
    <nav className={styles.bar} aria-label="Principale">
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <Logo />
          Any Stock
        </Link>
        {signedIn && (
          <>
            <ul className={styles.items}>
              {items.map((item) => {
                const active = item.href === '/' ? pathname === '/' || pathname.startsWith('/stock') : pathname.startsWith(item.href)
                return (
                  <li key={item.href} className={'cta' in item && item.cta ? styles.ctaItem : undefined}>
                    <Link href={item.href} className={`${styles.link} ${'cta' in item && item.cta ? styles.cta : ''} ${active ? styles.active : ''}`} aria-current={active ? 'page' : undefined}>
                      <span className={styles.full}>{item.label}</span>
                      <span className={styles.short}>{item.short}</span>
                      {'badge' in item && <span className={styles.badge}>{item.badge}</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
            <form action={logout} className={styles.logoutForm}>
              <button type="submit" className={styles.logout}>
                Esci
              </button>
            </form>
          </>
        )}
      </div>
    </nav>
    </>
  )
}
