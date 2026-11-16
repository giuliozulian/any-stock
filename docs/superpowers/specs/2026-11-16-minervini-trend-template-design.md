# Minervini Trend Template — Design (Fase 1)

## Obiettivo
Aggiungere alla pagina del titolo una tab "Minervini" che valuta il Trend Template (8 criteri), la Relative Strength e lo stato VCP, per decisioni di acquisto/vendita su orizzonte di settimane.

## Roadmap
1. **Fase 1 (questa spec)**: tab nella pagina del titolo.
2. Fase 2: badge/filtro Trend Template in watchlist e `/scopri`.
3. Fase 3: alert cron (titolo passa il template, rottura del pivot).

## Architettura
- `lib/minervini.ts`: funzioni pure, nessun I/O.
  - `sma(values, n)`, helper 52 settimane.
  - `evaluateTrendTemplate(bars, rsPercentile)` → `{ criteria: Criterion[8], passed, stage2 }`, dove `Criterion = { id, label, ok, value }`.
  - `detectVcp(bars)` → `{ contractions: number[], pivot: number | null, volumeDryUp: boolean, suggestedStop: number | null }`.
  - `weightedReturn(closes)`: 40% ultimo trimestre, 20% ciascuno dei tre precedenti.
  - `percentileRank(value, peers)`.
- `lib/history.ts`: aggiungere `range=2y` e il volume (`PricePoint.volume?`), mantenendo la compatibilità dei consumer esistenti. SMA 200 con pendenza a 1 mese richiede circa 14 mesi di dati.
- RS: percentile del `weightedReturn` del titolo rispetto a watchlist + candidati scoperti. Con meno di 5 pari il criterio è marcato "non affidabile" e non conta nel punteggio (mostrato come N/7).
- UI: `components/MinerviniPanel.tsx` (+ `.module.css`), registrato come tab in `StockTabs`. Mostra gli 8 criteri con ok/ko e valore, badge Stage 2, contrazioni VCP, pivot e stop suggerito (7–8% sotto il pivot).

## Flusso dati
Pagina titolo → `getPriceHistory` (2y) + prezzi dei pari → `lib/minervini.ts` → `MinerviniPanel`.

## Gestione errori
- Storico < 200 barre: pannello "dati insufficienti", nessun criterio calcolato.
- Fetch fallito: stato vuoto coerente con gli altri pannelli.
- VCP non rilevato: `pivot = null`, il pannello lo dice esplicitamente.

## Test (vitest)
`lib/minervini.test.ts` con serie sintetiche: trend rialzista che passa 8/8, trend ribassista che fallisce, contrazioni 25→12→6%, percentile con pochi pari, storico corto.

## Fuori scope
Fondamentali (EPS/ricavi), persistenza DB, badge in watchlist, alert.
