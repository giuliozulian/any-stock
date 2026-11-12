import { connection } from 'next/server'
import { prisma } from '@/lib/db'

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

const HOURS: Record<string, string> = { bmo: 'prima dell’apertura', amc: 'dopo la chiusura', dmh: 'durante la seduta' }

// Calendar feed (.ics) with the next earnings date of every watched stock; also subscribable from iPhone/Google Calendar.
export async function GET() {
  await connection()
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const stocks = await prisma.stock.findMany({
    where: { nextEarningsDate: { gte: start } },
    orderBy: { nextEarningsDate: 'asc' },
  })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const events = stocks.flatMap((s) => {
    const day = s.nextEarningsDate!
    const next = new Date(day.getTime() + 24 * 60 * 60 * 1000)
    const details = [s.nextEarningsHour && HOURS[s.nextEarningsHour], s.nextEarningsEpsEstimate !== null && `EPS atteso ${s.nextEarningsEpsEstimate.toFixed(2)}`].filter(Boolean).join(' - ')
    return [
      'BEGIN:VEVENT',
      `UID:earnings-${s.symbol}-${ymd(day)}@any-stock`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(day)}`,
      `DTEND;VALUE=DATE:${ymd(next)}`,
      `SUMMARY:Trimestrale ${s.symbol}`,
      ...(details ? [`DESCRIPTION:${details}`] : []),
      'END:VEVENT',
    ]
  })
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//any-stock//earnings//IT', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Trimestrali watchlist', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n'
  return new Response(body, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="trimestrali.ics"' },
  })
}
