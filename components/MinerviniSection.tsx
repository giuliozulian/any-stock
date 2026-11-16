import { getMinerviniAnalysis } from '@/lib/minervini-data'
import { MinerviniPanel } from '@/components/MinerviniPanel'

export async function MinerviniSection({ symbol }: { symbol: string }) {
  const analysis = await getMinerviniAnalysis(symbol).catch(() => null)
  return <MinerviniPanel analysis={analysis} />
}
