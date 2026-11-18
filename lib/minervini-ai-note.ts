import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isLlmConfigured } from '@/lib/llm-news'
import { PROMPT_VERSION, buildInput, computeHash, generateAiResult, isAiResult, type AiResult } from '@/lib/minervini-ai'
import { getMinerviniAnalysis } from '@/lib/minervini-data'

export type AiNoteOutcome = { status: 'ok'; result: AiResult; cached: boolean } | { status: 'unavailable' }

const KEEP_DAYS = 14
// After the first generation of the day the numbers may change once more (fresh bars); beyond that the stored row is served as it is.
const MAX_REGENERATIONS = 1

interface Stored {
  result: AiResult
  regenerations: number
}

const today = () => new Date().toISOString().slice(0, 10)

// A row written by an older version, or by hand, reads as missing rather than reaching the client.
function readStored(json: unknown): Stored | null {
  if (typeof json !== 'object' || json === null) return null
  const { result, regenerations } = json as Record<string, unknown>
  return isAiResult(result) && typeof regenerations === 'number' ? { result, regenerations } : null
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

async function compute(symbol: string, day: string): Promise<AiNoteOutcome> {
  if (!isLlmConfigured()) return { status: 'unavailable' }
  const analysis = await getMinerviniAnalysis(symbol)
  if (!analysis) return { status: 'unavailable' }

  const input = buildInput(symbol, analysis)
  const inputHash = computeHash(input)
  const where = { symbol_day: { symbol, day } }

  const row = await prisma.minerviniAiNote.findUnique({ where })
  const stored = row ? readStored(row.result) : null
  if (row && stored && row.inputHash === inputHash) return { status: 'ok', result: stored.result, cached: true }
  if (stored && stored.regenerations >= MAX_REGENERATIONS) return { status: 'ok', result: stored.result, cached: true }

  const result = await generateAiResult(input)
  if (!result) return { status: 'unavailable' }

  const value: Stored = { result, regenerations: stored ? stored.regenerations + 1 : 0 }
  const data = { inputHash, result: value as unknown as Prisma.InputJsonValue, model: result.model, promptVersion: PROMPT_VERSION, generatedAt: new Date() }
  try {
    await prisma.minerviniAiNote.upsert({ where, create: { symbol, day, ...data }, update: data })
  } catch (err) {
    // Another instance saved the same symbol and day first: its answer is as good as ours.
    if (!isUniqueViolation(err)) throw err
    const winner = await prisma.minerviniAiNote.findUnique({ where })
    const winning = winner ? readStored(winner.result) : null
    if (!winning) throw err
    return { status: 'ok', result: winning.result, cached: true }
  }

  // Housekeeping only: a failure here must not lose an answer that was already paid for.
  try {
    const oldest = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await prisma.minerviniAiNote.deleteMany({ where: { day: { lt: oldest } } })
  } catch {
    // swept on a later request
  }
  return { status: 'ok', result, cached: false }
}

const inflight = new Map<string, Promise<AiNoteOutcome>>()

// One analysis per symbol and day: the stored one is reused while the numbers behind it are the same, and requests that arrive
// together on the same instance share one LLM call.
export function getAiNote(symbol: string): Promise<AiNoteOutcome> {
  const day = today()
  const key = `${symbol}:${day}`
  const running = inflight.get(key)
  if (running) return running
  const promise = compute(symbol, day).finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}
