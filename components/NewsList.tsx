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
  analysis?: {
    direction: string
    intensity: number
    horizon: string
    scope: string
    confidence: string
    rationale: string
    digest?: string | null
  } | null
}

const HORIZON_LABEL: Record<string, string> = { short: 'breve termine', medium: 'medio termine', long: 'lungo termine' }
const CONFIDENCE_LABEL: Record<string, string> = { low: 'bassa', medium: 'media', high: 'alta' }

function toneOf(direction: string): NewsTone {
  return direction === 'positive' || direction === 'negative' ? direction : 'neutral'
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
      {[...news].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).map((item) => {
        const ai = item.analysis ?? null
        const impact = ai ? null : stock ? analyzeNewsImpact({ headline: item.headline, summary: item.summary ?? null }, stock) : null
        return (
          <li key={item.id} className={`${styles.item} ${ai ? TONE_CLASS[toneOf(ai.direction)] : impact ? TONE_CLASS[impact.tone] : ''}`}>
            {ai && (
              <p className={styles.impact}>
                <span className={styles.impactLabel}>{TONE_LABEL[toneOf(ai.direction)]}</span>
                <span className={styles.reach}>{ai.scope === 'direct' ? 'sul titolo' : 'indiretto'}</span>
              </p>
            )}
            {impact && (
              <p className={styles.impact}>
                <span className={styles.impactLabel}>{TONE_LABEL[impact.tone]}</span>
                <span className={styles.reach}>{impact.direct ? 'sul titolo' : 'indiretto'}</span>
              </p>
            )}
            <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.headline}>
              {item.headline}
            </a>
            {ai && (
              <>
                {ai.digest && <p className={styles.digest}>{ai.digest}</p>}
                <p className={styles.rationale}>{ai.rationale}</p>
                <p className={styles.aiMeta}>
                  Intensità {ai.intensity}/5 · {HORIZON_LABEL[ai.horizon] ?? ai.horizon} · confidenza {CONFIDENCE_LABEL[ai.confidence] ?? ai.confidence}
                </p>
              </>
            )}
            {impact && <p className={styles.baseTag}>analisi base (parole chiave)</p>}
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
