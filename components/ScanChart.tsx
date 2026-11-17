'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChartData } from '@/lib/chart-data'
import styles from './ScanChart.module.css'

const COLORS = { up: '#3ddc84', down: '#ef5350', sma50: '#4c8dff', sma150: '#ffa726', sma200: '#ef5350', pivot: '#3ddc84', stop: '#ef5350' }

export function ScanChart({ symbol }: { symbol: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<ChartData | null>(null)
  const [failed, setFailed] = useState(false)

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
    import('lightweight-charts').then(({ createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, ColorType }) => {
      if (!live) return
      const text = getComputedStyle(el).color
      const c = createChart(el, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text },
        grid: { vertLines: { color: 'rgba(128,128,128,0.12)' }, horzLines: { color: 'rgba(128,128,128,0.12)' } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
      })
      chart = c
      const candles = c.addSeries(CandlestickSeries, { upColor: COLORS.up, downColor: COLORS.down, borderVisible: false, wickUpColor: COLORS.up, wickDownColor: COLORS.down })
      candles.setData(data.candles)
      const line = (points: ChartData['sma50'], color: string) => {
        const s = c.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
        s.setData(points)
      }
      line(data.sma200, COLORS.sma200)
      line(data.sma150, COLORS.sma150)
      line(data.sma50, COLORS.sma50)
      if (data.pivot !== null) candles.createPriceLine({ price: data.pivot, color: COLORS.pivot, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Pivot' })
      if (data.stop !== null) candles.createPriceLine({ price: data.stop, color: COLORS.stop, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Stop' })
      const volume = c.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', priceLineVisible: false, lastValueVisible: false })
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
      volume.setData(data.volumes.map((v) => ({ time: v.time, value: v.value, color: v.up ? 'rgba(61,220,132,0.45)' : 'rgba(239,83,80,0.45)' })))
      c.timeScale().fitContent()
    })
    return () => {
      live = false
      chart?.remove()
    }
  }, [data])

  if (failed) return <p className={styles.note}>Grafico non disponibile: riprova tra poco.</p>
  if (!data) return <p className={styles.note}>Carico il grafico…</p>
  return (
    <div className={styles.wrap}>
      <div ref={box} className={styles.chart} role="img" aria-label={`Grafico giornaliero di ${symbol}, ultimi 6 mesi`} />
      <p className={styles.legend}>
        <span style={{ color: COLORS.sma50 }}>— media 50 giorni</span> <span style={{ color: COLORS.sma150 }}>— media 150</span> <span style={{ color: COLORS.sma200 }}>— media 200</span>
        {data.pivot !== null && <span style={{ color: COLORS.pivot }}> - - pivot</span>}
        {data.stop !== null && <span style={{ color: COLORS.stop }}> - - stop</span>}
        <span> · in basso i volumi</span>
      </p>
    </div>
  )
}
