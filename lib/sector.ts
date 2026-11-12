import { getProfile } from '@/lib/finnhub'

const TTL_MS = 7 * 24 * 60 * 60 * 1000
const MISS_TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { at: number; sector: string | null }>()

const IT: Record<string, string> = {
  Technology: 'Tecnologia',
  Semiconductors: 'Semiconduttori',
  Banking: 'Banche',
  'Financial Services': 'Servizi finanziari',
  Insurance: 'Assicurazioni',
  Pharmaceuticals: 'Farmaceutico',
  Biotechnology: 'Biotecnologie',
  'Health Care': 'Sanità',
  'Life Sciences Tools & Services': 'Strumenti life science',
  Media: 'Media',
  Communications: 'Comunicazioni',
  Telecommunication: 'Telecomunicazioni',
  Retail: 'Distribuzione',
  Energy: 'Energia',
  'Oil & Gas': 'Petrolio e gas',
  Utilities: 'Servizi di pubblica utilità',
  Automobiles: 'Auto',
  'Consumer products': 'Beni di consumo',
  Beverages: 'Bevande',
  'Food Products': 'Alimentari',
  'Aerospace & Defense': 'Aerospazio e difesa',
  'Real Estate': 'Immobiliare',
  Machinery: 'Macchinari',
  Chemicals: 'Chimica',
  'Metals & Mining': 'Metalli e miniere',
  'Hotels, Restaurants & Leisure': 'Viaggi e ristorazione',
  Airlines: 'Compagnie aeree',
  'Logistics & Transportation': 'Logistica e trasporti',
  Software: 'Software',
}

export function sectorLabel(industry: string): string {
  return IT[industry.trim()] ?? industry.trim()
}

// Sector from the Finnhub profile (free); cached because it almost never changes. Null when the provider does not cover the symbol.
export async function getSector(symbol: string): Promise<string | null> {
  const key = symbol.toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < (hit.sector ? TTL_MS : MISS_TTL_MS)) return hit.sector
  try {
    const { industry } = await getProfile(key)
    const sector = industry ? sectorLabel(industry) : null
    cache.set(key, { at: Date.now(), sector })
    return sector
  } catch {
    return hit?.sector ?? null
  }
}

// Stable hue per sector, so the same sector always gets the same colour.
export function sectorHue(sector: string): number {
  let h = 0
  for (const ch of sector.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
