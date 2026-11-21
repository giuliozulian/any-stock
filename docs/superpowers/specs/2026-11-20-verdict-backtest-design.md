# Verdict Backtest — Design Spec

## Purpose

The app shows a rule-based verdict per stock (`evaluateStock` signals plus the
overall tone from `overallTone`: "Segnali favorevoli" / "contrastanti" /
"Serve prudenza"). Nothing is stored, so there is no way to tell whether the
verdict or any single signal has predicted anything. This feature records
every verdict daily and later measures what the stock did, in absolute terms
and against the S&P 500.

The result is a read-only admin view. It is evidence for deciding which rules
to strengthen or drop; it does not change any rule.

## Decisions taken

- Evaluate the overall verdict **and** each signal separately (short, medium,
  long term, fair value, news).
- Measure both absolute return and return relative to the S&P 500 (`^GSPC`).
- Three horizons: 10, 30 and 90 trading days. A signal is read on the horizon
  that matches it (short 10, medium 30, long 90), but every horizon is stored
  for every verdict.
- Start from today. No reconstruction from old `PriceSnapshot` rows: fair
  value, analyst consensus and news weighting were not stored with a date, so a
  rebuilt verdict would be incomplete.
- Prices from Yahoo daily bars (`getDailyBars`), not from our own snapshots,
  which are not aligned to trading days and have no benchmark.
- Neutral band of 2% on both absolute and relative return.

## Data model (`prisma/schema.prisma`)

### `VerdictLog`

One row per stock and day, `@@unique([stockId, day])`.

- `stockId` (relation to `Stock`, cascade), `day` (UTC day, `YYYY-MM-DD`).
- `refDate`, `refPrice`: date and close of the last daily bar available when
  logging. The job runs before the US open, so this is the previous close.
  Returns start here.
- `overall`, `score`: overall tone and its numeric score (null when no signal has data).
- `shortTerm`, `mediumTerm`, `longTerm`, `fairValue`, `news`: normalized tone
  each (`positive` | `neutral` | `negative` | `unknown`; `unknown` when the data is
  missing). Next to each, the original Italian label (`shortTermLabel`, ...).
- `rulesVersion` (int): bumped by hand when the rules of `evaluateStock`
  change, so statistics never mix versions.
- `createdAt`.

### `VerdictOutcome`

One row per verdict and horizon, created only when the horizon has matured,
`@@unique([verdictId, horizon])`.

- `verdictId` (cascade), `horizon` (10 | 30 | 90), `evalDate`.
- `stockReturnPct`, `benchReturnPct`, `excessPct` (`stock − bench`).

Outcomes are never recomputed. A change of rules means a new `rulesVersion`.

## Recording (`lib/verdict-log.ts`, `app/api/cron/verdicts/route.ts`)

- New endpoint `/api/cron/verdicts`, same `CRON_SECRET` bearer check as the
  other crons. Separate from `/api/cron/refresh` so a failure or a long run
  there cannot hurt the price refresh.
- `vercel.json`: second cron at 08:30 UTC, Monday to Friday, half an hour after
  the refresh so snapshots are fresh.
- The endpoint does two steps: `recordVerdicts()`, then `evaluateMatureVerdicts()`.
  A failure in the second does not undo the first. The JSON response reports
  `recorded`, `skipped`, `evaluated`, `failed`.
- `recordVerdicts()` goes through every stock watched by at least one user,
  one at a time (like `refreshAllStocks`). For each it loads the latest
  snapshot, the last two analyst recommendations, analysed news and Finnhub
  metrics, calls `evaluateStock` (with `earliestSnapshot: null`: "since you
  follow" is per user and not part of the verdict) and writes the row with
  `createMany({ skipDuplicates: true })`, so a second run the same day is
  harmless.
- No latest snapshot: stock skipped, counted in `skipped`. Finnhub metrics
  failure: `fairValue` is `unknown` and the verdict is still recorded.
- `overallTone` and the label-to-tone map move from
  `components/EvaluationPanel.tsx` into `lib/evaluate.ts`; the component imports
  them. The page and the log then use the same code. The other three callers of
  `evaluateStock` are not touched.
- `RULES_VERSION` is a constant in `lib/evaluate.ts`.

## Evaluation (`lib/verdict-backtest.ts`, pure functions)

Per-signal results are derived at read time from the stored returns and the stored tone of that signal, with the 2% band; no result is stored.

- Outcome of a return `r` (absolute) or `excess` (relative) for a verdict tone,
  band `B = 2`:
  - positive: `win` if `r ≥ +B`, `loss` if `r ≤ −B`, else `neutral`;
  - negative: mirrored (`win` if `r ≤ −B`);
  - neutral verdict: no result, returns stored.
  - A signal with tone `unknown` is left out of that signal's statistics.
- Trading days: find the bar of `refDate` in the daily bars, take the close of
  the bar `N` positions later. Holidays are skipped because they have no bar.
  Stock return is the close against `refPrice`; benchmark return uses the same
  two dates on `^GSPC`.
- Maturity: if bar `N` does not exist yet, nothing is written and the next run
  tries again. To avoid useless downloads, a stock is only looked at when
  `refDate` plus about `N × 7/5` calendar days is already past.
- Data: `getDailyBars` (Yahoo, 6 h cache) for the stock and for `^GSPC`. Empty
  or failed fetch: the stock is skipped and retried the next day; no partial
  outcome is written.
- Writes use `createMany({ skipDuplicates: true })` on `(verdictId, horizon)`.
- Known limit: a delisted stock never produces an outcome and stays "pending".

## Admin view (`app/admin/backtest/page.tsx`, `lib/verdict-stats.ts`)

- New entry in `SECTIONS` of `components/AdminTabs.tsx`. Same admin check as
  `/admin` (`getRealUser` + `isAdminEmail`, else `notFound()`).
- Selector for `rulesVersion`, defaulting to the latest.
- One table per horizon (10, 30, 90). Rows: overall verdict and each signal.
  Columns: matured verdicts out of recorded ("pending" when none); absolute
  wins / losses / neutrals and success rate (wins over wins plus losses);
  same relative to the S&P 500; average stock return and average excess return,
  split by positive, neutral and negative tone.
- A note when a row has fewer than 30 matured verdicts: the rate is not
  significant.
- Read-only, tables only. Aggregation is a pure function in
  `lib/verdict-stats.ts` over rows; the query lives outside it.

## Testing

- `tests/lib/verdict-backtest.test.ts`: thresholds ±2% absolute and relative,
  positive / negative / neutral verdicts, missing bar (not matured), holidays
  skipped, S&P rising more than the stock.
- `tests/lib/verdict-stats.test.ts`: rates with neutrals excluded, grouping by
  tone, a row with zero matured verdicts.
- `tests/lib/verdict-log.test.ts` on the test database
  (`tests/helpers/db.ts`): second run the same day does not duplicate, stock
  without snapshot is skipped, `fairValue` is `unknown` when Finnhub fails.
- `tests/api/verdicts-cron.test.ts`: 401 without a valid secret. Check
  `tests/api/auth-coverage.test.ts` for the new route.
- The existing tests of `overallTone` move with the function.

## Out of scope

Charts, notifications, and changing any rule based on the results. That is the
next step, once enough verdicts have matured. The first usable numbers arrive
after 10 trading days (30 and 90 days later for the longer horizons).
