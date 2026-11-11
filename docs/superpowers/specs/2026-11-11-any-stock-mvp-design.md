# Any-Stock MVP — Design Spec

## Purpose

Personal web app to monitor a small watchlist of stocks (5–20 symbols):
current price, key info, and recent news per stock. No automated
buy/sell valuation yet — that is deliberately out of scope and will be
designed separately later.

Single user (the owner), no auth, no multi-tenant concerns. Deployed
publicly on Vercel with no access protection (owner's explicit choice —
no sensitive data beyond a personal watchlist).

## Success criteria

- Owner can add/remove stock symbols from a watchlist.
- Watchlist view shows current price, % change, and a quick visual
  trend per stock.
- Per-stock detail view shows key metrics (P/E, market cap, 52-week
  high/low) and recent news headlines.
- Data refreshes automatically on a schedule and can be refreshed
  manually.
- Stale data (API failure) degrades gracefully — last known snapshot
  shown with a timestamp, never a hard error page.

## Non-goals (explicitly deferred)

- Automated valuation / buy-sell scoring — separate future
  brainstorming session.
- forecaster.biz as a data source — investigated via
  `reverse-api-engineer`; no clean API exists, only Next.js RSC JSON
  embedded in HTML (fragile to parse). Deferred as a secondary/optional
  source if Finnhub coverage proves insufficient later.
- Authentication / multi-user support.
- Push notifications / alerts.

## Architecture

- **Framework**: Next.js 15 (App Router), TypeScript.
- **Backend**: Next.js API routes (`app/api/*`). All third-party API
  calls (Finnhub) happen server-side so the API key never reaches the
  browser.
- **Database**: Postgres (Neon, free tier — integrates natively with
  Vercel), accessed via Prisma ORM.
- **Data source**: Finnhub (price, fundamentals, company news) as the
  primary and only data source for the MVP.
- **Scheduled refresh**: Vercel Cron hits an internal endpoint
  (e.g. every 30 min during market hours) that fetches Finnhub for
  every watchlist stock and writes a new `PriceSnapshot`.
- **Deploy**: Vercel, no access protection.

## Data model (Prisma)

```
model Stock {
  id        String   @id @default(cuid())
  symbol    String   @unique
  name      String
  exchange  String
  addedAt   DateTime @default(now())
  snapshots PriceSnapshot[]
  news      NewsItem[]
}

model PriceSnapshot {
  id         String   @id @default(cuid())
  stockId    String
  stock      Stock    @relation(fields: [stockId], references: [id])
  price      Float
  changePct  Float
  volume     BigInt
  marketCap  Float?
  peRatio    Float?
  week52High Float?
  week52Low  Float?
  timestamp  DateTime @default(now())

  @@index([stockId, timestamp])
}

model NewsItem {
  id          String   @id @default(cuid())
  stockId     String
  stock       Stock    @relation(fields: [stockId], references: [id])
  headline    String
  url         String
  source      String
  summary     String?
  publishedAt DateTime

  @@index([stockId, publishedAt])
}
```

## Pages

- `/` — Watchlist table: symbol, name, current price, % change,
  mini-sparkline (from recent `PriceSnapshot` rows). Add/remove stock
  controls (symbol search/lookup via Finnhub).
- `/stock/[symbol]` — Detail view: current price, key metrics (P/E,
  market cap, 52-week high/low), historical price chart (from
  `PriceSnapshot` history), recent news list (from `NewsItem`). Empty
  "considerations" section reserved as a placeholder for the future
  valuation feature — not built now.

## API routes

- `GET /api/stocks` — list watchlist.
- `POST /api/stocks` — add a symbol (validates against Finnhub lookup).
- `DELETE /api/stocks/[symbol]` — remove from watchlist.
- `GET /api/stocks/[symbol]` — detail data (latest snapshot + recent
  news + price history for chart).
- `POST /api/stocks/[symbol]/refresh` — manual refresh for one stock.
- `POST /api/cron/refresh` — scheduled refresh for all watchlist
  stocks; invoked by Vercel Cron, not exposed for manual browser use.

## Error handling

- Finnhub request fails or is rate-limited: serve the last stored
  `PriceSnapshot`/`NewsItem` data with a visible "updated at <time>"
  indicator; never a hard error page.
- Symbol not found during add-to-watchlist search: inline validation
  message, no crash.
- Cron refresh failure for one symbol must not block refresh of the
  others (per-symbol try/catch, log and continue).

## Testing

- Unit tests for Finnhub fetch/parse functions (mocked API responses).
- Integration tests for API routes against a test database.
- No e2e tests for this MVP (personal-scale app, manual verification
  sufficient).
