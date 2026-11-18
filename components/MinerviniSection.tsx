import { getMinerviniAnalysis } from '@/lib/minervini-data'
import { MinerviniPanel } from '@/components/MinerviniPanel'
import { MinerviniAiAnalysis } from '@/components/MinerviniAiAnalysis'

export async function MinerviniSection({ symbol }: { symbol: string }) {
  const analysis = await getMinerviniAnalysis(symbol).catch(() => null)
  return (
    <>
      <MinerviniPanel analysis={analysis} symbol={symbol} />
      {analysis && <MinerviniAiAnalysis symbol={symbol} />}
    </>
  )
}
