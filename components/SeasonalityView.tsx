'use client'

import { useState } from 'react'
import { formatPct } from '@/lib/performance'
import type { CycleKey, MonthStat, Seasonality, WindowKey } from '@/lib/seasonality'
import { MONTH_SHORT, MonthlyReturnsTable } from '@/components/MonthlyReturnsTable'
import { SeasonalBars } from '@/components/SeasonalBars'
import { SeasonalCurveChart } from '@/components/SeasonalCurveChart'
import styles from './SeasonalityView.module.css'

const WINDOW_LABEL: Record<WindowKey, string> = { '5': '5 anni', '10': '10 anni', '20': '20 anni', all: 'Tutto' }
const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
// Indexed by weekday number: 1 is Monday.
const WEEKDAY_NAMES = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì']
const CYCLE_LABEL: Record<CycleKey, string> = { election: 'Elezione', post: 'Post-elezione', midterm: 'Metà mandato', pre: 'Pre-elezione' }

// Daily averages are a few hundredths of a percent: one decimal would round most of them to zero.
function formatDailyPct(value: number): string {
  const rounded = Number(value.toFixed(2))
  const body = Math.abs(rounded).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${body}%`
}

function monthPhrase(stat: MonthStat, lead: boolean): string {
  const name = MONTH_NAMES[stat.month]
  const average = `in media ${formatPct(stat.avgPct)}.`
  return lead ? `${name} è stato positivo ${stat.positive} ${stat.positive === 1 ? 'anno' : 'anni'} su ${stat.count}, ${average}` : `${name}: ${stat.positive} su ${stat.count}, ${average}`
}

export function SeasonalityView({ data }: { data: Seasonality }) {
  const [windowKey, setWindowKey] = useState<WindowKey>(data.defaultWindow)
  const active = data.windows.find((w) => w.key === windowKey) ?? data.windows[0]
  if (!active) return null

  const sentence = [data.currentMonth, data.nextMonth]
    .map((month) => active.months.find((stat) => stat.month === month))
    .filter((stat): stat is MonthStat => stat !== undefined)
    .map((stat, i) => monthPhrase(stat, i === 0))
    .join(' ')
  const rows = data.years.filter((row) => row.partial || (row.year >= active.fromYear && row.year <= active.toYear))

  return (
    <>
      <section className={styles.card} aria-label="Anni considerati">
        <div className={styles.top}>
          <div className={styles.windows} role="group" aria-label="Anni considerati">
            {data.windows.map((w) => (
              <button key={w.key} type="button" aria-pressed={w.key === active.key} className={`${styles.window} ${w.key === active.key ? styles.windowActive : ''}`} onClick={() => setWindowKey(w.key)}>
                {WINDOW_LABEL[w.key]}
              </button>
            ))}
          </div>
          <span className={styles.period}>{`${active.fromYear}–${active.toYear}`}</span>
        </div>
        {sentence && <p className={styles.sentence}>{sentence}</p>}
      </section>

      <section className={styles.card} aria-labelledby="seasonal-curve-title">
        <h2 id="seasonal-curve-title" className={styles.title}>
          Curva stagionale
        </h2>
        <SeasonalCurveChart curve={active.curve} current={data.currentYearCurve} todayIndex={data.todayIndex} year={data.currentYear} />
      </section>

      {active.months.length > 0 && (
        <section className={styles.card} aria-labelledby="seasonal-months-title">
          <h2 id="seasonal-months-title" className={styles.title}>
            Rendimento medio per mese
          </h2>
          <SeasonalBars
            label="Rendimento medio per mese"
            bars={active.months.map((stat) => ({
              key: String(stat.month),
              label: MONTH_SHORT[stat.month],
              valuePct: stat.avgPct,
              value: formatPct(stat.avgPct),
              detail: `${stat.positive} su ${stat.count}`,
              highlight: stat.month === data.currentMonth || stat.month === data.nextMonth,
            }))}
          />
          <p className={styles.hint}>A destra: anni positivi sul totale. Evidenziati il mese in corso e il successivo.</p>
        </section>
      )}

      <section className={styles.card} aria-labelledby="seasonal-table-title">
        <h2 id="seasonal-table-title" className={styles.title}>
          Anno per mese
        </h2>
        <MonthlyReturnsTable rows={rows} currentMonth={data.currentMonth} />
      </section>

      {active.weekdays.length > 0 && (
        <section className={styles.card} aria-labelledby="seasonal-weekdays-title">
          <h2 id="seasonal-weekdays-title" className={styles.title}>
            Giorno della settimana
          </h2>
          <SeasonalBars
            label="Rendimento medio per giorno della settimana"
            bars={active.weekdays.map((stat) => ({
              key: String(stat.weekday),
              label: WEEKDAY_NAMES[stat.weekday],
              valuePct: stat.avgPct,
              value: formatDailyPct(stat.avgPct),
              detail: `${Math.round(stat.positiveSharePct)}% positivi`,
            }))}
          />
        </section>
      )}

      {data.electionCycle.length > 0 && (
        <section className={styles.card} aria-labelledby="seasonal-cycle-title">
          <h2 id="seasonal-cycle-title" className={styles.title}>
            Ciclo presidenziale USA
          </h2>
          <p className={styles.hint}>Calcolato su tutto lo storico.</p>
          <SeasonalBars
            label="Rendimento annuo medio per anno del ciclo presidenziale USA"
            bars={data.electionCycle.map((stat) => ({
              key: stat.key,
              label: CYCLE_LABEL[stat.key],
              valuePct: stat.avgPct,
              value: formatPct(stat.avgPct),
              detail: `${stat.positive} su ${stat.count}`,
              highlight: stat.key === data.currentCycle,
            }))}
          />
        </section>
      )}
    </>
  )
}
