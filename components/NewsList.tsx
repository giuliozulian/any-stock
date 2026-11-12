import styles from './NewsList.module.css'
import { NewsSlider } from './NewsSlider'
import { analyzeNewsImpact, type NewsTone } from '@/lib/news-impact'

interface NewsItemProps {
  id: string
  headline: string
  url: string
  source: string
  summary?: string | null
  publishedAt: Date
}

const TONE_LABEL: Record<NewsTone, string> = {
  positive: 'Impatto positivo',
  negative: 'Impatto negativo',
  neutral: 'Impatto neutro',
}

const TONE_CLASS: Record<NewsTone, string> = {
  positive: styles.positive,
  negative: styles.negative,
  neutral: styles.neutral,
}

export function NewsList({ news, stock }: { news: NewsItemProps[]; stock?: { symbol: string; name: string } }) {
  if (news.length === 0) {
    return <p className={styles.empty}>No recent news.</p>
  }

  return (
    <NewsSlider>
      {news.map((item) => {
        const impact = stock ? analyzeNewsImpact({ headline: item.headline, summary: item.summary ?? null }, stock) : null
        return (
          <li key={item.id} className={`${styles.item} ${impact ? TONE_CLASS[impact.tone] : ''}`}>
            {impact && (
              <p className={styles.impact}>
                <span className={styles.impactLabel}>{TONE_LABEL[impact.tone]}</span>
                <span className={styles.reach}>{impact.direct ? 'sul titolo' : 'indiretto'}</span>
              </p>
            )}
            <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.headline}>
              {item.headline}
            </a>
            {impact && impact.signals.length > 0 && (
              <p className={styles.signals}>Segnali: {impact.signals.slice(0, 3).join(', ')}</p>
            )}
            <span className={styles.meta}>
              {item.source}, {item.publishedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </li>
        )
      })}
    </NewsSlider>
  )
}
