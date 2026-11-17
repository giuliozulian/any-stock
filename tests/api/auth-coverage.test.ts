import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? routeFiles(path) : name === 'route.ts' ? [path] : []
  })
}

const API = join(process.cwd(), 'app', 'api')
// These authenticate in their own way: the cron secret, or a mandatory token (see tests/api/feeds.test.ts).
const OWN_AUTH = ['cron/', 'widget/', 'calendar/']

describe('every API route is protected', () => {
  const files = routeFiles(API).map((file) => relative(API, file))

  it('finds the routes', () => {
    expect(files.length).toBeGreaterThan(15)
  })

  it.each(files.filter((f) => !OWN_AUTH.some((p) => f.startsWith(p))))('%s calls requireUser in each exported handler', (file) => {
    const source = readFileSync(join(API, file), 'utf8')
    const handlers = source.match(/^export async function (GET|POST|PUT|PATCH|DELETE)\b/gm) ?? []
    const checks = source.match(/await requireUser\(/g) ?? []
    expect(handlers.length).toBeGreaterThan(0)
    expect(checks.length).toBe(handlers.length)
  })
})
