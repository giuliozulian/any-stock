'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logo } from './Logo'
import styles from './SiteNav.module.css'

const ITEMS = [
  { href: '/', label: 'Watchlist' },
  { href: '/movimenti', label: 'Movimenti forti' },
  { href: '/trimestrali', label: 'Trimestrali' },
  { href: '/ipo', label: 'IPO' },
  { href: '/politici', label: 'Politici' },
]

export function SiteNav() {
  const pathname = usePathname()
  return (
    <nav className={styles.bar} aria-label="Principale">
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <Logo />
          Any Stock
        </Link>
        <ul className={styles.items}>
          {ITEMS.map((item) => {
            const active = item.href === '/' ? pathname === '/' || pathname.startsWith('/stock') : pathname.startsWith(item.href)
            return (
              <li key={item.href}>
                <Link href={item.href} className={`${styles.link} ${active ? styles.active : ''}`} aria-current={active ? 'page' : undefined}>
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
