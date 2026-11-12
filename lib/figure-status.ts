export type FigureTone = 'good' | 'ok' | 'bad' | 'na'

export interface FigureStatus {
  tone: FigureTone
  label: string
}

// Soglie indicative: il P/E dipende dal settore, ma sotto 15 è di norma economico e sopra 30 caro.
export function peStatus(pe: number | null): FigureStatus {
  if (pe === null) return { tone: 'na', label: 'Non disponibile' }
  if (pe <= 0) return { tone: 'bad', label: 'Azienda in perdita: il P/E non ha senso' }
  if (pe < 15) return { tone: 'good', label: 'Buono: prezzo basso rispetto agli utili' }
  if (pe <= 30) return { tone: 'ok', label: 'Neutro: prezzo nella media' }
  return { tone: 'bad', label: 'Negativo: prezzo alto rispetto agli utili' }
}

// La capitalizzazione Finnhub è in milioni di dollari. Descrive la dimensione, non un giudizio.
export function marketCapStatus(capMillions: number | null): FigureStatus {
  if (capMillions === null) return { tone: 'na', label: 'Non disponibile' }
  if (capMillions >= 200_000) return { tone: 'ok', label: 'Colosso: di solito molto stabile' }
  if (capMillions >= 10_000) return { tone: 'ok', label: 'Grande azienda: abbastanza stabile' }
  if (capMillions >= 2_000) return { tone: 'ok', label: 'Media azienda: stabilità media' }
  return { tone: 'ok', label: 'Piccola azienda: più volatile' }
}

export function rangeStatus(position: number | null): FigureStatus {
  if (position === null) return { tone: 'na', label: 'Non disponibile' }
  if (position < 0.25) return { tone: 'ok', label: 'Vicino ai minimi annuali: prezzo basso, ma il mercato è cauto' }
  if (position > 0.8) return { tone: 'ok', label: 'Vicino ai massimi annuali: trend forte, meno margine di ingresso' }
  return { tone: 'ok', label: 'A metà del suo intervallo annuale' }
}
