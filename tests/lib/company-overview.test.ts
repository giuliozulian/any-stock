import { describe, it, expect } from 'vitest'
import { parseOverview } from '@/lib/company-overview'

describe('parseOverview', () => {
  it('accepts sector and description', () => {
    expect(parseOverview({ sector: ' Banche ', description: 'Fa prestiti.' })).toEqual({ sector: 'Banche', description: 'Fa prestiti.' })
  })

  it('rejects empty answers (unknown company)', () => {
    expect(parseOverview({ sector: '', description: '' })).toBeNull()
    expect(parseOverview(null)).toBeNull()
  })
})
