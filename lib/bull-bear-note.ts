import type { FairValueResult } from './fair-value'
import { createHash } from 'node:crypto'
import { prisma } from './db'
import { isLlmConfigured, requestLlmJson } from './llm-news'
import {
  buildVerdictContext,
  computeVerdictNoteHash,
  loadVerdictInput,
  type VerdictNoteInput,
} from './verdict-note'

export interface BullBearResult {
  bull: string[]
  bear: string[]
  model: string
}

const PROMPT_VERSION = 1
const MAX_POINTS = 4

const SYSTEM_PROMPT = `Sei un analista azionario prudente che prepara, per un investitore non esperto, gli argomenti a favore e contro un titolo.
Ricevi i dati già calcolati dall'app. Usa SOLO quei dati: non inventare numeri o fatti, non fare previsioni di prezzo, non dare consigli di acquisto o vendita. Ogni argomento deve poggiare su un dato fornito; se mancano dati per un lato, restituisci meno punti invece di riempire.
Rispondi SOLO con un oggetto JSON con questi campi:
- bull: da 1 a 4 argomenti a favore, in italiano, massimo 150 caratteri ciascuno
- bear: da 1 a 4 argomenti contro o rischi, in italiano, massimo 150 caratteri ciascuno`

export function computeBullBearHash(input: VerdictNoteInput): string {
  return createHash('sha256')
    .update(`bb${PROMPT_VERSION}:${computeVerdictNoteHash(input)}`)
    .digest('hex')
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().slice(0, 220))
    .slice(0, MAX_POINTS)
}

export function parseBullBear(raw: unknown, model: string): BullBearResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const bull = cleanList(r.bull)
  const bear = cleanList(r.bear)
  if (bull.length === 0 && bear.length === 0) return null
  return { bull, bear, model }
}

export async function generateBullBear(input: VerdictNoteInput): Promise<BullBearResult | null> {
  const result = await requestLlmJson(SYSTEM_PROMPT, buildVerdictContext(input))
  if (!result) return null
  return parseBullBear(result.json, result.model)
}

export async function refreshBullBearNote(stockId: string, fairValue: FairValueResult | null = null): Promise<'skipped' | 'unchanged' | 'updated' | 'failed'> {
  if (!isLlmConfigured()) return 'skipped'
  const input = await loadVerdictInput(stockId, fairValue)
  if (!input) return 'skipped'

  const existing = await prisma.stockBullBearNote.findUnique({ where: { stockId }, select: { inputHash: true } })
  const inputHash = computeBullBearHash(input)
  if (existing?.inputHash === inputHash) return 'unchanged'

  const result = await generateBullBear(input)
  if (!result) return 'failed'

  const data = { bull: result.bull, bear: result.bear, model: result.model, inputHash, generatedAt: new Date() }
  await prisma.stockBullBearNote.upsert({ where: { stockId }, create: { stockId, ...data }, update: data })
  return 'updated'
}
