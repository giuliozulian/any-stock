import styles from './ChartChecklist.module.css'

export const CHART_CHECKS = [
  {
    title: 'Le oscillazioni si stringono',
    text: 'Guarda gli ultimi saliscendi: devono diventare sempre più piccoli (per esempio -20%, poi -12%, poi -6%). Se le candele restano grandi e irregolari fino a oggi, non comprare.',
  },
  {
    title: 'Gli scambi calano nella base',
    text: 'Le barre del volume, in basso, devono essere basse nelle ultime settimane, senza barre rosse molto alte. Solo oggi una barra verde deve spiccare.',
  },
  {
    title: 'Il livello è netto',
    text: 'Il prezzo deve superare un massimo mai toccato di recente. Se vedi tentativi falliti, con ombre lunghe sopra il livello e poi ritorno sotto, quel massimo è difeso: aspetta.',
  },
  {
    title: 'Non è già in corsa',
    text: 'Il prezzo deve stare vicino alla media a 50 giorni. Se è molto più in alto, ha già fatto gran parte del movimento.',
  },
  {
    title: 'Utili e mercato',
    text: 'Controlla che i prossimi utili non siano nei giorni successivi e che l’indice generale non sia in calo.',
  },
] as const

export function ChartChecklist() {
  return (
    <section className={styles.box} aria-labelledby="chart-check-title">
      <h2 id="chart-check-title" className={styles.title}>
        Prima di comprare, controlla sul grafico
      </h2>
      <p className={styles.lead}>Lo scanner usa solo numeri e non vede la qualità della base. Apri il grafico giornaliero degli ultimi 6 mesi e verifica:</p>
      <div className={styles.list}>
        {CHART_CHECKS.map((c, i) => (
          <p key={c.title} className={styles.item}>
            <strong>
              {i + 1}. {c.title}.
            </strong>{' '}
            {c.text}
          </p>
        ))}
      </div>
      <p className={styles.rule}>Se uno dei primi tre punti non torna, aspetta: non è un ingresso pulito, anche se lo scanner dice “Si può comprare”.</p>
    </section>
  )
}
