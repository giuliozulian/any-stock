import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/notify'
import { buildScanEmail, collectAlerts, type EmailItem } from '@/lib/scan-alerts'
import { duringSession, planFor, toScanRow } from '@/lib/scan-verdict'
import { marketHealth, type PlanContext } from '@/lib/scanner'
import type { Criterion } from '@/lib/minervini'

const latestDoneRun = () => prisma.scanRun.findFirst({ where: { status: 'done' }, orderBy: { finishedAt: 'desc' } })

// Sends the alerts of a scan that has just closed: one email per user, to that user's own address, from their own armed stocks and switch.
// A user's alerts are marked as sent only when their email really went out, so a failure is retried by the next scan.
// Never throws: a scan must close whatever happens to the email.
export async function notifyScanAlerts(runId: string): Promise<'sent' | 'nothing' | 'failed'> {
  try {
    const run = await prisma.scanRun.findUnique({ where: { id: runId } })
    if (!run || run.status !== 'done') return 'nothing'
    const results = await prisma.scanResult.findMany({ where: { runId, status: 'ok' } })
    const market = marketHealth(results.map((r) => (Array.isArray(r.criteria) ? r.criteria : []) as unknown as Criterion[]))
    const sessionScan = duringSession(run.startedAt, run.finishedAt)
    const ctx: PlanContext = { caution: sessionScan ? 'session' : null, market: market?.level ?? null }

    // Ready to buy = the verdict is still "buy" once the context of the scan is applied (open market or weak market downgrade it).
    const ready = results
      .filter((r) => (r.passedCount ?? 0) >= 8)
      .map((r) => {
        const row = toScanRow(r)
        return { symbol: r.symbol, row, ...planFor(row, ctx) }
      })
      .filter((x) => x.plan.verdict === 'buy')
    const readySymbols = ready.map((x) => x.symbol)

    const [armed, settings] = await Promise.all([prisma.scanAlert.findMany({ where: { notifiedAt: null } }), prisma.scannerAlertSettings.findMany()])
    const userIds = new Set([...armed.map((a) => a.userId), ...settings.filter((s) => s.newEntrants).map((s) => s.userId)])
    if (userIds.size === 0) return 'nothing'

    let sentAny = false
    let failedAny = false
    for (const userId of userIds) {
      const mine = armed.filter((a) => a.userId === userId)
      const own = settings.find((s) => s.userId === userId)
      const { watched, entrants } = collectAlerts({
        ready: readySymbols,
        armed: mine.map((a) => a.symbol),
        newEntrantsOn: own?.newEntrants ?? false,
        knownReady: own?.knownFull ?? [],
      })
      if (watched.length + entrants.length === 0) {
        // Nothing to send: keep the list of ready stocks current, so one that drops out and comes back later is news again.
        if (own?.newEntrants) await prisma.scannerAlertSettings.update({ where: { userId }, data: { knownFull: readySymbols } })
        continue
      }

      const reasons = new Map<string, EmailItem['reason']>([...watched.map((s) => [s, 'watched'] as const), ...entrants.map((s) => [s, 'new'] as const)])
      const items: EmailItem[] = ready.filter((x) => reasons.has(x.symbol)).map((x) => ({ row: x.row, plan: x.plan, note: x.note, reason: reasons.get(x.symbol)! }))

      const email = buildScanEmail({ items, market, sessionScan, appUrl: process.env.APP_URL || null })
      const recipient = mine[0]?.userEmail ?? own?.userEmail ?? null
      if (!(await sendEmail(email.subject, email.text, email.html, recipient))) {
        failedAny = true
        continue
      }
      sentAny = true
      await prisma.scanAlert.updateMany({ where: { userId, symbol: { in: watched }, notifiedAt: null }, data: { notifiedAt: new Date() } })
      if (own?.newEntrants) await prisma.scannerAlertSettings.update({ where: { userId }, data: { knownFull: readySymbols } })
    }
    return failedAny ? 'failed' : sentAny ? 'sent' : 'nothing'
  } catch (err) {
    console.error('Scan alerts failed:', err instanceof Error ? err.message : String(err))
    return 'failed'
  }
}

interface Owner {
  id: string
  email: string | null
}

// Arms the alert of one stock for one user; the stock must be among the stocks the last complete scan could read.
async function isFollowed(symbol: string): Promise<boolean> {
  const [stock, candidate] = await Promise.all([
    prisma.stock.findUnique({ where: { symbol }, select: { id: true } }),
    prisma.discoveredCandidate.findFirst({ where: { symbol, dismissedAt: null, market: 'US' }, select: { id: true } }),
  ])
  return Boolean(stock || candidate)
}

export async function armAlert(owner: Owner, symbol: string): Promise<'ok' | 'unknown-symbol'> {
  const run = await latestDoneRun()
  const known = run ? await prisma.scanResult.findFirst({ where: { runId: run.id, symbol, status: 'ok' }, select: { id: true } }) : null
  // A followed stock that the last scan did not include yet is scanned from the next run on, so it can be armed too.
  if (!known && !(await isFollowed(symbol))) return 'unknown-symbol'
  await prisma.scanAlert.upsert({
    where: { userId_symbol: { userId: owner.id, symbol } },
    create: { userId: owner.id, userEmail: owner.email, symbol },
    update: { userEmail: owner.email, armedAt: new Date(), notifiedAt: null },
  })
  return 'ok'
}

export async function disarmAlert(userId: string, symbol: string): Promise<void> {
  await prisma.scanAlert.deleteMany({ where: { userId, symbol } })
}

// Turning the switch on remembers the stocks that are already ready to buy (stored in knownFull), so the first email only lists what comes after.
// Turning it on again while it is already on changes nothing: it must not forget the pending new entrants.
export async function setNewEntrants(owner: Owner, on: boolean): Promise<void> {
  const current = await prisma.scannerAlertSettings.findUnique({ where: { userId: owner.id } })
  if (on && !(current?.newEntrants ?? false)) {
    const run = await latestDoneRun()
    const results = run ? await prisma.scanResult.findMany({ where: { runId: run.id, status: 'ok' } }) : []
    const market = marketHealth(results.map((r) => (Array.isArray(r.criteria) ? r.criteria : []) as unknown as Criterion[]))
    const ctx: PlanContext = { caution: run && duringSession(run.startedAt, run.finishedAt) ? 'session' : null, market: market?.level ?? null }
    const knownFull = results.filter((r) => (r.passedCount ?? 0) >= 8 && planFor(toScanRow(r), ctx).plan.verdict === 'buy').map((r) => r.symbol)
    await prisma.scannerAlertSettings.upsert({
      where: { userId: owner.id },
      create: { userId: owner.id, userEmail: owner.email, newEntrants: true, knownFull },
      update: { userEmail: owner.email, newEntrants: true, knownFull },
    })
    return
  }
  await prisma.scannerAlertSettings.upsert({
    where: { userId: owner.id },
    create: { userId: owner.id, userEmail: owner.email, newEntrants: on },
    update: { userEmail: owner.email, newEntrants: on },
  })
}

export async function getAlertState(userId: string): Promise<{ armed: string[]; newEntrants: boolean }> {
  const [armed, settings] = await Promise.all([
    prisma.scanAlert.findMany({ where: { userId, notifiedAt: null }, orderBy: { symbol: 'asc' }, select: { symbol: true } }),
    prisma.scannerAlertSettings.findUnique({ where: { userId } }),
  ])
  return { armed: armed.map((a) => a.symbol), newEntrants: settings?.newEntrants ?? false }
}
