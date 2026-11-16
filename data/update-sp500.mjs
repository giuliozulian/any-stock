// Rigenera data/sp500.json dai componenti dell'S&P 500.
// Uso: node data/update-sp500.mjs [url-csv]
import { writeFile } from 'node:fs/promises'

const DEFAULT_URL = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv'
const url = process.argv[2] ?? DEFAULT_URL

function parseLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

const res = await fetch(url)
if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`)
const [header, ...lines] = (await res.text()).split(/\r?\n/).filter(Boolean)
const cols = parseLine(header)
const iSymbol = cols.indexOf('Symbol')
const iName = cols.indexOf('Security')
const iSector = cols.indexOf('GICS Sector')
if ([iSymbol, iName, iSector].includes(-1)) throw new Error(`Unexpected header: ${header}`)

const entries = lines
  .map(parseLine)
  .map((c) => ({ symbol: c[iSymbol].trim().toUpperCase(), name: c[iName].trim(), sector: c[iSector].trim() || null }))
  .filter((e) => e.symbol && e.name)
  .sort((a, b) => a.symbol.localeCompare(b.symbol))

await writeFile(new URL('./sp500.json', import.meta.url), JSON.stringify(entries, null, 2) + '\n')
console.log(`Wrote ${entries.length} companies`)
