'use client'

import Link from 'next/link'
import { Fragment, useState } from 'react'
import { AlertBell } from '@/components/AlertBell'
import { AlertSwitch } from '@/components/AlertSwitch'
import { ChartChecklist } from '@/components/ChartChecklist'
import { ScanChart } from '@/components/ScanChart'
import { MinerviniAiAnalysis } from '@/components/MinerviniAiAnalysis'
import { InfoTip } from '@/components/InfoTip'
import { PivotGauge } from '@/components/PivotGauge'
import { MARKET_TEXT, VERDICT, fmtNum as num, fmtPrice as price, sentence, type ScanRow } from '@/lib/scan-verdict'
import { tradePlan, withContext, type Caution, type MarketLevel, type PlanNote, type TradePlan } from '@/lib/scanner'
import styles from './ScannerTable.module.css'

export type ScannerRow = ScanRow

type Group = 'full' | 'near'
type ActionFilter = 'all' | 'buy' | 'watch'
type SortKey = 'symbol' | 'action' | 'rs' | 'pivot'
type SortDir = 'asc' | 'desc'

const dash = '—'
const RS_MIN = 70
const RS_FLOORS = [70, 80, 90]
// A row together with what to do about it, after the context of the scan (old data, partial volume, weak market).
interface Item {
  r: ScannerRow
  plan: TradePlan
  note: PlanNote
}

// Null means "no value": those stocks stay last whichever way the column is sorted.
function sortValue(key: SortKey, { r, plan }: Item): string | number | null {
  switch (key) {
    case 'symbol':
      return r.symbol
    case 'rs':
      return r.rs
    case 'action':
      return VERDICT[plan.verdict].rank
    case 'pivot':
      return r.pivotDistancePct === null ? null : Math.abs(r.pivotDistancePct)
  }
}

function comparator(key: SortKey, dir: SortDir) {
  const tie = (a: Item, b: Item) => (b.r.rs ?? -1) - (a.r.rs ?? -1) || a.r.symbol.localeCompare(b.r.symbol)
  return (a: Item, b: Item) => {
    const va = sortValue(key, a)
    const vb = sortValue(key, b)
    if (va === null && vb === null) return tie(a, b)
    if (va === null) return 1
    if (vb === null) return -1
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
    return (dir === 'asc' ? c : -c) || tie(a, b)
  }
}

const COLUMNS: Array<{ key: SortKey | null; label: string; first?: SortDir; tip?: { label: string; body: React.ReactNode } }> = [
  { key: 'symbol', label: 'Titolo', first: 'asc' },
  {
    key: 'action',
    label: 'Cosa fare',
    first: 'asc',
    tip: {
      label: 'Come leggere Cosa fare',
      body: (
        <>
          <span>
            <strong>Si può comprare</strong>: ha rotto il livello chiave con molti scambi.
          </span>
          <span>
            <strong>Aspetta conferma</strong>: ha rotto il livello ma con pochi scambi.
          </span>
          <span>
            <strong>Da tenere d’occhio</strong>: è vicino al livello, non l’ha ancora superato.
          </span>
          <span>
            <strong>Troppo tardi</strong>: già salito oltre il 5% dal livello.
          </span>
          <span>
            <strong>Da evitare</strong>: la base si è rotta.
          </span>
        </>
      ),
    },
  },
  {
    key: null,
    label: 'Prezzi',
    tip: {
      label: 'Come leggere i prezzi',
      body: (
        <>
          <span>
            <strong>Compra</strong>: l’intervallo in cui entrare, dal livello chiave fino al 5% sopra. Oltre è troppo tardi.
          </span>
          <span>
            <strong>Vendi sotto</strong>: lo stop, 8% sotto il prezzo a cui compri. Se il prezzo chiude sotto, si esce senza aspettare: limita la perdita a circa l’8%.
          </span>
          <span>
            <strong>Profitto</strong>: dove il metodo di solito incassa, tra +20% e +25% dall’acquisto. Se sale, alza lo stop.
          </span>
        </>
      ),
    },
  },
  {
    key: 'rs',
    label: 'Forza relativa',
    first: 'desc',
    tip: {
      label: 'Cos’è la forza relativa',
      body: (
        <span>
          Da 0 a 100: quanto il titolo è salito nell’ultimo anno (più peso agli ultimi 3 mesi) rispetto a tutti gli altri scansionati. 90 vuol dire meglio del 90% degli altri. La tacca nella barra è a 70, la soglia del metodo.
        </span>
      ),
    },
  },
  {
    key: 'pivot',
    label: 'Distanza dal pivot',
    first: 'asc',
    tip: {
      label: 'Cos’è la distanza dal pivot',
      body: (
        <span>
          Il pivot è il massimo prima dell’ultimo ribasso della base: il livello chiave da superare. Nella scala la linea è il pivot, la zona verde è l’ingresso (da 0 a 5% sopra) e il punto è il prezzo. La scala va da 10% sotto a 8% sopra.
        </span>
      ),
    },
  },
]

function RsMeter({ rs }: { rs: number | null }) {
  if (rs === null) return <span className={styles.rs}>{dash}</span>
  return (
    <span className={styles.rs}>
      <span className={styles.rsNum}>{Math.round(rs)}</span>
      <span className={styles.rsTrack} aria-hidden>
        <span className={styles.rsFill} style={{ width: `${Math.min(100, Math.max(0, rs))}%` }} />
        <span className={styles.rsTick} style={{ left: `${RS_MIN}%` }} />
      </span>
    </span>
  )
}

function Plan({ plan }: { plan: TradePlan }) {
  if (plan.stop === null || plan.buyFrom === null || plan.buyTo === null || plan.profitFrom === null || plan.profitTo === null) {
    return <span className={styles.none}>{dash}</span>
  }
  return (
    <>
      <span className={styles.planLine}>
        <span className={styles.planLabel}>Compra</span>
        <span className={styles.planValue}>{plan.verdict === 'watch' ? `sopra ${price(plan.buyFrom)}` : `tra ${price(plan.buyFrom)} e ${price(plan.buyTo)}`}</span>
      </span>
      <span className={styles.planLine}>
        <span className={styles.planLabel}>Vendi sotto</span>
        <span className={styles.planValue}>{price(plan.stop)}</span>
        {plan.riskPct !== null && <span className={styles.planNote}>perdita massima circa {num(plan.riskPct)}%</span>}
      </span>
      <span className={styles.planLine}>
        <span className={styles.planLabel}>Profitto</span>
        <span className={styles.planValue}>{`verso ${price(plan.profitFrom)}–${price(plan.profitTo)}`}</span>
      </span>
    </>
  )
}

function Row({ item: { r, plan, note }, bell }: { item: Item; bell: React.ReactNode }) {
  const verdict = VERDICT[plan.verdict]
  const [chartOpen, setChartOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  return (
    <li className={styles.item} data-bell={bell ? '' : undefined}>
      <Link href={`/stock/${r.symbol}`} className={styles.row} data-verdict={plan.verdict}>
        <span className={styles.who}>
          <span className={styles.symbol}>{r.symbol}</span>
          <span className={styles.name}>{r.name}</span>
          <span className={styles.sub}>
            <span>{r.sector ?? dash}</span>
            <span className={styles.price}>{price(r.price)}</span>
          </span>
        </span>
        <span className={styles.cellAction}>
          <span className={styles.chip} data-tone={verdict.tone}>
            {verdict.label}
          </span>
          <span className={styles.sentence}>{sentence(r, plan, note)}</span>
          {note === 'stale' && <span className={styles.stale}>Dati vecchi: controlla il prezzo di oggi prima di comprare.</span>}
        </span>
        <span className={styles.cellPlan}>
          <Plan plan={plan} />
        </span>
        <span className={styles.cellRs}>
          <RsMeter rs={r.rs} />
        </span>
        <span className={styles.cellPivot}>
          <PivotGauge distancePct={r.pivotDistancePct} />
          <span className={styles.pivotText}>
            {r.pivot === null || r.pivotDistancePct === null ? (
              dash
            ) : (
              <>
                <span className={styles.pivotLevel}>{price(r.pivot)}</span> {num(Math.abs(r.pivotDistancePct))}% {r.pivotDistancePct >= 0 ? 'sopra' : 'sotto'}
              </>
            )}
          </span>
        </span>
      </Link>
      {bell && <span className={styles.bell}>{bell}</span>}
      <div className={styles.actions}>
        <button type="button" className={styles.chartToggle} aria-expanded={chartOpen} onClick={() => setChartOpen((o) => !o)}>
          {chartOpen ? 'Nascondi grafico' : 'Mostra grafico'}
        </button>
        <button type="button" className={styles.chartToggle} aria-expanded={aiOpen} onClick={() => setAiOpen((o) => !o)}>
          Analisi AI
        </button>
        <a
          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(r.symbol)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.tvLink}
          aria-label={`Apri ${r.symbol} su TradingView (nuova scheda)`}
        >
          Apri su TradingView
        </a>
      </div>
      {chartOpen && <ScanChart symbol={r.symbol} />}
      {aiOpen && <MinerviniAiAnalysis symbol={r.symbol} autoStart />}
    </li>
  )
}

export function ScannerTable({
  rows,
  caution = null,
  market = null,
  alerts,
}: {
  rows: ScannerRow[]
  caution?: Caution | null
  market?: { abovePct: number; level: MarketLevel } | null
  alerts?: { emailReady: boolean; armed: string[]; newEntrants: boolean }
}) {
  const [group, setGroup] = useState<Group>('full')
  const [action, setAction] = useState<ActionFilter>('all')
  const [query, setQuery] = useState('')
  const [sector, setSector] = useState('')
  const [minRs, setMinRs] = useState(0)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'rs', dir: 'desc' })

  const items: Item[] = rows.map((r) => ({ r, ...withContext(tradePlan(r), { caution, market: market?.level ?? null }) }))
  const full = items.filter((i) => i.r.passedCount >= 8)
  const near = items.filter((i) => i.r.passedCount === 7)
  const inGroup = group === 'full' ? full : near
  const buys = full.filter((i) => i.plan.verdict === 'buy').sort((a, b) => (b.r.rs ?? -1) - (a.r.rs ?? -1))
  const sectors = [...new Set(rows.map((r) => r.sector).filter((s): s is string => s !== null))].sort((a, b) => a.localeCompare(b))
  const needle = query.trim().toLowerCase()
  const filtersActive = action !== 'all' || needle !== '' || sector !== '' || minRs > 0

  const matchesAction = ({ plan }: Item) => {
    if (action === 'all') return true
    return action === 'buy' ? plan.verdict === 'buy' : plan.verdict === 'watch' || plan.verdict === 'confirm' || plan.verdict === 'noisy'
  }

  const shown = inGroup
    .filter(matchesAction)
    .filter(({ r }) => needle === '' || r.symbol.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle))
    .filter(({ r }) => sector === '' || r.sector === sector)
    .filter(({ r }) => minRs === 0 || (r.rs !== null && r.rs >= minRs))
    .sort(comparator(sort.key, sort.dir))

  function sortBy(key: SortKey) {
    const first = COLUMNS.find((c) => c.key === key)?.first ?? 'asc'
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: first }))
  }

  function reset() {
    setAction('all')
    setQuery('')
    setSector('')
    setMinRs(0)
  }

  const empty = filtersActive
    ? 'Nessun titolo con questi filtri.'
    : group === 'full'
      ? near.length > 0
        ? 'Nessun titolo supera tutti i criteri. Guarda quelli a un criterio dal template.'
        : 'Nessun titolo supera tutti i criteri.'
      : 'Nessun titolo è a un solo criterio dal template.'

  const moreActive = sector !== '' || minRs > 0

  return (
    <div>
      <div className={styles.strip}>
      {market && (
        <p className={styles.market} data-level={market.level}>
          {MARKET_TEXT[market.level](market.abovePct)}
          <InfoTip label="Cos’è la salute del mercato" source="Calcolo dello scanner">
            Quota dei titoli scansionati che stanno sopra le medie a 150 e 200 giorni. Sopra il 60% il mercato è in salute; sotto il 40% è debole e la maggior parte delle rotture fallisce: in quel caso lo scanner non segnala acquisti.
          </InfoTip>
        </p>
      )}
      {full.length > 0 &&
        (buys.length > 0 ? (
          <p className={styles.signal}>
            <span>{caution === 'stale' ? 'Alla scansione, da riverificare con il prezzo di oggi:' : 'Si può comprare ora secondo il metodo:'}</span>{' '}
            {buys.map(({ r, plan }, i) => {
              return (
                <Fragment key={r.symbol}>
                  {i > 0 && '; '}
                  <Link href={`/stock/${r.symbol}`} className={styles.signalLink}>
                    {r.symbol}
                  </Link>{' '}
                  <span className={styles.signalDetail}>
                    (tra {price(plan.buyFrom!)} e {price(plan.buyTo!)}, stop {price(plan.stop!)})
                  </span>
                </Fragment>
              )
            })}
          </p>
        ) : (
          <p className={styles.signalNone}>Nessun titolo da comprare adesso: aspetta che uno rompa il livello chiave con molti scambi.</p>
        ))}
      </div>

      <div className={styles.controls}>
        <div className={styles.group} role="group" aria-label="Gruppo">
          <button type="button" aria-pressed={group === 'full'} onClick={() => setGroup('full')} className={styles.seg}>
            8 su 8 <span className={styles.count}>{full.length}</span>
          </button>
          <button type="button" aria-pressed={group === 'near'} onClick={() => setGroup('near')} className={styles.seg}>
            Quasi, 7 su 8 <span className={styles.count}>{near.length}</span>
          </button>
        </div>
        <InfoTip label="Spiegazione dei gruppi" source="Metodo Minervini">
          <span>
            <strong>8 su 8</strong>: il titolo soddisfa tutti i criteri del Trend Template, cioè è in una tendenza rialzista solida.
          </span>
          <span>
            <strong>Quasi, 7 su 8</strong>: ne manca uno, di solito titoli che stanno entrando in tendenza.
          </span>
        </InfoTip>
        <p className={styles.shown} aria-live="polite">
          Mostro {shown.length} di {inGroup.length}
        </p>
      </div>

      <div className={styles.filters}>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca titolo" aria-label="Cerca titolo" className={styles.search} />
        <div className={styles.group} role="group" aria-label="Cosa fare">
          {(
            [
              ['all', 'Tutti'],
              ['buy', 'Si può comprare'],
              ['watch', 'Da tenere d’occhio'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={action === key} onClick={() => setAction(key)} className={styles.pill}>
              {label}
            </button>
          ))}
        </div>
        <details className={styles.more} open={moreActive || undefined}>
          <summary className={styles.moreSummary}>Altri filtri{moreActive ? ' •' : ''}</summary>
          <div className={styles.moreBody}>
            <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Settore" className={styles.select}>
              <option value="">Tutti i settori</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select value={minRs} onChange={(e) => setMinRs(Number(e.target.value))} aria-label="RS minima" className={styles.select}>
              <option value={0}>RS qualsiasi</option>
              {RS_FLOORS.map((v) => (
                <option key={v} value={v}>
                  {`RS almeno ${v}`}
                </option>
              ))}
            </select>
            <select value={sort.key} onChange={(e) => sortBy(e.target.value as SortKey)} aria-label="Ordina per" className={`${styles.select} ${styles.sortSelect}`}>
              {COLUMNS.filter((c) => c.key !== null).map((c) => (
                <option key={c.key} value={c.key!}>
                  {`Ordina per ${c.label.toLowerCase()}`}
                </option>
              ))}
            </select>
            {alerts && <AlertSwitch enabled={alerts.newEntrants} emailReady={alerts.emailReady} />}
          </div>
        </details>
        {filtersActive && (
          <button type="button" onClick={reset} className={styles.reset}>
            Azzera filtri
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <>
          <div className={styles.cols} role="group" aria-label="Ordina le colonne">
            {COLUMNS.map((c) => (
              <span key={c.label} className={styles.colCell}>
                {c.key === null ? (
                  <span className={styles.colLabel}>{c.label}</span>
                ) : (
                  <button type="button" onClick={() => sortBy(c.key!)} className={styles.colButton} data-sort={sort.key === c.key ? sort.dir : undefined}>
                    {c.label}
                    <span className={styles.arrow} aria-hidden />
                  </button>
                )}
                {c.tip && (
                  <InfoTip label={c.tip.label} source="Metodo Minervini" align={c.key === 'pivot' ? 'right' : 'left'}>
                    {c.tip.body}
                  </InfoTip>
                )}
              </span>
            ))}
          </div>
          <ul className={styles.list}>
            {shown.map((item) => (
              <Row
                key={item.r.symbol}
                item={item}
                bell={alerts && item.r.passedCount >= 7 && item.plan.verdict !== 'buy' ? <AlertBell symbol={item.r.symbol} armed={alerts.armed.includes(item.r.symbol)} emailReady={alerts.emailReady} /> : null}
              />
            ))}
          </ul>
          <ChartChecklist />
          <p className={styles.footnote}>
            Vendi se il prezzo chiude sotto lo stop: è ciò che limita la perdita. Se il titolo sale, alza lo stop e incassa un po’ alla volta. Indicazioni calcolate con le regole del metodo: non è consulenza finanziaria.
          </p>
        </>
      )}
    </div>
  )
}
