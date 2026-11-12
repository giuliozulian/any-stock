# Stock Evaluation — Design Spec

## Purpose

Replace the empty "Considerations" placeholder on the stock detail page
with a real, rule-based evaluation panel. It must help the owner judge,
at a glance, whether a stock is worth paying attention to — without
inventing fake predictions. Every signal is either:

- derived from data the app already fetches from Finnhub (quotes,
  52-week range, basic financial metrics), or
- real third-party data (Finnhub's analyst recommendation trend), or
- a transparent, named formula (e.g. a Peter-Lynch-style fair-value
  estimate), explicitly labeled as an estimate, never as a market
  prediction.

UI must stay simple and intuitive: one quiet section, five headline
rows in Italian (label + value + one-sentence explanation), with the
underlying raw numbers tucked behind a native `<details>` disclosure
for anyone who wants to dig in. No new dashboard widgets, icons, or
color scheme — reuse the existing ledger-style hairline/serif/brass
visual language from the current detail page.

## Non-goals

- No machine-learning forecasting, no invented price predictions.
- No paid Finnhub tier — `/stock/price-target` is paid-only and is not
  used; target price is estimated with our own transparent formula
  instead, clearly labeled as such.
- No change to the watchlist page's design in this pass — evaluation
  lives only on the stock detail page.

## Data model changes

### `PriceSnapshot` — new nullable fields

All sourced from the Finnhub `/stock/metric` call already made every
refresh (confirmed live: free tier returns 133 fields, zero extra API
cost to read more of them):

| Field | Finnhub source field | Used for |
|---|---|---|
| `pegRatio` | `pegTTM` | Valuation vs growth (long-term signal) |
| `roe` | `roeTTM` | Profitability (long-term signal) |
| `netMargin` | `netProfitMarginTTM` | Profitability (long-term signal) |
| `debtToEquity` | `totalDebt/totalEquityAnnual` | Financial health (long-term signal) |
| `dividendYield` | `currentDividendYieldTTM` | Dividend detail |
| `payoutRatio` | `payoutRatioTTM` | Dividend detail |
| `relativePerf13W` | `priceRelativeToS&P50013Week` | Momentum (short-term signal) |
| `epsTTM` | `epsTTM` | Target-price formula input |
| `epsGrowth5Y` | `epsGrowth5Y` (fallback `epsGrowthTTMYoy` if null) | Target-price formula input |

### New model: `AnalystRecommendation`

```prisma
model AnalystRecommendation {
  id         String   @id @default(cuid())
  stockId    String
  stock      Stock    @relation(fields: [stockId], references: [id], onDelete: Cascade)
  period     DateTime
  strongBuy  Int
  buy        Int
  hold       Int
  sell       Int
  strongSell Int
  fetchedAt  DateTime @default(now())

  @@unique([stockId, period])
  @@index([stockId, period])
}
```

Sourced from Finnhub's `/stock/recommendation` endpoint (confirmed free
tier, live-tested: returns up to 4 trailing months of analyst
buy/hold/sell counts per symbol). One row per `(stockId, period)`,
upserted every refresh so counts stay current if Finnhub revises a
period, and history accumulates for the medium-term trend signal.

`Stock` gains a `recommendations AnalystRecommendation[]` relation.

## Finnhub client additions (`lib/finnhub.ts`)

```typescript
export interface FinnhubRecommendation {
  period: string // "YYYY-MM-DD"
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
}

export async function getRecommendationTrend(symbol: string): Promise<FinnhubRecommendation[]>
```

`FinnhubMetrics` gains the nine fields listed above (all `number | null`,
same null-fallback pattern already used for `peRatio`/`week52High`/`week52Low`).

## Refresh logic changes (`lib/refresh.ts`)

`refreshStock` gains one more Finnhub call per refresh:
`getRecommendationTrend(symbol)`. It runs in its own try/catch
**after** the price snapshot is created from the existing
`Promise.all([getQuote, getProfile, getMetrics])` — deliberately not
inside that `Promise.all`, so a recommendation-fetch failure can never
prevent the price snapshot (the more important data) from being
written. On success, each returned period is upserted into
`AnalystRecommendation` the same way news items are upserted (loop +
`upsert` by the unique key), capped to the periods Finnhub returns
(≤4). On failure, the error is logged (same `console.error` pattern as
the outer catch) and the refresh still returns `{ ok: true }` — a
missing recommendation update is not treated as a refresh failure.

**Cost note:** this raises Finnhub calls per refresh from 4 to 5. The
existing free-tier rate-limit risk at a 20-stock watchlist (documented
in the MVP plan's ledger) grows proportionally — this is an accepted,
already-disclosed limitation, not a new one introduced here.

## Evaluation module (`lib/evaluate.ts`) — pure, no network calls

```typescript
export interface SignalResult {
  label: string
  note: string
}

export interface Evaluation {
  sinceWatching: { pct: number | null; sinceDate: Date | null; note: string }
  shortTerm: SignalResult
  mediumTerm: SignalResult & { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }
  longTerm: SignalResult
  targetPrice: { value: number | null; upsidePct: number | null; note: string }
  details: {
    pegRatio: number | null
    roe: number | null
    debtToEquity: number | null
    netMargin: number | null
    dividendYield: number | null
    payoutRatio: number | null
  }
}

export function evaluateStock(input: {
  latestSnapshot: { price: number; week52High: number | null; week52Low: number | null; relativePerf13W: number | null; pegRatio: number | null; roe: number | null; debtToEquity: number | null; netMargin: number | null; dividendYield: number | null; payoutRatio: number | null; epsTTM: number | null; epsGrowth5Y: number | null }
  earliestSnapshot: { price: number; timestamp: Date } | null
  recentRecommendations: Array<{ period: Date; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }> // ordered desc by period
}): Evaluation
```

### 1. Since-watching return

```
pct = earliestSnapshot ? (latest.price - earliest.price) / earliest.price * 100 : null
```

If `earliestSnapshot` is null or is the same row as the latest (only
one snapshot exists), `pct` is `null` and the note reads: "Appena
aggiunto, nessun dato storico ancora." Otherwise: "Da quando segui
questo titolo (dal {sinceDate}): {+/-}{pct}%."

### 2. Short-term signal (momentum)

```
position52w = (price - week52Low) / (week52High - week52Low)   // 0..1, null if range missing/zero
```

| Condition | Label | 
|---|---|
| `position52w > 0.8` and `relativePerf13W > 0` | Positivo |
| `position52w < 0.2` and `relativePerf13W < 0` | Negativo |
| otherwise (including missing data) | Neutro |

Note always states the two numbers in plain Italian, e.g. "Il prezzo è
vicino al massimo delle ultime 52 settimane e sta andando meglio
dell'indice S&P 500 nelle ultime 13 settimane." Missing-data note:
"Dati di momentum non disponibili per questo titolo."

### 3. Medium-term signal (analyst consensus trend)

```
score(period) = (strongBuy*2 + buy - sell - strongSell*2) / totalAnalysts
```

Compare the latest period's score to the previous period's score (if
at least 2 periods exist):

| Condition | Label |
|---|---|
| no recommendations at all | "Nessun dato disponibile" |
| only 1 period, `latestScore > 0.5` | "Consenso positivo" (no trend suffix — nothing to compare against) |
| only 1 period, `latestScore < -0.5` | "Consenso negativo" |
| only 1 period, otherwise | "Consenso misto" |
| 2+ periods, `latestScore > 0.5` and `latestScore >= previousScore` | "Consenso positivo, in miglioramento" |
| 2+ periods, `latestScore > 0.5` and `latestScore < previousScore` | "Consenso positivo, ma in calo" |
| 2+ periods, `latestScore < -0.5` | "Consenso negativo" |
| 2+ periods, otherwise | "Consenso misto" |

Note always shows the raw counts: "{strongBuy + buy} analisti su
{total} raccomandano l'acquisto, {hold} sono neutrali, {sell +
strongSell} raccomandano la vendita."

### 4. Long-term signal (fundamentals)

Three independent reads, combined:

- **PEG** (`pegRatio`): `null` or `<= 0` → not meaningful (common for
  loss-making or negative-growth companies) → excluded from the
  combination, noted separately as "non disponibile". `<= 1` →
  "sottovalutata rispetto alla crescita". `1 < peg <= 2` → "valutazione
  nella norma". `> 2` → "cara rispetto alla crescita".
- **ROE**: `> 15` → "redditività solida". `0 < roe <= 15` →
  "redditività debole". `<= 0` → "azienda in perdita".
- **Debt/equity**: `< 1` → "indebitamento sano". `1 <= x < 2` →
  "indebitamento moderato". `>= 2` → "indebitamento elevato".

Combined label: "Fondamentali solidi" if PEG and ROE and debt are all
in their best bracket; "Fondamentali deboli" if ROE is negative or
debt is elevato; "Fondamentali nella norma" otherwise. If every one of
the three inputs is null, label is "Dati fondamentali non
disponibili".

### 5. Target price estimate (Peter-Lynch-style, transparent)

```
growthPercent = epsGrowth5Y ?? null   // already in percent, e.g. 12.5
fairPE = growthPercent == null ? null : clamp(growthPercent, 5, 40)
fairValue = (fairPE == null || epsTTM == null || epsTTM <= 0) ? null : fairPE * epsTTM
upsidePct = fairValue == null ? null : (fairValue - price) / price * 100
```

If `fairValue` is `null` (no meaningful growth figure, or the company
has negative/zero trailing EPS), show no number at all — note: "Stima
non disponibile: utili o crescita storica non adatti a questo
calcolo." Otherwise note: "Stima indicativa basata sulla crescita
storica degli utili (formula P/E = crescita, stile 'Peter Lynch'). Non
è una previsione di mercato né un consiglio di investimento."

## UI (`app/stock/[symbol]/page.tsx`)

Replaces the current static "Considerations" block. New component
`components/EvaluationPanel.tsx` (server-renderable, pure props in →
JSX out, no client state needed since there's no interaction) renders:

1. Five headline rows, same visual pattern as the existing `.metrics`
   `<dl>` (label left, value right, hairline between rows), each with
   a muted one-line note underneath spanning the full row width.
2. A trailing `<details>` element, `<summary>Dettagli numerici</summary>`,
   containing the raw `details` values (PEG, ROE, debt/equity, net
   margin, dividend yield, payout ratio) as plain label/value pairs in
   the same quiet style — closed by default.

New CSS additions to `app/stock/[symbol]/page.module.css` only (no new
design tokens): a `.note` class (muted, smaller, full-width under a
metric row) and a `.details` class for the `<details>` element's
spacing.

## Error handling

Every branch in `evaluateStock` has a defined behavior for missing
data (documented above) — the function never throws and never returns
a misleading number. The page continues to degrade gracefully exactly
as the rest of the app does: a stock with no recommendations yet, no
PEG, or only one snapshot shows plain "not available" notes, never a
crash or a hard error page.

## Testing

- `lib/evaluate.ts`: pure unit tests, one per branch documented above
  (since-watching with 0/1/2+ snapshots; momentum positive/negative/
  neutral/missing-data; consensus improving/declining/mixed/negative/
  absent/single-period; PEG low/mid/high/not-meaningful; ROE solid/
  weak/negative; debt sano/moderato/elevato; combined long-term label
  in each combination; target price computable and each non-computable
  reason).
- `lib/finnhub.ts`: unit test for `getRecommendationTrend` (mocked
  fetch, same pattern as existing tests).
- `lib/refresh.ts`: extend existing integration tests — refreshing a
  stock writes `AnalystRecommendation` rows and the new `PriceSnapshot`
  fields; a second refresh updates rather than duplicates recommendation
  rows for the same period (same pattern as the existing
  no-duplicate-news test).
- `components/EvaluationPanel.tsx`: component tests covering at least
  one "data available" render and one "nothing available yet" render
  (a freshly-added stock with a single snapshot and no recommendations),
  confirming no crash and the expected not-available notes appear.

## Review Focus

- A freshly-added stock (one snapshot, no recommendations yet) must
  render every row with a plain "not available" note — never crash,
  never show a misleading `0%` or `$0` target price.
- A company with negative or null EPS growth, or negative/zero
  trailing EPS, must never show a fabricated target price.
- A company with no analyst coverage at all (recommendations array
  empty) must show "Nessun dato disponibile", not a false "Consenso
  misto".
- The since-watching percentage must use the *earliest* stored
  snapshot, not assume it's always the first array element returned
  by a given query order (an ordering bug here would silently show the
  wrong percentage).
- Rate-limit interaction: the new fifth Finnhub call per refresh must
  not break per-symbol failure isolation already tested in
  `refreshAllStocks` — one symbol's recommendation-fetch failure must
  not stop the quote/profile/metrics writes for the same symbol
  (needs a test: `getRecommendationTrend` rejects, snapshot still
  gets created from the other three calls that succeeded).
