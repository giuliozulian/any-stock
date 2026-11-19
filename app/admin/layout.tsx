import { AdminTabs } from '@/components/AdminTabs'
import styles from './admin.module.css'

export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <main className={styles.shell}>
      <header className={styles.head}>
        <h1 className={styles.title}>Admin</h1>
        <p className={styles.sub}>Strumenti riservati al tuo account.</p>
      </header>
      <AdminTabs />
      {children}
    </main>
  )
}
