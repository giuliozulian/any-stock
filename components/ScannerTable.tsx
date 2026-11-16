'use client'

import Link from 'next/link'
import { useState } from 'react'
import { VCP_STATUS_LABEL, type VcpStatus } from '@/lib/minervini'
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
  missing: string | null
}

const dash = '—'
const num = (v: number, digits = 1) => v.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const distance = (v: number | null) => (v === null ? dash : `${num(Math.abs(v))}% ${v >= 0 ? 'sopra' : 'sotto'}`)

function Rows({ rows, showMissing }: { rows: ScannerRow[]; showMissing: boolean }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Titolo</th>
            <th>Settore</th>
            <th className={styles.num}>Prezzo</th>
            <th className={styles.num}>RS</th>
            <th>VCP</th>
            <th className={styles.num}>Pivot</th>
            <th>Dal pivot</th>
            {showMissing && <th>Manca</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td>
                <Link href={`/stock/${r.symbol}`} className={styles.link}>
                  <strong>{r.symbol}</strong> <span className={styles.name}>{r.name}</span>
                </Link>
              </td>
              <td>{r.sector ?? dash}</td>
              <td className={styles.num}>{num(r.price, 2)}</td>
              <td className={styles.num}>{r.rs === null ? dash : Math.round(r.rs)}</td>
              <td>{r.vcpStatus ? VCP_STATUS_LABEL[r.vcpStatus] : dash}</td>
              <td className={styles.num}>{r.pivot === null ? dash : r.pivot.toFixed(2)}</td>
              <td>{distance(r.pivotDistancePct)}</td>
              {showMissing && <td>{r.missing ?? dash}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const byRs = (a: ScannerRow, b: ScannerRow) => (b.rs ?? -1) - (a.rs ?? -1)

export function ScannerTable({ rows }: { rows: ScannerRow[] }) {
  const [onlyVcp, setOnlyVcp] = useState(false)
  const visible = rows.filter((r) => !onlyVcp || r.vcpStatus === 'forming' || r.vcpStatus === 'breakout')
  const full = visible.filter((r) => r.passedCount >= 8).sort(byRs)
  const near = visible.filter((r) => r.passedCount === 7).sort(byRs)

  return (
    <>
      <label className={styles.filter}>
        <input type="checkbox" checked={onlyVcp} onChange={(e) => setOnlyVcp(e.target.checked)} /> Solo VCP in formazione o in rottura
      </label>
      <section aria-label="8 criteri su 8" className={styles.block}>
        <h2 className={styles.heading}>8 criteri su 8 ({full.length})</h2>
        {full.length === 0 ? <p className={styles.empty}>Nessun titolo supera tutti i criteri.</p> : <Rows rows={full} showMissing={false} />}
      </section>
      <section aria-label="Quasi: 7 criteri su 8" className={styles.block}>
        <h2 className={styles.heading}>Quasi: 7 su 8 ({near.length})</h2>
        {near.length === 0 ? <p className={styles.empty}>Nessun titolo a un criterio dal template.</p> : <Rows rows={near} showMissing />}
      </section>
    </>
  )
}
