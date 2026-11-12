import styles from './EvaluationPanel.module.css'
import { InfoTip } from './InfoTip'
import type { Evaluation } from '@/lib/evaluate'

function fmtPct(pct: number | null): string {
  if (pct === null) return '—'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

const SIGNAL_INFO: Record<string, { what: string; how: string; source: string; formula: string }> = {
  short: {
    what: 'Misura la spinta recente del prezzo: dove si trova rispetto al minimo e al massimo dell’ultimo anno e se sta andando meglio o peggio dell’indice S&P 500 nelle ultime 13 settimane.',
    how: 'Positivo: vicino al massimo e più forte del mercato. Negativo: vicino al minimo e più debole. Utile per un orizzonte di settimane o pochi mesi.',
    source: 'Finnhub: prezzo (/quote), minimo/massimo 52 settimane e performance vs S&P 500 a 13 settimane (/stock/metric)',
    formula: 'posizione nel range = (prezzo − minimo 52s) ÷ (massimo 52s − minimo 52s). Positivo: > 80% e performance vs S&P 500 (13 sett.) > 0. Negativo: < 20% e performance < 0. Altrimenti neutro',
  },
  medium: {
    what: 'Riassume cosa consigliano gli analisti (comprare, tenere, vendere) e se l’opinione sta migliorando o peggiorando rispetto al mese prima.',
    how: 'Positivo: la maggioranza consiglia l’acquisto. “In calo” significa che la fiducia sta diminuendo. Utile per un orizzonte di alcuni mesi.',
    source: 'Finnhub, trend raccomandazioni degli analisti (/stock/recommendation)',
    formula: 'punteggio = (2×acquisto forte + acquisto − vendita − 2×vendita forte) ÷ analisti totali. Positivo: > 0,5. Negativo: < −0,5. Altrimenti misto. “In calo/miglioramento” = confronto col mese precedente',
  },
  long: {
    what: 'Valuta la solidità dell’azienda con tre numeri: PEG (prezzo rispetto alla crescita), ROE (redditività) e debito/capitale.',
    how: 'Solidi: PEG ≤ 1, ROE > 15% e debito basso. Deboli: ROE negativo o debito molto alto. Utile per un orizzonte di anni.',
    source: 'Finnhub, PEG, ROE e debito/capitale (/stock/metric)',
    formula: 'Deboli: ROE ≤ 0 oppure debito/capitale ≥ 2. Solidi: PEG ≤ 1 e ROE > 15% e debito/capitale < 1. Altrimenti nella norma',
  },
}

type Tone = 'positive' | 'neutral' | 'negative' | 'unknown'

function toneOf(label: string): Tone {
  const l = label.toLowerCase()
  if (l.includes('non disponibil') || l.includes('nessun dato')) return 'unknown'
  if (l.includes('negativ') || l.includes('deboli')) return 'negative'
  if (l.includes('positiv') || l.includes('solidi')) return 'positive'
  return 'neutral'
}

const VERDICTS: Record<Tone, { title: string; text: string }> = {
  positive: { title: 'Segnali favorevoli', text: 'La maggior parte degli indicatori è a favore del titolo.' },
  neutral: { title: 'Segnali contrastanti', text: 'Alcuni indicatori sono positivi, altri no: meglio osservare ancora.' },
  negative: { title: 'Serve prudenza', text: 'La maggior parte degli indicatori è sfavorevole in questo momento.' },
  unknown: { title: 'Dati insufficienti', text: 'Non ci sono abbastanza dati per un giudizio complessivo.' },
}

function overallTone(tones: Tone[], upsidePct: number | null, newsAdjustment = 0): Tone {
  const known = tones.filter((t) => t !== 'unknown')
  if (known.length === 0) return 'unknown'
  let score = known.reduce((acc, t) => acc + (t === 'positive' ? 1 : t === 'negative' ? -1 : 0), 0)
  if (upsidePct !== null) score += upsidePct >= 15 ? 1 : upsidePct <= -15 ? -1 : 0
  score += newsAdjustment
  return score >= 2 ? 'positive' : score <= -2 ? 'negative' : 'neutral'
}

function AnalystBar({ m }: { m: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } }) {
  const total = m.strongBuy + m.buy + m.hold + m.sell + m.strongSell
  if (total === 0) return null
  const segments = [
    { n: m.strongBuy, cls: styles.segStrongBuy, name: 'Acquisto forte' },
    { n: m.buy, cls: styles.segBuy, name: 'Acquisto' },
    { n: m.hold, cls: styles.segHold, name: 'Neutrale' },
    { n: m.sell, cls: styles.segSell, name: 'Vendita' },
    { n: m.strongSell, cls: styles.segStrongSell, name: 'Vendita forte' },
  ]
  return (
    <div className={styles.analystBar} role="img" aria-label={segments.map((s) => `${s.name}: ${s.n}`).join(', ')}>
      {segments.map((s) => s.n > 0 && <span key={s.name} className={s.cls} style={{ flexGrow: s.n }} />)}
    </div>
  )
}

export function EvaluationPanel({ evaluation }: { evaluation: Evaluation }) {
  const { sinceWatching, shortTerm, mediumTerm, longTerm, targetPrice } = evaluation
  const signals = [
    { key: 'short', title: 'Breve termine', result: shortTerm },
    { key: 'medium', title: 'Medio termine', result: mediumTerm },
    { key: 'long', title: 'Lungo termine', result: longTerm },
  ]

  const tones = signals.map((x) => toneOf(x.result.label))
  const overall = overallTone(tones, targetPrice.upsidePct, evaluation.newsImpact.adjustment)
  const verdict = VERDICTS[overall]

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>
        Valutazione
        <InfoTip label="Come leggere la valutazione" source="calcolo interno (lib/evaluate.ts) sui dati Finnhub mostrati nella scheda" formula="punteggio = +1 per ogni segnale positivo, −1 per ogni negativo (breve, medio, lungo) + 1 se l’upside del target è ≥ +15%, −1 se ≤ −15% + 1 se il saldo delle notizie analizzate dall’IA (positive − negative, solo confidenza alta, intensità ≥ 3, ultimi 7 giorni) è ≥ +2, −1 se ≤ −2. Punteggio ≥ 2: “Segnali favorevoli”; ≤ −2: “Serve prudenza”; altrimenti “Segnali contrastanti”" align="right">
          <strong>Valutazione complessiva</strong>
          <span>Sintetizza i tre segnali (breve, medio, lungo termine) e il target price in un solo colpo d’occhio: ogni barra è un segnale, verde buono, ambra neutro, rosso debole.</span>
          <span>È un aiuto per orientarsi, calcolato in automatico: non è una raccomandazione di acquisto o vendita.</span>
        </InfoTip>
      </h2>

      <div className={`${styles.verdict} ${styles[`v_${overall}`]}`}>
        <div className={styles.meter} aria-hidden="true">
          {tones.map((t, i) => (
            <span key={i} className={`${styles.meterBar} ${styles[`m_${t}`]}`} />
          ))}
        </div>
        <p className={styles.verdictTitle}>{verdict.title}</p>
        <p className={styles.verdictText}>{verdict.text}</p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>
            Da quando lo segui
            <InfoTip label="Cos’è Da quando lo segui" source="prezzi salvati nel tuo database a ogni Refresh (prima rilevazione vs ultima)" formula="(ultimo prezzo − primo prezzo salvato) ÷ primo prezzo × 100" align="right">
              <strong>Da quando lo segui</strong>
              <span>Di quanto è cambiato il prezzo da quando hai aggiunto il titolo alla watchlist.</span>
              <span>Serve a vedere il tuo andamento personale, indipendentemente dai segnali. Non entra nel giudizio.</span>
            </InfoTip>
          </span>
          <span className={styles.value}>{fmtPct(sinceWatching.pct)}</span>
        </div>
        <p className={styles.note}>{sinceWatching.note}</p>
      </div>

      {signals.map(({ key, title, result }, i) => (
        <div className={`${styles.row} ${styles[`r_${tones[i]}`]}`} key={key}>
          <div className={styles.rowHead}>
            <span className={styles.label}>
              {title}
              <InfoTip label={`Cos’è il segnale ${title.toLowerCase()}`} source={SIGNAL_INFO[key].source} formula={SIGNAL_INFO[key].formula} align="right">
                <strong>Segnale a {title.toLowerCase()}</strong>
                <span>{SIGNAL_INFO[key].what}</span>
                <span>{SIGNAL_INFO[key].how}</span>
              </InfoTip>
            </span>
            <span className={`${styles.value} ${styles.signal} ${styles[toneOf(result.label)]}`}>{result.label}</span>
          </div>
          {key === 'medium' && <AnalystBar m={mediumTerm} />}
          <p className={styles.note}>{result.note}</p>
        </div>
      ))}

      <div className={styles.target}>
        <div className={styles.targetHead}>
          <span>
            Target price stimato
            <InfoTip label="Cos’è il target price" source="calcolo interno con EPS TTM e crescita utili a 5 anni da Finnhub (/stock/metric)" formula="target = P/E equo × EPS TTM, con P/E equo = crescita utili 5 anni (%), limitato tra 5 e 40. Upside = (target − prezzo) ÷ prezzo × 100" align="right">
              <strong>Target price stimato</strong>
              <span>Un prezzo “equo” calcolato con la formula di Peter Lynch: il P/E giusto è pari alla crescita storica degli utili, moltiplicato per gli utili per azione.</span>
              <span>La percentuale è la distanza dal prezzo attuale. Non è disponibile se gli utili o la crescita sono negativi. Non è una previsione.</span>
            </InfoTip>
          </span>
          {targetPrice.upsidePct !== null && (
            <span className={`${styles.upside} ${targetPrice.upsidePct >= 0 ? styles.upPos : styles.upNeg}`}>
              {fmtPct(targetPrice.upsidePct)} dal prezzo attuale
            </span>
          )}
        </div>
        <p className={`${styles.targetValue} ${targetPrice.upsidePct === null ? '' : targetPrice.upsidePct >= 0 ? styles.upPos : styles.upNeg}`}>{targetPrice.value === null ? '—' : `$${targetPrice.value.toFixed(2)}`}</p>
        <p className={styles.note}>{targetPrice.note}</p>
      </div>

      <p className={styles.newsNote}>Notizie (IA): {evaluation.newsImpact.note}</p>
      <p className={styles.disclaimer}>Indicazione sintetica basata sui dati disponibili, non un consiglio di investimento.</p>
    </section>
  )
}
