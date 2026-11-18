import type { ReactNode } from 'react'
import { TREND_TEMPLATE_LABELS } from '@/lib/minervini'
import styles from './ScannerInfo.module.css'

export function ScannerInfo({ defaultOpen = false, status }: { defaultOpen?: boolean; status?: ReactNode }) {
  return (
    <details className={styles.info} open={defaultOpen}>
      <summary className={styles.summary}>Come funziona</summary>
      <div className={styles.body}>
        {status}
        <p>
          <strong>Quando farla</strong>: a mercato USA chiuso, dopo le 22:30 ora italiana o la mattina dopo. A mercato aperto l’ultima barra è incompleta e il volume è parziale. I dati sono giornalieri: una volta al giorno basta.
        </p>
        <p>
          Il metodo di Mark Minervini compra titoli già in forte salita nel momento in cui superano un livello chiave, il <strong>pivot</strong>, e li vende subito se il prezzo scende sotto uno <strong>stop</strong> deciso in anticipo. Lo scanner cerca questi titoli tra i circa 500 dell’S&amp;P 500.
        </p>
        <p>
          <strong>Cosa fare con un titolo</strong>
        </p>
        <ol className={styles.steps}>
          <li>Cerca i titoli “Si può comprare”: hanno superato il pivot con molti scambi. Poi apri il grafico e fai i controlli indicati sotto la tabella: lo scanner seleziona, la decisione si prende guardando il grafico.</li>
          <li>Compra solo nell’intervallo indicato, dal pivot fino al 5% sopra. Più in alto vuol dire inseguire il prezzo.</li>
          <li>Imposta subito lo stop, 8% sotto il prezzo a cui hai comprato: se il prezzo chiude sotto, vendi senza aspettare. È ciò che limita la perdita.</li>
          <li>Se il titolo sale, alza lo stop e incassa un po’ alla volta, di solito tra +20% e +25% dal prezzo d’acquisto.</li>
        </ol>
        <p>“Da tenere d’occhio” significa che il titolo è pronto ma non ha ancora superato il pivot: non si compra finché non lo supera. “Base poco pulita” vuol dire che la rottura c’è ma la base era rumorosa. “Aspetta conferma”, “Troppo tardi” e “Da evitare” sono motivi per non comprare adesso.</p>
        <p>
          <strong>I criteri</strong>: un titolo è in tendenza solida se passa tutti e 8 i controlli del Trend Template, gli stessi della scheda di ogni titolo.
        </p>
        <ol className={styles.criteria}>
          {TREND_TEMPLATE_LABELS.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>
        <p>
          La <strong>forza relativa</strong> va da 0 a 100 e confronta il rendimento dell’ultimo anno, con peso doppio all’ultimo trimestre, con quello di tutti gli altri titoli scansionati. Approssima il rating IBD, non è lo stesso numero.
        </p>
        <p>
          La scala della <strong>distanza dal pivot</strong> mostra dove si trova il prezzo: la linea è il pivot, la zona verde è l’intervallo d’acquisto e il punto è il prezzo di oggi.
        </p>
        <p>Non guarda utili, ricavi, notizie né liquidità: per quelli apri la scheda del titolo. I prezzi sono giornalieri, degli ultimi 2 anni, da Yahoo Finance; a mercato aperto la barra di oggi è incompleta.</p>
        <p className={styles.disclaimer}>Strumento di ricerca: non è consulenza finanziaria.</p>
      </div>
    </details>
  )
}
