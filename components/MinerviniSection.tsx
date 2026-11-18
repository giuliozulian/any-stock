import { getMinerviniAnalysis } from '@/lib/minervini-data'
import { MinerviniPanel } from '@/components/MinerviniPanel'
import { MinerviniAiAnalysis } from '@/components/MinerviniAiAnalysis'
import { emailConfigured } from '@/lib/notify'
import { getAlertState } from '@/lib/scan-alerts-db'
import { currentUserId } from '@/lib/watchlist'

export async function MinerviniSection({ symbol }: { symbol: string }) {
  const [analysis, armed] = await Promise.all([
    getMinerviniAnalysis(symbol).catch(() => null),
    currentUserId()
      .then(getAlertState)
      .then((s) => s.armed.includes(symbol.toUpperCase()))
      .catch(() => false),
  ])
  return (
    <>
      <MinerviniPanel analysis={analysis} symbol={symbol} alert={{ armed, emailReady: emailConfigured() }} />
      {analysis && <MinerviniAiAnalysis symbol={symbol} />}
    </>
  )
}
