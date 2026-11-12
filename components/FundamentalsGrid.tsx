import styles from './FundamentalsGrid.module.css'
import { InfoTip } from './InfoTip'
import type { Evaluation } from '@/lib/evaluate'

type Status = 'good' | 'ok' | 'bad' | 'na'

interface MetricView {
  key: string
  name: string
  value: string
  status: Status
  statusLabel: string
  what: string
  why: string
  source: string
  formula: string
  inVerdict: boolean
}

const STATUS_LABEL: Record<Status, string> = {
  good: 'Buono',
  ok: 'Nella norma',
  bad: 'Debole',
  na: 'Non disponibile',
}

function build(details: Evaluation['details']): MetricView[] {
  const { pegRatio, roe, debtToEquity, netMargin, dividendYield, payoutRatio } = details

  const pegOk = pegRatio !== null && pegRatio > 0
  const debtOk = debtToEquity !== null && debtToEquity >= 0

  return [
    {
      key: 'peg',
      name: 'PEG ratio',
      value: pegOk ? pegRatio.toFixed(2) : '—',
      status: !pegOk ? 'na' : pegRatio <= 1 ? 'good' : 'ok',
      statusLabel: !pegOk ? STATUS_LABEL.na : pegRatio <= 1 ? 'Prezzo giusto per la crescita' : 'Prezzo alto per la crescita',
      what: 'Confronta quanto paghi l’azione (P/E) con quanto crescono gli utili. Sotto 1 significa che stai pagando poco la crescita; sopra 1 che il prezzo la anticipa già.',
      why: 'Aiuta a capire se è sottovalutata. È uno dei tre valori che decidono il segnale a lungo termine.',
      source: 'Finnhub, campo pegTTM (/stock/metric)',
      formula: 'PEG = P/E ÷ crescita annua attesa degli utili (%). Giudizio: ≤ 1 buono',
      inVerdict: true,
    },
    {
      key: 'roe',
      name: 'ROE',
      value: roe !== null ? `${roe.toFixed(1)}%` : '—',
      status: roe === null ? 'na' : roe <= 0 ? 'bad' : roe > 15 ? 'good' : 'ok',
      statusLabel: roe === null ? STATUS_LABEL.na : roe <= 0 ? 'In perdita' : roe > 15 ? 'Redditività solida' : 'Redditività media',
      what: 'Quanto guadagna l’azienda per ogni euro investito dagli azionisti. Più è alto, più i soldi degli azionisti rendono.',
      why: 'Mostra se l’azienda è brava a generare profitti. Se è negativo il segnale a lungo termine diventa debole.',
      source: 'Finnhub, campo roeTTM (/stock/metric), ultimi 12 mesi',
      formula: 'ROE = utile netto ÷ patrimonio netto × 100. Giudizio: > 15% solido, ≤ 0 debole',
      inVerdict: true,
    },
    {
      key: 'de',
      name: 'Debito / capitale',
      value: debtOk ? debtToEquity.toFixed(2) : '—',
      status: !debtOk ? 'na' : debtToEquity < 1 ? 'good' : debtToEquity >= 2 ? 'bad' : 'ok',
      statusLabel: !debtOk ? STATUS_LABEL.na : debtToEquity < 1 ? 'Debito basso' : debtToEquity >= 2 ? 'Debito alto' : 'Debito moderato',
      what: 'Quanti debiti ha l’azienda rispetto ai suoi mezzi propri. Sotto 1 i debiti sono inferiori al capitale; sopra 2 pesano molto.',
      why: 'Un debito alto rende l’azienda più fragile quando i tassi salgono o gli utili calano. Conta nel segnale a lungo termine.',
      source: 'Finnhub, campo totalDebt/totalEquityAnnual (/stock/metric), ultimo bilancio annuale',
      formula: 'Debito/capitale = debiti totali ÷ patrimonio netto. Giudizio: < 1 sano, ≥ 2 elevato',
      inVerdict: true,
    },
    {
      key: 'margin',
      name: 'Margine netto',
      value: netMargin !== null ? `${netMargin.toFixed(1)}%` : '—',
      status: netMargin === null ? 'na' : netMargin < 0 ? 'bad' : netMargin >= 15 ? 'good' : 'ok',
      statusLabel: netMargin === null ? STATUS_LABEL.na : netMargin < 0 ? 'In perdita' : netMargin >= 15 ? 'Margine alto' : 'Margine contenuto',
      what: 'Quanto resta di profitto ogni 100 di ricavi, dopo tutti i costi e le tasse.',
      why: 'Un margine alto indica un’azienda forte sul prezzo dei suoi prodotti. Non entra nel giudizio, ma aiuta a leggerlo.',
      source: 'Finnhub, campo netProfitMarginTTM (/stock/metric), ultimi 12 mesi',
      formula: 'Margine netto = utile netto ÷ ricavi × 100',
      inVerdict: false,
    },
    {
      key: 'yield',
      name: 'Dividend yield',
      value: dividendYield !== null ? `${dividendYield.toFixed(2)}%` : '—',
      status: dividendYield === null ? 'na' : dividendYield > 0 ? 'ok' : 'na',
      statusLabel: dividendYield === null || dividendYield <= 0 ? 'Nessun dividendo' : dividendYield >= 2 ? 'Dividendo interessante' : 'Dividendo basso',
      what: 'Quanto ti paga ogni anno l’azienda in dividendi, in percentuale sul prezzo dell’azione.',
      why: 'Conta se cerchi un reddito periodico. Non entra nel giudizio: molte aziende in crescita non pagano dividendi.',
      source: 'Finnhub, campo currentDividendYieldTTM (/stock/metric)',
      formula: 'Dividend yield = dividendo annuo per azione ÷ prezzo × 100',
      inVerdict: false,
    },
    {
      key: 'payout',
      name: 'Payout ratio',
      value: payoutRatio !== null ? `${payoutRatio.toFixed(1)}%` : '—',
      status: payoutRatio === null || payoutRatio <= 0 ? 'na' : payoutRatio > 100 ? 'bad' : payoutRatio > 60 ? 'ok' : 'good',
      statusLabel:
        payoutRatio === null || payoutRatio <= 0 ? 'Nessun dividendo' : payoutRatio > 100 ? 'Dividendo a rischio' : payoutRatio > 60 ? 'Quota alta degli utili' : 'Dividendo sostenibile',
      what: 'Quota degli utili che l’azienda distribuisce come dividendo. Oltre il 100% sta pagando più di quanto guadagna.',
      why: 'Dice se il dividendo è sostenibile nel tempo. Non entra nel giudizio.',
      source: 'Finnhub, campo payoutRatioTTM (/stock/metric), ultimi 12 mesi',
      formula: 'Payout = dividendi pagati ÷ utile netto × 100',
      inVerdict: false,
    },
  ]
}

export function FundamentalsGrid({ details }: { details: Evaluation['details'] }) {
  return (
    <section aria-labelledby="fundamentals-title">
      <h2 id="fundamentals-title" className={styles.title}>
        Fondamentali
      </h2>
      <p className={styles.hint}>Passa sopra la i accanto al nome (o toccala) per capire cos’è e come pesa nella valutazione.</p>
      <ul className={styles.grid}>
        {build(details).map((m) => (
          <li key={m.key} className={`${styles.card} ${styles[m.status]}`}>
            <div className={styles.head}>
              <span className={styles.name}>
                {m.name}
                <InfoTip label={`Cos’è ${m.name}`} source={m.source} formula={m.formula} align={m.key === 'de' || m.key === 'payout' ? 'right' : 'left'}>
                  <strong>{m.name}</strong>
                  <span>{m.what}</span>
                  <span>{m.why}</span>
                </InfoTip>
              </span>
              <span className={styles.badge}>{m.inVerdict ? 'Nel giudizio' : 'Informativo'}</span>
            </div>
            <p className={styles.value}>{m.value}</p>
            <p className={styles.status}>{m.statusLabel}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
