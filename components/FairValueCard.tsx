import { fairValue, type FairValueInput } from '@/lib/fair-value'
import type { AltmanResult } from '@/lib/solidity'
import { InfoTip } from './InfoTip'
import styles from './FairValueCard.module.css'

export function FairValueCard({ input, altman = null }: { input: FairValueInput; altman?: AltmanResult | null }) {
  const result = fairValue(input)
  if (!result) return null
  const { average, premiumPct, models } = result
  const above = premiumPct >= 0
  const near = Math.abs(premiumPct) < 5
  const tone = near ? styles.flat : above ? styles.loss : styles.gain

  return (
    <section className={styles.card} aria-labelledby="fair-value-title">
      <h2 id="fair-value-title" className={styles.title}>
        Valore equo stimato
        <InfoTip
          label="Come è calcolato il valore equo"
          source="Finnhub (utile per azione, patrimonio per azione, flusso di cassa per azione, crescita degli utili a 5 anni)"
          formula="media di: √(22,5 × utile × patrimonio per azione) · utile × (8,5 + 2 × crescita) × 4,4 ÷ 4,5 · utile × (crescita + dividendo) · flussi di cassa scontati al 9% su 10 anni. La crescita è limitata a 15%; i modelli senza dati validi sono esclusi"
        >
          <strong>Valore equo</strong>
          <span>Il prezzo che, secondo alcuni metodi classici, l’azione dovrebbe avere in base a utili, patrimonio e cassa generata.</span>
          <span>È una stima, non una previsione: i metodi sono prudenti e penalizzano le aziende con poca crescita passata o molto capitale intangibile.</span>
        </InfoTip>
      </h2>
      <p className={styles.value}>
        ${average.toFixed(2)}
        <span className={`${styles.gap} ${tone}`}>
          {near ? 'Prezzo vicino al valore equo' : `Prezzo attuale $${input.price.toFixed(2)}: ${Math.abs(premiumPct).toFixed(1)}% ${above ? 'sopra' : 'sotto'} il valore equo`}
        </span>
      </p>
      <ul className={styles.models}>
        {models.map((m) => (
          <li key={m.key}>
            <span>{m.label}</span>
            <span>${m.value.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      {altman && (
        <p className={styles.altman}>
          Rischio di dissesto (Altman Z): <strong>{altman.score.toFixed(2)}</strong>{' '}
          {altman.zone === 'safe' ? '— rischio basso di fallimento' : altman.zone === 'grey' ? '— zona grigia, situazione incerta' : '— rischio elevato di difficoltà finanziarie'}
        </p>
      )}
    </section>
  )
}
