import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/notify'
import { buildScanEmail, collectAlerts, type EmailItem } from '@/lib/scan-alerts'
import { duringSession, planFor, toScanRow } from '@/lib/scan-verdict'
import { marketHealth, type PlanContext } from '@/lib/scanner'
import type { Criterion } from '@/lib/minervini'

const SETTINGS_ID = 'default'

const latestDoneRun = () => prisma.scanRun.findFirst({ where: { status: 'done' }, orderBy: { finishedAt: 'desc' } })

// Sends the alerts of a scan that has just closed, as a single email. Marks them as sent only when the email really went out,
// so a failure is retried by the next scan. Never throws: a scan must close whatever happens to the email.
export async function notifyScanAlerts(runId: string): Promise<'sent' | 'nothing' | 'failed'> {
  try {
    const run = await prisma.scanRun.findUnique({ where: { id: runId } })
    if (!run || run.status !== 'done') return 'nothing'
    const results = await prisma.scanResult.findMany({ where: { runId, status: 'ok' } })
    const full = results.filter((r) => (r.passedCount ?? 0) >= 8)
    if (full.length === 0) return 'nothing'

    const [armed, settings] = await Promise.all([
      prisma.scanAlert.findMany({ where: { notifiedAt: null } }),
      prisma.scannerAlertSettings.findUnique({ where: { id: SETTINGS_ID } }),
    ])
    const { watched, entrants } = collectAlerts({
      full: full.map((r) => r.symbol),
      armed: armed.map((a) => a.symbol),
      newEntrantsOn: settings?.newEntrants ?? false,
      knownFull: settings?.knownFull ?? [],
    })
    if (watched.length + entrants.length === 0) return 'nothing'

    const market = marketHealth(results.map((r) => (Array.isArray(r.criteria) ? r.criteria : []) as unknown as Criterion[]))
    const sessionScan = duringSession(run.startedAt, run.finishedAt)
    const ctx: PlanContext = { caution: sessionScan ? 'session' : null, market: market?.level ?? null }
    const reasons = new Map<string, EmailItem['reason']>([...watched.map((s) => [s, 'watched'] as const), ...entrants.map((s) => [s, 'new'] as const)])
    const items: EmailItem[] = full
      .filter((r) => reasons.has(r.symbol))
      .map((r) => {
        const row = toScanRow(r)
        return { row, ...planFor(row, ctx), reason: reasons.get(r.symbol)! }
      })

    const email = buildScanEmail({ items, market, sessionScan, appUrl: process.env.APP_URL || null })
    const sent = await sendEmail(email.subject, email.text, email.html)
    if (!sent) return 'failed'

    await prisma.scanAlert.updateMany({ where: { symbol: { in: watched }, notifiedAt: null }, data: { notifiedAt: new Date() } })
    if (settings?.newEntrants) {
      await prisma.scannerAlertSettings.update({ where: { id: SETTINGS_ID }, data: { knownFull: full.map((r) => r.symbol) } })
    }
    return 'sent'
  } catch (err) {
    console.error('Scan alerts failed:', err instanceof Error ? err.message : String(err))
    return 'failed'
  }
}

// Arms the alert of one stock, which must be among the stocks the last complete scan could read.
export async function armAlert(symbol: string): Promise<'ok' | 'unknown-symbol'> {
  const run = await latestDoneRun()
  const known = run ? await prisma.scanResult.findFirst({ where: { runId: run.id, symbol, status: 'ok' }, select: { id: true } }) : null
  if (!known) return 'unknown-symbol'
  await prisma.scanAlert.upsert({ where: { symbol }, create: { symbol }, update: { armedAt: new Date(), notifiedAt: null } })
  return 'ok'
}

export async function disarmAlert(symbol: string): Promise<void> {
  await prisma.scanAlert.deleteMany({ where: { symbol } })
}

// Turning the switch on remembers the stocks that are already 8 of 8, so the first email only lists what comes after.
// Turning it on again while it is already on changes nothing: it must not forget the pending new entrants.
export async function setNewEntrants(on: boolean): Promise<void> {
  const current = await prisma.scannerAlertSettings.findUnique({ where: { id: SETTINGS_ID } })
  if (on && !(current?.newEntrants ?? false)) {
    const run = await latestDoneRun()
    const rows = run ? await prisma.scanResult.findMany({ where: { runId: run.id, status: 'ok', passedCount: { gte: 8 } }, select: { symbol: true } }) : []
    const knownFull = rows.map((r) => r.symbol)
    await prisma.scannerAlertSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, newEntrants: true, knownFull },
      update: { newEntrants: true, knownFull },
    })
    return
  }
  await prisma.scannerAlertSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, newEntrants: on }, update: { newEntrants: on } })
}

export async function getAlertState(): Promise<{ armed: string[]; newEntrants: boolean }> {
  const [armed, settings] = await Promise.all([
    prisma.scanAlert.findMany({ where: { notifiedAt: null }, orderBy: { symbol: 'asc' }, select: { symbol: true } }),
    prisma.scannerAlertSettings.findUnique({ where: { id: SETTINGS_ID } }),
  ])
  return { armed: armed.map((a) => a.symbol), newEntrants: settings?.newEntrants ?? false }
}
