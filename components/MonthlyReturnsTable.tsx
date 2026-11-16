import { formatPct } from '@/lib/performance'
import type { SeasonalYear } from '@/lib/seasonality'
import styles from './MonthlyReturnsTable.module.css'

export const MONTH_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

function Cell({ value, partial }: { value: number | null; partial: boolean }) {
  if (value === null) return <td data-empty="true" />
  return (
    <td data-tone={value > 0 ? 'gain' : value < 0 ? 'loss' : 'flat'} data-partial={partial ? 'true' : 'false'}>
      {formatPct(value)}
    </td>
  )
}

export function MonthlyReturnsTable({ rows, currentMonth }: { rows: SeasonalYear[]; currentMonth: number }) {
  if (rows.length === 0) return null

  return (
    <div className={styles.scroll}>
      <table className={styles.table} aria-label="Rendimento mese per mese">
        <thead>
          <tr>
            <th scope="col">Anno</th>
            {MONTH_SHORT.map((month) => (
              <th key={month} scope="col">
                {month}
              </th>
            ))}
            <th scope="col">Totale</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <th scope="row">{row.year}</th>
              {row.months.map((value, month) => (
                <Cell key={month} value={value} partial={row.partial && month === currentMonth} />
              ))}
              <Cell value={row.returnPct} partial={row.partial} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
