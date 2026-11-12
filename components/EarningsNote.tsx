interface Props {
  date: Date | null
  hour: string | null
  epsEstimate: number | null
  dividendYield: number | null
  now?: Date
}

const HOUR_LABEL: Record<string, string> = {
  bmo: 'prima dell’apertura',
  amc: 'dopo la chiusura',
  dmh: 'durante la seduta',
}

export function earningsCountdown(date: Date, now: Date): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days = Math.round((date.getTime() - today) / 86_400_000)
  if (days <= 0) return 'oggi'
  if (days === 1) return 'domani'
  return `tra ${days} giorni`
}

export function EarningsNote({ date, hour, epsEstimate, dividendYield, now = new Date() }: Props) {
  if (!date && dividendYield === null) return null
  return (
    <p style={{ margin: '0 0 24px', color: 'var(--muted)', fontSize: 15, lineHeight: 1.6 }}>
      {date ? (
        <>
          <strong style={{ color: 'inherit', fontWeight: 600 }}>Prossima trimestrale:</strong>{' '}
          {date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} (
          {earningsCountdown(date, now)}
          {hour && HOUR_LABEL[hour] ? `, ${HOUR_LABEL[hour]}` : ''})
          {epsEstimate !== null ? `, EPS atteso ${epsEstimate.toFixed(2)}` : ''}.
        </>
      ) : (
        'Prossima trimestrale non ancora annunciata.'
      )}
      {dividendYield !== null && dividendYield > 0 ? ` Dividendo: rendimento ${dividendYield.toFixed(2)}%.` : ''}
    </p>
  )
}
