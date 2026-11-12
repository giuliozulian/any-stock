# Price alerts (entry / sell targets) — design DRAFT

Status: draft, awaiting user approval. No code written.

## Goal
Per stock, the user sets an **entry price** (buy when price falls to or below it) and a **sell price** (sell when price rises to or above it), from the home and the detail page, and is notified when a target is reached.

## Open decision (needs user answer)
Notification channel. Recommendation: **Telegram bot** (free, instant, works with the app closed, simple HTTP call) plus an **in-app banner/badge**. Alternatives: email (needs provider such as Resend), browser push (needs service worker + VAPID, heavy), in-app only (no alert when the app is closed).

## Approach (recommended)
1. **Data**: add to `Stock` the fields `entryPrice Float?`, `sellPrice Float?`, `entryTriggeredAt DateTime?`, `sellTriggeredAt DateTime?`.
2. **Edit UI**: a small `AlertTargets` client component (two numeric inputs, Save, Clear) used on the detail page (next to `SinceWatching`) and as an inline popover/row action on the home. Calls `PATCH /api/stocks/[symbol]` with validation: positive numbers, `entryPrice < sellPrice` when both set. Saving a target resets its `*TriggeredAt`.
3. **Detection**: a pure function `checkTargets(stock, price)` in `lib/alerts.ts` returns which target just crossed. It is called at the end of `refreshStock` (every price update), so manual Refresh and cron both trigger it. Each target fires once (`*TriggeredAt`) until edited or cleared.
4. **Frequency**: the current cron is daily. Add a lightweight cron (for example every 15 min on market hours) that only fetches quotes and runs `checkTargets`, without news/LLM work.
5. **Delivery**: `lib/notify.ts` sends the Telegram message (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` in `.env.local`). Failures are logged and do not break the refresh; the trigger is only stored after a successful send.
6. **In-app visibility**: rows and detail header show the targets and a colored "Target raggiunto" badge when triggered.

## Error handling / testing
- Unit tests: `checkTargets` (crossing, equality, already triggered, null targets), PATCH validation, `AlertTargets` component.
- Notify is mocked in tests.

## Out of scope (YAGNI)
Percentage-based targets, multiple alerts per stock, repeated reminders, trailing stops.
