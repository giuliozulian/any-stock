import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'api') return []
    return statSync(path).isDirectory() ? pageFiles(path) : name === 'page.tsx' ? [path] : []
  })
}

const APP = join(process.cwd(), 'app')

describe('every page is behind the login', () => {
  const pages = pageFiles(APP).map((file) => relative(APP, file))

  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(9)
  })

  it.each(pages.filter((p) => p !== join('login', 'page.tsx')))('%s wraps its content in <AuthGate>', (file) => {
    const source = readFileSync(join(APP, file), 'utf8')
    expect(source).toContain("from '@/components/AuthGate'")
    expect(source).toMatch(/<AuthGate path=/)
  })
})
