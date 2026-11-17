import { MARKET_TEXT, VERDICT, fmtNum, fmtPrice, sentence, type ScanRow } from '@/lib/scan-verdict'
import type { MarketLevel, PlanNote, TradePlan } from '@/lib/scanner'

// Which stocks an email is about: the armed ones that reached 8 of 8, plus (switch on) the 8-of-8 ones not seen before.
export function collectAlerts(input: { full: string[]; armed: string[]; newEntrantsOn: boolean; knownFull: string[] }): { watched: string[]; entrants: string[] } {
  const full = new Set(input.full)
  const watched = [...new Set(input.armed)].filter((symbol) => full.has(symbol))
  const taken = new Set([...watched, ...input.knownFull])
  const entrants = input.newEntrantsOn ? input.full.filter((symbol) => !taken.has(symbol)) : []
  return { watched, entrants }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export interface EmailItem {
  row: ScanRow
  plan: TradePlan
  note: PlanNote
  reason: 'watched' | 'new'
}

export interface EmailInput {
  items: EmailItem[]
  market: { abovePct: number; level: MarketLevel } | null
  sessionScan: boolean
  appUrl: string | null
}

const REASON = { watched: 'Lo seguivi', new: 'Nuovo negli 8 su 8' } as const
const DISCLAIMER = 'Indicazioni calcolate con le regole del metodo: non è consulenza finanziaria.'
const SESSION_WARNING = 'Scansione fatta a mercato aperto: il volume di oggi è parziale, quindi nessun titolo è segnalato come da comprare.'
const NO_PRICES = 'Prezzi: nessuno, al momento non c’è un punto d’ingresso.'

// Same colours as the chips on the page, tuned for a white background.
const TONES: Record<'buy' | 'gain' | 'warn' | 'loss' | 'muted', { bg: string; fg: string }> = {
  buy: { bg: '#0f9d58', fg: '#ffffff' },
  gain: { bg: '#e6f4ea', fg: '#137333' },
  warn: { bg: '#fef3c7', fg: '#92400e' },
  loss: { bg: '#fce8e6', fg: '#b3261e' },
  muted: { bg: '#eceff1', fg: '#455a64' },
}

interface Line {
  label: string
  value: string
  note?: string
}

function priceLines(plan: TradePlan): Line[] {
  const { buyFrom, buyTo, stop, riskPct, profitFrom, profitTo } = plan
  if (buyFrom === null || buyTo === null || stop === null || profitFrom === null || profitTo === null) return []
  return [
    { label: 'Compra', value: plan.verdict === 'watch' ? `sopra ${fmtPrice(buyFrom)}` : `tra ${fmtPrice(buyFrom)} e ${fmtPrice(buyTo)}` },
    { label: 'Vendi sotto', value: fmtPrice(stop), note: riskPct === null ? undefined : `perdita massima circa ${fmtNum(riskPct)}%` },
    { label: 'Profitto', value: `verso ${fmtPrice(profitFrom)}–${fmtPrice(profitTo)}` },
  ]
}

function detailLines(row: ScanRow): Line[] {
  const lines: Line[] = [{ label: 'Forza relativa', value: row.rs === null ? '—' : String(Math.round(row.rs)) }]
  if (row.pivot !== null && row.pivotDistancePct !== null) {
    lines.push({ label: 'Pivot', value: `${fmtPrice(row.pivot)}, ${fmtNum(Math.abs(row.pivotDistancePct))}% ${row.pivotDistancePct >= 0 ? 'sopra' : 'sotto'}` })
  }
  if (row.volumeRatio !== null) {
    lines.push({ label: 'Volume', value: `${row.volumeRatio >= 1 ? '+' : '−'}${Math.round(Math.abs(row.volumeRatio - 1) * 100)}% sulla media` })
  }
  return lines
}

const linkFor = (appUrl: string | null, symbol: string) => (appUrl ? `${appUrl.replace(/\/+$/, '')}/stock/${encodeURIComponent(symbol)}` : null)
const headline = ({ row }: EmailItem) => `${row.symbol} - ${row.name}${row.sector ? ` (${row.sector})` : ''}, prezzo ${fmtPrice(row.price)}`

function itemText(item: EmailItem, appUrl: string | null): string {
  const { row, plan, note, reason } = item
  const lines = [headline(item), `Motivo: ${REASON[reason]}`, `Cosa fare: ${VERDICT[plan.verdict].label}`, sentence(row, plan, note)]
  const prices = priceLines(plan)
  if (prices.length === 0) lines.push(NO_PRICES)
  for (const p of prices) lines.push(`${p.label}: ${p.value}${p.note ? ` (${p.note})` : ''}`)
  for (const d of detailLines(row)) lines.push(`${d.label}: ${d.value}`)
  const link = linkFor(appUrl, row.symbol)
  if (link) lines.push(`Scheda: ${link}`)
  return lines.join('\n')
}

const e = escapeHtml

function itemHtml(item: EmailItem, appUrl: string | null): string {
  const { row, plan, note, reason } = item
  const verdict = VERDICT[plan.verdict]
  const tone = TONES[verdict.tone]
  const prices = priceLines(plan)
  const priceRows =
    prices.length === 0
      ? `<p style="margin:0 0 10px;color:#5f6368;font-size:14px">Al momento non c’è un punto d’ingresso.</p>`
      : `<table role="presentation" style="border-collapse:collapse;margin:0 0 10px">${prices
          .map(
            (p) =>
              `<tr><td style="padding:2px 14px 2px 0;color:#5f6368;font-size:13px">${e(p.label)}</td><td style="padding:2px 0;font-size:15px;font-weight:600">${e(p.value)}${
                p.note ? ` <span style="font-weight:400;color:#5f6368;font-size:13px">(${e(p.note)})</span>` : ''
              }</td></tr>`,
          )
          .join('')}</table>`
  const details = detailLines(row)
    .map((d) => `<span style="white-space:nowrap">${e(d.label)}: <strong>${e(d.value)}</strong></span>`)
    .join(' &middot; ')
  const link = linkFor(appUrl, row.symbol)
  return `<div style="border:1px solid #e2e5e9;border-radius:12px;padding:16px;margin:0 0 16px">
<p style="margin:0 0 2px;font-size:18px;font-weight:700">${e(row.symbol)} <span style="font-weight:400;color:#5f6368;font-size:14px">${e(row.name)}${row.sector ? ` &middot; ${e(row.sector)}` : ''}</span></p>
<p style="margin:0 0 10px;color:#5f6368;font-size:13px">Prezzo ${e(fmtPrice(row.price))} &middot; ${e(REASON[reason])}</p>
<p style="margin:0 0 8px"><span style="display:inline-block;padding:3px 12px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-size:14px;font-weight:700">${e(verdict.label)}</span></p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${e(sentence(row, plan, note))}</p>
${priceRows}
<p style="margin:0 0 ${link ? '10px' : '0'};color:#3c4043;font-size:13px;line-height:1.6">${details}</p>
${link ? `<p style="margin:0"><a href="${e(link)}" style="color:#0b57d0;font-size:14px">Apri la scheda di ${e(row.symbol)}</a></p>` : ''}
</div>`
}

function subjectFor(items: EmailItem[]): string {
  const symbols = items.map((i) => i.row.symbol)
  return items.length === 1 ? `Scanner Minervini: ${symbols[0]} ha raggiunto 8 su 8` : `Scanner Minervini: ${items.length} titoli hanno raggiunto 8 su 8 (${symbols.join(', ')})`
}

export function buildScanEmail(input: EmailInput): { subject: string; text: string; html: string } {
  const items = [...input.items].sort((a, b) => (b.row.rs ?? -1) - (a.row.rs ?? -1))
  const marketLine = input.market ? MARKET_TEXT[input.market.level](input.market.abovePct) : null
  const intro = [marketLine, input.sessionScan ? SESSION_WARNING : null].filter((l): l is string => l !== null)

  const text = [...(intro.length > 0 ? [intro.join('\n'), ''] : []), items.map((i) => itemText(i, input.appUrl)).join('\n\n'), '', DISCLAIMER].join('\n')

  const introHtml = intro.map((l) => `<p style="margin:0 0 10px;color:#5f6368;font-size:14px">${e(l)}</p>`).join('')
  const html = `<!doctype html><html lang="it"><body style="margin:0;padding:16px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#202124">
<div style="max-width:600px;margin:0 auto">
<h1 style="margin:0 0 12px;font-size:18px">${e(subjectFor(items))}</h1>
${introHtml}
${items.map((i) => itemHtml(i, input.appUrl)).join('\n')}
<p style="margin:0;color:#5f6368;font-size:12px">${e(DISCLAIMER)}</p>
</div></body></html>`

  return { subject: subjectFor(items), text, html }
}
