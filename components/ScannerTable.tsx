'use client'

import Link from 'next/link'
import { Fragment, useState } from 'react'
import { InfoTip } from '@/components/InfoTip'
import { PivotGauge } from '@/components/PivotGauge'
import type { VcpStatus } from '@/lib/minervini'
import { tradePlan, type TradePlan, type Verdict } from '@/lib/scanner'
import styles from './ScannerTable.module.css'

export interface ScannerRow {
  symbol: string
  name: string
  sector: string | null
  price: number
  rs: number | null
  passedCount: number
  vcpStatus: VcpStatus | null
  pivot: number | null
  pivotDistancePct: number | null
  volumeRatio: number | null
  missing: string | null
}

type Group = 'full' | 'near'
type ActionFilter = 'all' | 'buy' | 'watch'
type SortKey = 'symbol' | 'action' | 'rs' | 'pivot'
type SortDir = 'asc' | 'desc'

const dash = '—'
const RS_MIN = 70
const RS_FLOORS = [70, 80, 90]
const num = (v: number, digits = 1) => v.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const price = (v: number) => num(v, 2)

const VERDICT: Record<Verdict, { label: string; tone: 'buy' | 'gain' | 'warn' | 'loss' | 'muted'; rank: number }> = {
  buy: { label: 'Si può comprare', tone: 'buy', rank: 0 },
  confirm: { label: 'Aspetta conferma', tone: 'warn', rank: 1 },
  watch: { label: 'Da tenere d’occhio', tone: 'gain', rank: 2 },
  'no-base': { label: 'Nessun punto d’ingresso', tone: 'muted', rank: 3 },
  late: { label: 'Troppo tardi', tone: 'warn', rank: 4 },
  almost: { label: 'Non ancora pronto', tone: 'muted', rank: 5 },
  broken: { label: 'Da evitare', tone: 'loss', rank: 6 },
}

function sentence(r: ScannerRow, plan: TradePlan): string {
  const pivot = r.pivot === null ? '' : price(r.pivot)
  switch (plan.verdict) {
    case 'buy':
      return `Il prezzo ha superato il livello chiave (${pivot}) con scambi forti${r.volumeRatio !== null ? ` (+${Math.round((r.volumeRatio - 1) * 100)}% sulla media)` : ''}. Per il metodo è il momento d’ingresso.`
    case 'confirm':
      return `Ha superato il livello chiave (${pivot}) ma con pochi scambi: queste rotture spesso falliscono. Meglio aspettare una conferma.`
    case 'watch':
      return `È in forma ma non ha ancora superato il livello chiave (${pivot}). Si compra solo se lo supera con scambi forti.`
    case 'late':
      return 'È già oltre il 5% sopra il livello chiave: comprare ora vuol dire inseguire il prezzo. Aspetta una nuova base.'
    case 'broken':
      return 'È sceso sotto l’ultimo minimo della base: il setup è saltato.'
    case 'no-base':
      return 'Trend forte ma nessuna base da cui entrare. Aspetta che il prezzo si fermi e ne formi una.'
    case 'almost':
      return `Manca un criterio: ${r.missing ?? 'uno dei controlli'}. Non è ancora in una tendenza solida.`
  }
}

// Null means "no value": those stocks stay last whichever way the column is sorted.
function sortValue(key: SortKey, r: ScannerRow): string | number | null {
  switch (key) {
    case 'symbol':
      return r.symbol
    case 'rs':
      return r.rs
    case 'action':
      return VERDICT[tradePlan(r).verdict].rank
    case 'pivot':
      return r.pivotDistancePct === null ? null : Math.abs(r.pivotDistancePct)
  }
}

function comparator(key: SortKey, dir: SortDir) {
  const tie = (a: ScannerRow, b: ScannerRow) => (b.rs ?? -1) - (a.rs ?? -1) || a.symbol.localeCompare(b.symbol)
  return (a: ScannerRow, b: ScannerRow) => {
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
            <strong>Vendi sotto</strong>: lo stop, circa 8% sotto il livello chiave. Se il prezzo chiude sotto, si esce senza aspettare: limita la perdita.
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

function Row({ r }: { r: ScannerRow }) {
  const plan = tradePlan(r)
  const verdict = VERDICT[plan.verdict]
  return (
    <li>
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
          <span className={styles.sentence}>{sentence(r, plan)}</span>
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
    </li>
  )
}

export function ScannerTable({ rows }: { rows: ScannerRow[] }) {
  const [group, setGroup] = useState<Group>('full')
  const [action, setAction] = useState<ActionFilter>('all')
  const [query, setQuery] = useState('')
  const [sector, setSector] = useState('')
  const [minRs, setMinRs] = useState(0)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'rs', dir: 'desc' })

  const full = rows.filter((r) => r.passedCount >= 8)
  const near = rows.filter((r) => r.passedCount === 7)
  const inGroup = group === 'full' ? full : near
  const buys = full.filter((r) => tradePlan(r).verdict === 'buy').sort((a, b) => (b.rs ?? -1) - (a.rs ?? -1))
  const sectors = [...new Set(rows.map((r) => r.sector).filter((s): s is string => s !== null))].sort((a, b) => a.localeCompare(b))
  const needle = query.trim().toLowerCase()
  const filtersActive = action !== 'all' || needle !== '' || sector !== '' || minRs > 0

  const matchesAction = (r: ScannerRow) => {
    if (action === 'all') return true
    const verdict = tradePlan(r).verdict
    return action === 'buy' ? verdict === 'buy' : verdict === 'watch' || verdict === 'confirm'
  }

  const shown = inGroup
    .filter(matchesAction)
    .filter((r) => needle === '' || r.symbol.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle))
    .filter((r) => sector === '' || r.sector === sector)
    .filter((r) => minRs === 0 || (r.rs !== null && r.rs >= minRs))
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

  return (
    <div>
      {full.length > 0 &&
        (buys.length > 0 ? (
          <p className={styles.signal}>
            <span>Si può comprare ora secondo il metodo:</span>{' '}
            {buys.map((r, i) => {
              const plan = tradePlan(r)
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
        <select value={sort.key} onChange={(e) => sortBy(e.target.value as SortKey)} aria-label="Ordina per" className={`${styles.select} ${styles.sortSelect}`}>
          {COLUMNS.filter((c) => c.key !== null).map((c) => (
            <option key={c.key} value={c.key!}>
              {`Ordina per ${c.label.toLowerCase()}`}
            </option>
          ))}
        </select>
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
            {shown.map((r) => (
              <Row key={r.symbol} r={r} />
            ))}
          </ul>
          <p className={styles.footnote}>
            Vendi se il prezzo chiude sotto lo stop: è ciò che limita la perdita. Se il titolo sale, alza lo stop e incassa un po’ alla volta. Indicazioni calcolate con le regole del metodo: non è consulenza finanziaria.
          </p>
        </>
      )}
    </div>
  )
}
