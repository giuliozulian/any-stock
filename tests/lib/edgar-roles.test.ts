import { describe, expect, it } from 'vitest'
import { parseRole } from '@/lib/edgar-roles'

const rel = (inner: string) => `<reportingOwnerRelationship>${inner}</reportingOwnerRelationship>`

describe('parseRole', () => {
  it('prefers the officer title', () => {
    expect(parseRole(rel('<isDirector>1</isDirector><isOfficer>true</isOfficer><officerTitle>Chief Operations Officer</officerTitle>'))).toBe('Chief Operations Officer')
  })
  it('falls back to director, then 10% owner', () => {
    expect(parseRole(rel('<isDirector>1</isDirector><isOfficer>0</isOfficer>'))).toBe('Director')
    expect(parseRole(rel('<isTenPercentOwner>1</isTenPercentOwner>'))).toBe('10% Owner')
  })
  it('returns null without a relationship block', () => {
    expect(parseRole('<x/>')).toBeNull()
  })
})
