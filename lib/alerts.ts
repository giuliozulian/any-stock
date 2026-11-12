export interface Targets {
  entryPrice: number | null
  sellPrice: number | null
  entryTriggeredAt: Date | null
  sellTriggeredAt: Date | null
}

export type AlertKind = 'entry' | 'sell'

// Returns the targets crossed by `price` that have not already notified.
export function checkTargets(targets: Targets, price: number): AlertKind[] {
  const hits: AlertKind[] = []
  if (targets.entryPrice !== null && !targets.entryTriggeredAt && price <= targets.entryPrice) hits.push('entry')
  if (targets.sellPrice !== null && !targets.sellTriggeredAt && price >= targets.sellPrice) hits.push('sell')
  return hits
}

export function validateTargets(entry: number | null, sell: number | null): string | null {
  for (const v of [entry, sell]) {
    if (v !== null && (!Number.isFinite(v) || v <= 0)) return 'Il prezzo deve essere un numero maggiore di zero'
  }
  if (entry !== null && sell !== null && entry >= sell) return 'Il prezzo di ingresso deve essere minore di quello di vendita'
  return null
}
