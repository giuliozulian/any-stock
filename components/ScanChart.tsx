'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChartData } from '@/lib/chart-data'
import styles from './ScanChart.module.css'

const COLORS = { up: '#3bf08c', down: '#ff5a4f', sma50: '#5b9bff', sma150: '#ffb800', sma200: '#b9a4ff', pivot: '#3bf08c', stop: '#ff5a4f' }

const AVERAGES = [
  { key: 'sma50', label: 'Media 50', color: COLORS.sma50 },
  { key: 'sma150', label: 'Media 150', color: COLORS.sma150 },
  { key: 'sma200', label: 'Media 200', color: COLORS.sma200 },
] as const
type AverageKey = (typeof AVERAGES)[number]['key']

const QUICK_CHECKS = [
  { title: 'Oscillazioni sempre più piccole', text: 'Gli ultimi saliscendi si stringono. Se restano grandi e irregolari, non comprare.' },
  { title: 'Scambi bassi nella base', text: 'Barre in basso corte nelle ultime settimane. Solo oggi una barra verde alta.' },
  { title: 'Pivot netto, prezzo vicino', text: 'Supera il Pivot senza tentativi falliti, tra Pivot e Limite +5%, non lontano dalla media 50.' },
] as const

interface Readout {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  changePct: number | null
}

const fmt = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtVolume = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} mln` : n >= 1e3 ? `${Math.round(n / 1e3)} mila` : String(n))
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function readoutAt(data: ChartData, time: string): Readout | null {
  const i = data.candles.findIndex((c) => c.time === time)
  if (i < 0) return null
  const c = data.candles[i]
  const prev = i > 0 ? data.candles[i - 1].close : null
  return { ...c, volume: data.volumes[i]?.value ?? null, changePct: prev ? ((c.close - prev) / prev) * 100 : null }
}

function ChartSkeleton() {
  return (
    <div className={styles.wrap} role="status" aria-label="Carico il grafico">
      <div className={styles.skReadout}>
        {[64, 52, 52, 52, 70, 58].map((w, i) => (
          <span key={i} className={styles.sk} style={{ width: w }} />
        ))}
      </div>
      <div className={`${styles.sk} ${styles.skChart}`} />
      <div className={styles.skLegend}>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`${styles.sk} ${styles.skPill}`} />
        ))}
      </div>
    </div>
  )
}

export function ScanChart({ symbol }: { symbol: string }) {
  const box = useRef<HTMLDivElement>(null)
  const lines = useRef<Partial<Record<AverageKey, { applyOptions: (o: { visible: boolean }) => void }>>>({})
  const [data, setData] = useState<ChartData | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [on, setOn] = useState<Record<AverageKey, boolean>>({ sma50: true, sma150: true, sma200: true })

  useEffect(() => {
    let live = true
    fetch(`/api/scanner/chart/${encodeURIComponent(symbol)}`)
      .then((res) => (res.ok ? (res.json() as Promise<ChartData>) : Promise.reject(new Error(String(res.status)))))
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [symbol])

  useEffect(() => {
    const el = box.current
    if (!data || !el) return
    let chart: { remove: () => void } | null = null
    let live = true
    import('lightweight-charts').then(({ createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, ColorType, CrosshairMode }) => {
      if (!live) return
      const text = getComputedStyle(el).color
      const c = createChart(el, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontFamily: getComputedStyle(el).fontFamily, fontSize: 11, attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(161,161,170,0.10)' } },
        crosshair: { mode: CrosshairMode.Normal, vertLine: { labelBackgroundColor: '#27272a' }, horzLine: { labelBackgroundColor: '#27272a' } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.24 } },
        timeScale: { borderVisible: false, timeVisible: false, rightOffset: 4 },
      })
      chart = c
      const candles = c.addSeries(CandlestickSeries, { upColor: COLORS.up, downColor: COLORS.down, borderVisible: false, wickUpColor: COLORS.up, wickDownColor: COLORS.down, priceLineVisible: false })
      candles.setData(data.candles)
      for (const { key, color } of AVERAGES) {
        const s = c.addSeries(LineSeries, { color, lineWidth: key === 'sma50' ? 2 : 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
        s.setData(data[key])
        lines.current[key] = s
      }
      if (data.pivot !== null) {
        candles.createPriceLine({ price: data.pivot, color: COLORS.pivot, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Pivot' })
        candles.createPriceLine({ price: data.pivot * 1.05, color: 'rgba(59,240,140,0.45)', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Limite +5%' })
      }
      if (data.stop !== null) candles.createPriceLine({ price: data.stop, color: COLORS.stop, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Stop' })
      const volume = c.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', priceLineVisible: false, lastValueVisible: false })
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      volume.setData(data.volumes.map((v) => ({ time: v.time, value: v.value, color: v.up ? 'rgba(59,240,140,0.35)' : 'rgba(255,90,79,0.35)' })))
      c.subscribeCrosshairMove((p) => setHover(typeof p.time === 'string' ? p.time : null))
      c.timeScale().fitContent()
      setReady(true)
    })
    return () => {
      live = false
      lines.current = {}
      chart?.remove()
    }
  }, [data])

  function toggle(key: AverageKey) {
    const next = !on[key]
    lines.current[key]?.applyOptions({ visible: next })
    setOn((cur) => ({ ...cur, [key]: next }))
  }

  if (failed) return <p className={styles.note}>Grafico non disponibile: riprova tra poco.</p>
  if (!data) return <ChartSkeleton />

  const last = data.candles.at(-1)
  const r = readoutAt(data, hover ?? last?.time ?? '')
  const tone = r === null || r.changePct === null ? undefined : r.changePct >= 0 ? 'up' : 'down'

  return (
    <div className={styles.wrap}>
      {r && (
        <dl className={styles.readout} aria-live="off">
          <div className={styles.day}>
            <dt className={styles.sr}>Giorno</dt>
            <dd>{fmtDay(r.time)}</dd>
          </div>
          <div>
            <dt>Apertura</dt>
            <dd>{fmt(r.open)}</dd>
          </div>
          <div>
            <dt>Massimo</dt>
            <dd>{fmt(r.high)}</dd>
          </div>
          <div>
            <dt>Minimo</dt>
            <dd>{fmt(r.low)}</dd>
          </div>
          <div>
            <dt>Chiusura</dt>
            <dd data-tone={tone}>
              {fmt(r.close)}
              {r.changePct !== null && <span className={styles.change}> {r.changePct >= 0 ? '+' : ''}{r.changePct.toLocaleString('it-IT', { maximumFractionDigits: 2 })}%</span>}
            </dd>
          </div>
          {r.volume !== null && (
            <div>
              <dt>Scambi</dt>
              <dd>{fmtVolume(r.volume)}</dd>
            </div>
          )}
        </dl>
      )}
      <div className={styles.stage}>
        <div ref={box} className={styles.chart} role="img" aria-label={`Grafico giornaliero di ${symbol}, ultimi 6 mesi`} />
        {!ready && <div className={`${styles.sk} ${styles.skOverlay}`} aria-hidden />}
      </div>
      <div className={styles.legend}>
        {AVERAGES.map((a) => (
          <button key={a.key} type="button" className={styles.avg} aria-pressed={on[a.key]} onClick={() => toggle(a.key)}>
            <span className={styles.swatch} style={{ background: a.color }} aria-hidden />
            {a.label}
          </button>
        ))}
        <span className={styles.hint}>Barre in basso: scambi. Linea tratteggiata verde: pivot. Rossa: stop.</span>
      </div>
      <div className={styles.checks}>
        <p className={styles.checksTitle}>Cosa controllare prima di comprare</p>
        <ul className={styles.checkList}>
          {QUICK_CHECKS.map((c) => (
            <li key={c.title}>
              <strong>{c.title}.</strong> {c.text}
            </li>
          ))}
        </ul>
        <p className={styles.checksRule}>Se uno di questi tre non torna, aspetta, anche se dice “Si può comprare”.</p>
      </div>
    </div>
  )
}
