import { defineConfig } from 'vitest/config'
import path from 'path'
import { config as loadDotenv } from 'dotenv'

loadDotenv({ path: path.resolve(__dirname, '.env.local') })

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/eval/**/*.eval.ts'],
    testTimeout: 30 * 60_000,
    // .env.local points at the real database: the eval never needs it, so make sure nothing imported by mistake can reach it.
    env: { DATABASE_URL: '' },
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
