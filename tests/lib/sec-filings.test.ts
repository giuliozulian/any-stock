import { describe, expect, it } from 'vitest'
import { itemLabels } from '@/lib/sec-filings'

describe('itemLabels', () => {
  it('translates known 8-K items, drops the rest and duplicates', () => {
    expect(itemLabels(['2.02', '9.01', '2.02', '5.02'])).toEqual(['risultati trimestrali', 'cambio di dirigenti o amministratori'])
  })
})
