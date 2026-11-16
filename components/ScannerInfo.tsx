import { TREND_TEMPLATE_LABELS } from '@/lib/minervini'
import styles from './ScannerInfo.module.css'

export function ScannerInfo() {
  return (
    <section className={styles.box} aria-labelledby="scanner-info-title">
      <h2 id="scanner-info-title" className={styles.title}>
        Cosa comprende lo scanner
      </h2>
      <dl className={styles.list}>
        <div>
          <dt>Dove cerca</dt>
          <dd>I circa 500 titoli dell’S&amp;P 500, le maggiori società quotate negli Stati Uniti. Società più piccole e mercati fuori dagli USA restano fuori.</dd>
        </div>
        <div>
          <dt>Cosa controlla</dt>
          <dd>
            Gli 8 criteri del Trend Template di Minervini, gli stessi della scheda di ogni titolo:
            <ol className={styles.criteria}>
              {TREND_TEMPLATE_LABELS.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ol>
          </dd>
        </div>
        <div>
          <dt>Forza relativa</dt>
          <dd>
            Posizione del titolo da 0 a 100 rispetto a tutti gli altri titoli scansionati, sul rendimento dell’ultimo anno con peso doppio all’ultimo trimestre. È un’approssimazione del rating IBD, non è lo stesso numero.
          </dd>
        </div>
        <div>
          <dt>VCP e pivot</dt>
          <dd>Ricerca automatica di ribassi sempre più piccoli prima di una possibile rottura, con il livello del pivot. Segnala candidati da verificare sul grafico, non punti d’acquisto.</dd>
        </div>
        <div>
          <dt>Cosa non controlla</dt>
          <dd>Utili, ricavi e altri fondamentali, notizie, liquidità degli scambi. Si guardano nella scheda del titolo.</dd>
        </div>
        <div>
          <dt>Dati</dt>
          <dd>Prezzi giornalieri degli ultimi 2 anni da Yahoo Finance. Se la scansione gira a mercato aperto, la barra di oggi è ancora incompleta.</dd>
        </div>
      </dl>
      <p className={styles.disclaimer}>Strumento di ricerca: non è consulenza finanziaria.</p>
    </section>
  )
}
