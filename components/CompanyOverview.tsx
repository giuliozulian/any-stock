import { getCompanyOverview } from '@/lib/company-overview'
import styles from './CompanyOverview.module.css'

export async function CompanyOverview({ symbol, name, industry }: { symbol: string; name: string; industry?: string }) {
  const overview = await getCompanyOverview(symbol, name, industry)
  if (!overview) return null
  return (
    <section className={styles.box} aria-label="Chi è l'azienda">
      <p className={styles.sector}>{overview.sector}</p>
      <p className={styles.text}>{overview.description}</p>
    </section>
  )
}
