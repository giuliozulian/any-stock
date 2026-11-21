import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RULES, RULE_IDS, RULEBOOK_VERSION, rulebookPrompt } from '@/lib/minervini-rulebook'

// Rules in the document that are deliberately not sent to the model: they come from other authors (O'Neil, CAN SLIM).
const LEFT_OUT = ['B4', 'S3', 'X2', 'X3']

// Where the model-facing kind differs from the document on purpose: there is no data for these, so the model must not judge them.
const KIND_DIFFERS_ON_PURPOSE = ['RS1', 'M1', 'M2', 'F3']

function documentKinds(): Map<string, string> {
  const doc = readFileSync(join(process.cwd(), 'docs', 'minervini-rulebook.md'), 'utf8')
  const rules = doc.slice(0, doc.indexOf('## Copertura nel codice'))
  const kinds = new Map<string, string>()
  for (const line of rules.split('\n')) {
    const cells = line.split('|').map((c) => c.trim())
    const match = /^[A-Z]{1,2}\d+$/.test(cells[1] ?? '') && /^(calcolo|giudizio|esterno)/.exec(cells[4] ?? '')
    if (match) kinds.set(cells[1], match[1])
  }
  return kinds
}

function documentIds(): string[] {
  const doc = readFileSync(join(process.cwd(), 'docs', 'minervini-rulebook.md'), 'utf8')
  const rules = doc.slice(0, doc.indexOf('## Copertura nel codice'))
  return [...rules.matchAll(/^\| ([A-Z]{1,2}\d+) \|/gm)].map((m) => m[1])
}

describe('rulebook', () => {
  it('has unique ids', () => {
    expect(RULE_IDS.size).toBe(RULES.length)
  })

  it('matches the ids in docs/minervini-rulebook.md, minus the ones left out on purpose', () => {
    const expected = documentIds().filter((id) => !LEFT_OUT.includes(id)).sort()
    expect(RULES.map((r) => r.id).sort()).toEqual(expected)
  })

  it('never contains a left-out rule', () => {
    for (const id of LEFT_OUT) expect(RULE_IDS.has(id)).toBe(false)
  })

  it('has a version and a prompt line per rule, marking the unverified ones', () => {
    expect(RULEBOOK_VERSION).toBeGreaterThan(0)
    const prompt = rulebookPrompt()
    for (const r of RULES) expect(prompt).toContain(`${r.id} `)
    expect(prompt).toMatch(/V5 \[calcolo, non verificata\]/)
    expect(prompt).toMatch(/TT1 \[calcolo, confermata\]/)
  })

  it('keeps the kind of each rule as in the document, except where it differs on purpose', () => {
    const kinds = documentKinds()
    for (const r of RULES) {
      if (KIND_DIFFERS_ON_PURPOSE.includes(r.id)) continue
      expect(`${r.id}:${r.kind}`).toBe(`${r.id}:${kinds.get(r.id)}`)
    }
  })

  it('words the rules as description of the method, not as orders to buy or sell', () => {
    for (const r of RULES) expect(r.rule).not.toMatch(/^(Si compra|Si vende|Compra|Vendi|Comprare|Vendere)\b/)
  })

  it('has a new version after the rewording', () => {
    expect(RULEBOOK_VERSION).toBeGreaterThanOrEqual(2)
  })
})
