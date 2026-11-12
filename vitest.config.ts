import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
