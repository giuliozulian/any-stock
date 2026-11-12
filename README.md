# Any-Stock

Personal watchlist app: price, key metrics, and recent news for a small
set of stocks, backed by Finnhub.

## Local development

1. Copy `.env.example` to `.env`, fill in `DATABASE_URL` (your local/dev
   Postgres) and `FINNHUB_API_KEY`. `.env.test` is already committed with
   the test-database connection string — don't overwrite it.
2. `npm install` (runs `prisma generate` automatically via `postinstall`)
3. `npx prisma migrate dev` — applies migrations to the database in `.env`
4. `npm run dev`

## Testing

1. `docker compose -f docker-compose.test.yml up -d` — starts a separate
   Postgres on port 5433, used only by tests (dev data is untouched)
2. First time only: apply migrations to it —
   `DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2- | tr -d '"') npx prisma migrate deploy`
3. `npm test` — loads `.env.test` automatically, no manual env export
   needed. `resetDb()` refuses to run against any `DATABASE_URL` that
   doesn't contain "test", as a guard against accidentally wiping a real
   database.

## Deployment

See `docs/superpowers/plans/2026-11-11-any-stock-mvp.md`, Task 9. The
build runs `prisma generate` via `postinstall`, so no extra deploy step
is needed for the Prisma client itself — only the production
`DATABASE_URL`, `FINNHUB_API_KEY`, and `CRON_SECRET` env vars and running
`prisma migrate deploy` once against the production database.

Vercel Cron on the Hobby plan only allows once-daily schedules —
`vercel.json` is set to `0 13 * * 1-5` (13:00 UTC, weekdays). On Pro,
`*/30 13-21 * * 1-5` refreshes every 30 minutes during US market hours
instead.
