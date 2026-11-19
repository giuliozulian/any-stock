'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from '@/app/admin/admin.module.css'

// One entry per admin tool. A new feature adds a line here and a folder under app/admin.
const SECTIONS = [{ href: '/admin', label: 'Utenti' }]

export function AdminTabs() {
  const pathname = usePathname()
  return (
    <nav className={styles.tabs} aria-label="Sezioni admin">
      {SECTIONS.map((s) => {
        const active = s.href === '/admin' ? pathname === '/admin' : pathname.startsWith(s.href)
        return (
          <Link key={s.href} href={s.href} className={`${styles.tab} ${active ? styles.tabActive : ''}`} aria-current={active ? 'page' : undefined}>
            {s.label}
          </Link>
        )
      })}
    </nav>
  )
}
