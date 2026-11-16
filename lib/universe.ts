import universe from '@/data/sp500.json'

export interface UniverseEntry {
  symbol: string
  name: string
  sector: string | null
}

// Yahoo writes class shares with a dash: BRK.B is BRK-B there.
export function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, '-')
}

export function loadUniverse(): UniverseEntry[] {
  return universe as UniverseEntry[]
}
