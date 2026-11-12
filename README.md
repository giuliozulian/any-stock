# Any-Stock

Personal watchlist app: price, key metrics, and recent news for a small
set of stocks, backed by Finnhub.

## Local development

1. `docker compose -f docker-compose.test.yml up -d`
2. Copy `.env.example` to `.env` and `.env.test`, fill in `FINNHUB_API_KEY`
3. `npx prisma migrate dev`
4. `npm run dev`

## Testing

`npm test` (requires the test Postgres container running)

## Deployment

See `docs/superpowers/plans/2026-11-11-any-stock-mvp.md`, Task 9.
