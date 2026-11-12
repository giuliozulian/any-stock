import { fairValue, type FairValueInput } from '@/lib/fair-value'
import type { AltmanResult } from '@/lib/solidity'
import { InfoTip } from './InfoTip'
import styles from './FairValueCard.module.css'

type Tone = 'gain' | 'loss' | 'flat'

function Tile({ label, value, tone, tip }: { label: string; value: string; tone: Tone; tip: React.ReactNode }) {
  return (
    <div className={`${styles.tile} ${styles[tone]}`}>
      <span className={styles.tileLabel}>
        {label}
        {tip}
      </span>
      <span className={styles.tileValue}>{value}</span>
    </div>
  )
}

const ALTMAN_TEXT = { safe: ['Basso', 'rischio di fallimento.'], grey: ['Incerto', 'rischio: zona grigia.'], distress: ['Alto', 'rischio di difficoltà finanziarie.'] } as const

function AltmanBlock({ altman }: { altman: AltmanResult }) {
  const tone: Tone = altman.zone === 'safe' ? 'gain' : altman.zone === 'grey' ? 'flat' : 'loss'
  const [strong, rest] = ALTMAN_TEXT[altman.zone as keyof typeof ALTMAN_TEXT] ?? ALTMAN_TEXT.grey
  return (
    <div className={styles.metric}>
      <Tile
        label="Altman Z-Score"
        value={altman.score.toFixed(2)}
        tone={tone}
        tip={
          <InfoTip label="Cos’è l’Altman Z-Score" source="Bilanci annuali (Finnhub) e capitalizzazione di mercato" formula="1,2·(capitale circolante/attivo) + 1,4·(utili non distribuiti/attivo) + 3,3·(EBIT/attivo) + 0,6·(capitalizzazione/debiti) + 1,0·(ricavi/attivo). Sopra 2,99 zona sicura, sotto 1,81 zona di rischio">
            <strong>Altman Z-Score</strong>
            <span>Misura la solidità finanziaria di un’azienda. Più è alto, più è lontano il rischio di fallimento.</span>
            <span>Pensato per aziende industriali: per banche e assicurazioni va letto con cautela.</span>
          </InfoTip>
        }
      />
      <p className={styles.caption}>
        <strong>{strong}</strong> {rest}
      </p>
    </div>
  )
}

export function FairValueCard({ input, altman = null, embedded = false }: { input: FairValueInput; altman?: AltmanResult | null; embedded?: boolean }) {
  const result = fairValue(input)
  if (!result && !altman) return null
  const tone: Tone | null = result ? (Math.abs(result.premiumPct) < 5 ? 'flat' : result.premiumPct >= 0 ? 'loss' : 'gain') : null

  return (
    <section className={`${styles.card} ${embedded ? styles.embedded : ''}`} aria-label="Valore equo e solidità">
      <div className={styles.grid}>
        {result && tone && (
          <div className={styles.metric}>
            <Tile
              label="Valore equo medio"
              value={result.average.toFixed(2)}
              tone={tone}
              tip={
                <InfoTip
                  label="Come è calcolato il valore equo"
                  source="Finnhub (utile per azione, patrimonio per azione, flusso di cassa per azione, crescita degli utili a 5 anni)"
                  formula="media di: √(22,5 × utile × patrimonio per azione) · utile × (8,5 + 2 × crescita) × 4,4 ÷ 4,5 · utile × (crescita + dividendo) · flussi di cassa scontati al 9% su 10 anni. La crescita è limitata a 15%; i modelli senza dati validi sono esclusi"
                >
                  <strong>Valore equo</strong>
                  <span>Il prezzo che, secondo alcuni metodi classici, l’azione dovrebbe avere in base a utili, patrimonio e cassa generata.</span>
                  <span>È una stima, non una previsione: i metodi sono prudenti e penalizzano le aziende con poca crescita passata o molto capitale intangibile.</span>
                </InfoTip>
              }
            />
            <p className={styles.caption}>
              {tone === 'flat' ? (
                <>
                  Il prezzo attuale {input.price.toFixed(2)} è <strong>vicino</strong> al valore equo.
                </>
              ) : (
                <>
                  Il prezzo attuale {input.price.toFixed(2)} è <strong>{Math.abs(result.premiumPct).toFixed(2)}% {result.premiumPct >= 0 ? 'sopra' : 'sotto'}</strong> il valore equo.
                </>
              )}
            </p>
          </div>
        )}
        {altman && <AltmanBlock altman={altman} />}
      </div>
      {result && (
        <details className={styles.details}>
          <summary>Come si arriva a {result.average.toFixed(2)}</summary>
          <ul className={styles.models}>
            {result.models.map((m) => (
              <li key={m.key}>
                <span>{m.label}</span>
                <span>${m.value.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
