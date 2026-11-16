import type { DividendFrequency, DividendSummary } from '@/lib/dividends'

const NBSP = ' '
const FREQUENCY_PHRASE: Record<DividendFrequency, string> = {
  monthly: 'ogni mese',
  quarterly: 'ogni trimestre',
  semiannual: "due volte l'anno",
  annual: "una volta l'anno",
  irregular: 'senza cadenza regolare',
}

export function formatDividendAmount(amount: number, currency: string | null): string {
  const digits = { minimumFractionDigits: 2, maximumFractionDigits: 4 }
  const plain = amount.toLocaleString('it-IT', digits)
  // Yahoo quotes London stocks in pence (GBp); formatting that as pounds would be wrong by a factor of 100.
  if (currency === 'GBp') return `${plain}${NBSP}p`
  if (currency) {
    try {
      return amount.toLocaleString('it-IT', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', ...digits })
    } catch {
      // A code Intl does not know: fall through to the bare number.
    }
  }
  return plain
}

const longDate = (t: number) => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export function dividendSentence(summary: DividendSummary, currency: string | null): string {
  const amount = formatDividendAmount(summary.lastPayment.amount, currency)
  const date = longDate(summary.lastPayment.t)
  if (summary.suspended) return `Dividendo sospeso: l'ultimo pagamento è stato di ${amount} il ${date}.`
  const rhythm = summary.frequency ? `Paga ${FREQUENCY_PHRASE[summary.frequency]}. ` : ''
  const yieldPart =
    summary.yieldPct !== null && summary.yieldPct > 0
      ? `, rendimento ${summary.yieldPct.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% sugli ultimi 12 mesi`
      : ''
  return `${rhythm}Ultimo dividendo ${amount} il ${date}${yieldPart}.`
}
