import { fetchFromSec, getCik } from './edgar-roles'

export interface RecentFiling {
  date: string
  items: string[]
  url: string
}

// 8-K item numbers that can move a stock, in plain Italian. Items not listed here (exhibits, Reg FD...) are ignored.
export const ITEM_LABELS: Record<string, string> = {
  '1.01': 'accordo importante firmato',
  '1.02': 'accordo importante terminato',
  '1.03': 'procedura fallimentare',
  '2.01': 'acquisizione o cessione completata',
  '2.02': 'risultati trimestrali',
  '2.03': 'nuovo debito',
  '2.05': 'ristrutturazione e costi di uscita',
  '2.06': 'svalutazione rilevante',
  '3.01': 'avviso di delisting',
  '4.02': 'bilanci precedenti da rifare',
  '5.01': 'cambio di controllo',
  '5.02': 'cambio di dirigenti o amministratori',
  '8.01': 'altri eventi rilevanti',
}

export function itemLabels(items: string[]): string[] {
  return [...new Set(items.map((i) => ITEM_LABELS[i]).filter((l): l is string => Boolean(l)))]
}

interface Submissions {
  filings?: { recent?: { form?: string[]; filingDate?: string[]; items?: string[]; accessionNumber?: string[]; primaryDocument?: string[] } }
}

// 8-K filings of a US company filed on or after `since` (YYYY-MM-DD), newest first. Null when the symbol is not on EDGAR.
export async function getRecentEightK(symbol: string, since: string): Promise<RecentFiling[] | null> {
  const cik = await getCik(symbol)
  if (cik === null) return null
  const res = await fetchFromSec(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`)
  if (!res.ok) throw new Error(`SEC ${res.status}`)
  const recent = ((await res.json()) as Submissions).filings?.recent
  const forms = recent?.form ?? []
  const out: RecentFiling[] = []
  forms.forEach((form, i) => {
    const date = recent?.filingDate?.[i]
    if (form !== '8-K' || !date || date < since) return
    const accession = (recent?.accessionNumber?.[i] ?? '').replace(/-/g, '')
    out.push({
      date,
      items: (recent?.items?.[i] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/${recent?.primaryDocument?.[i] ?? ''}`,
    })
  })
  return out.sort((a, b) => b.date.localeCompare(a.date))
}
