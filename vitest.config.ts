import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { config as loadDotenv } from 'dotenv'

loadDotenv({ path: path.resolve(__dirname, '.env.test') })

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    // Integration tests share one real Postgres instance; running test
    // files concurrently races deleteMany()/create() across files on the
    // same symbols (e.g. "AAPL") and causes spurious unique-constraint
    // failures. Serialize file execution instead.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      FINNHUB_API_KEY: process.env.FINNHUB_API_KEY ?? '',
      CRON_SECRET: process.env.CRON_SECRET ?? '',
      // Existing route tests run without a login; the auth tests turn this off with vi.stubEnv. Only honoured outside production.
      AUTH_DISABLED: '1',
      // Module caches stay in memory in unit tests; tests/lib/shared-cache.test.ts turns the database level on.
      SHARED_CACHE_DB: '0',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
