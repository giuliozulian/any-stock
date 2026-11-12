# Stock Insight (riassunto e valutazione news + video) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per ogni titolo, Gemini genera un riassunto in italiano e una valutazione prudente basati su news e video recenti, mostrati nella pagina stock.

**Architecture:** Un nuovo modulo `lib/stock-insight.ts` costruisce l'input (news + metadati video), calcola un hash e, solo se cambiato, chiama Gemini tramite una funzione condivisa `requestLlmJson` estratta da `lib/llm-news.ts`. Il risultato è salvato in `StockInsight` (upsert) dal passo di refresh e mostrato da `components/InsightPanel.tsx`.

**Tech Stack:** Next.js (App Router), Prisma 7 + Postgres, vitest, Gemini via endpoint OpenAI-compatibile.

## Global Constraints

- Testi UI e prompt in italiano; nessuna previsione di prezzo; avviso "Non è consulenza finanziaria" nel riquadro.
- Niente chiamate LLM durante il rendering della pagina.
- Dei video si usano solo metadati (titolo, canale, data): niente trascrizioni.
- Massimo 10 news e 6 video in input; `keyPoints` e `risks` massimo 4 elementi ciascuno.
- Un errore nel passo insight non deve mai far fallire `refreshStock`.
- Stile del codice in `lib/`: senza punto e virgola e apici singoli (come `lib/refresh.ts`); `lib/llm-news.ts` usa punto e virgola e apici doppi, quindi lì si mantiene il suo stile.
- Test di integrazione richiedono Postgres di test: `docker compose -f docker-compose.test.yml up -d` (porta 5433, DB `any_stock_test`).

## File Structure

- Modify `lib/llm-news.ts`: estrae `requestLlmJson` (chiamata HTTP + retry + parsing JSON) e `isLlmConfigured` resta; `analyzeNewsWithLlm` la usa.
- Create `lib/stock-insight.ts`: tipi, `buildInsightInput`, `computeInputHash`, `parseInsight`, `generateInsight`, `refreshStockInsight`.
- Modify `prisma/schema.prisma` + new migration: modello `StockInsight`.
- Modify `lib/refresh.ts`: chiama `refreshStockInsight` in un `try/catch`.
- Create `components/InsightPanel.tsx` e `components/InsightPanel.module.css`.
- Modify `app/stock/[symbol]/page.tsx`: legge e mostra l'insight.
- Create `tests/lib/stock-insight.test.ts`.

---

### Task 1: Estrarre `requestLlmJson` da `llm-news.ts`

**Files:**
- Modify: `lib/llm-news.ts` (funzione `analyzeNewsWithLlm`, righe ~120-186)
- Test: `tests/lib/llm-news.test.ts` (esistente, deve continuare a passare)

**Interfaces:**
- Produces: `export async function requestLlmJson(system: string, user: string): Promise<{ json: unknown; model: string } | null>` — `null` se LLM non configurato, contenuto vuoto o non JSON; lancia `Error` su HTTP non ok o risposta non JSON del provider.

- [ ] **Step 1: Verificare che i test esistenti passino**

Run: `npx vitest run tests/lib/llm-news.test.ts`
Expected: PASS

- [ ] **Step 2: Sostituire `analyzeNewsWithLlm` con `requestLlmJson` + wrapper**

In `lib/llm-news.ts` sostituire l'intera funzione `analyzeNewsWithLlm` (dall'`export async function analyzeNewsWithLlm(` fino alla fine del file) con:

```ts
export async function requestLlmJson(
  system: string,
  user: string,
): Promise<{ json: unknown; model: string } | null> {
  const cfg = config();
  if (!cfg) return null;
  const { key: token, model } = cfg;
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const request = () =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  // Picchi di domanda temporanei (503) e rate limit (429): un solo nuovo tentativo.
  let res = await request();
  if (res.status === 503 || res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await request();
  }

  if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);

  const text = await res.text();
  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Il provider LLM ha risposto con un contenuto non JSON (${res.status} ${res.headers.get("content-type")}): "${text.slice(0, 40).trim()}"`,
    );
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return { json: JSON.parse(content), model };
  } catch {
    return null;
  }
}

export async function analyzeNewsWithLlm(
  ctx: NewsAnalysisContext,
): Promise<LlmNewsAnalysis | null> {
  const result = await requestLlmJson(SYSTEM_PROMPT, buildUserPrompt(ctx));
  if (!result) return null;
  return parseLlmAnalysis(result.json, result.model);
}
```

- [ ] **Step 3: Rieseguire i test**

Run: `npx vitest run tests/lib/llm-news.test.ts`
Expected: PASS (comportamento invariato)

- [ ] **Step 4: Commit**

```bash
git add lib/llm-news.ts
git commit -m "refactor: extract requestLlmJson from llm-news"
```

---

### Task 2: Modello `StockInsight` e migrazione

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261112170000_add_stock_insight/migration.sql`

**Interfaces:**
- Produces: `prisma.stockInsight` con campi `id, stockId (unique), summary, verdict, score, keyPoints String[], risks String[], confidence, inputHash, model, generatedAt`; relazione `Stock.insight`.

- [ ] **Step 1: Aggiungere la relazione a `Stock`**

In `model Stock`, dopo `recommendations AnalystRecommendation[]` aggiungere:

```prisma
  insight         StockInsight?
```

- [ ] **Step 2: Aggiungere il modello in fondo a `schema.prisma`**

```prisma
model StockInsight {
  id          String   @id @default(cuid())
  stockId     String   @unique
  stock       Stock    @relation(fields: [stockId], references: [id], onDelete: Cascade)
  summary     String
  verdict     String
  score       Int
  keyPoints   String[]
  risks       String[]
  confidence  String
  inputHash   String
  model       String
  generatedAt DateTime @default(now())
}
```

- [ ] **Step 3: Creare la migrazione**

```sql
-- CreateTable
CREATE TABLE "StockInsight" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "keyPoints" TEXT[],
    "risks" TEXT[],
    "confidence" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockInsight_stockId_key" ON "StockInsight"("stockId");

-- AddForeignKey
ALTER TABLE "StockInsight" ADD CONSTRAINT "StockInsight_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Rigenerare il client e validare**

Run: `npx prisma generate && npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid" (se `validate` chiede `DATABASE_URL`, usare `DATABASE_URL=postgresql://x npx prisma validate`)

- [ ] **Step 5: Applicare al DB di test**

Run: `docker compose -f docker-compose.test.yml up -d && DATABASE_URL="postgresql://postgres:postgres@localhost:5433/any_stock_test" npx prisma migrate deploy`
Expected: "All migrations have been successfully applied." (controllare in `package.json`/`tests/setup.ts` se il setup applica già le migrazioni e, in quel caso, saltare questo comando)

- [ ] **Step 6: Commit**

```bash
git add prisma
git commit -m "feat: add StockInsight model"
```

---

### Task 3: Logica pura in `lib/stock-insight.ts` (TDD)

**Files:**
- Create: `lib/stock-insight.ts`
- Test: `tests/lib/stock-insight.test.ts`

**Interfaces:**
- Consumes: `requestLlmJson` (Task 1).
- Produces:
  - `type Verdict = 'positive' | 'neutral' | 'negative'`, `type Confidence = 'low' | 'medium' | 'high'`
  - `interface InsightInput { stock: { symbol: string; name: string }; news: { headline: string; source: string; publishedAt: Date; summary: string | null }[]; videos: { title: string; channel: string; publishedAt: string }[] }`
  - `interface InsightResult { summary: string; verdict: Verdict; score: number; keyPoints: string[]; risks: string[]; confidence: Confidence; model: string }`
  - `buildInsightInput(stock, news, videos): InsightInput`
  - `computeInputHash(input: InsightInput): string`
  - `parseInsight(raw: unknown, model: string): InsightResult | null`
  - `generateInsight(input: InsightInput): Promise<InsightResult | null>`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/lib/stock-insight.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInsightInput, computeInputHash, generateInsight, parseInsight } from '@/lib/stock-insight'

const valid = {
  summary: 'Conti solidi, video prudenti.',
  verdict: 'positive',
  score: 4,
  keyPoints: ['Ricavi oltre le attese'],
  risks: ['Valutazione elevata'],
  confidence: 'medium',
}
const stock = { symbol: 'NVDA', name: 'NVIDIA Corporation' }
const news = [{ headline: 'NVIDIA beats', source: 'Yahoo', publishedAt: new Date('2026-11-12T10:00:00Z'), summary: null }]
const videos = [{ id: 'a', title: 'NVDA analysis', channel: 'Chan', publishedAt: '2026-11-11T10:00:00Z', thumbnail: 't' }]

describe('parseInsight', () => {
  it('accepts a valid payload', () => {
    expect(parseInsight(valid, 'm')).toMatchObject({ verdict: 'positive', score: 4, model: 'm' })
  })
  it('truncates lists to 4 items', () => {
    const r = parseInsight({ ...valid, keyPoints: ['1', '2', '3', '4', '5', '6'] }, 'm')
    expect(r?.keyPoints).toEqual(['1', '2', '3', '4'])
  })
  it.each([
    { ...valid, verdict: 'up' },
    { ...valid, score: 9 },
    { ...valid, summary: '' },
    { ...valid, confidence: 'huge' },
    { ...valid, keyPoints: 'nope' },
    null,
  ])('rejects invalid payload %#', (bad) => {
    expect(parseInsight(bad, 'm')).toBeNull()
  })
})

describe('buildInsightInput', () => {
  it('limits news to 10 and videos to 6', () => {
    const manyNews = Array.from({ length: 15 }, (_, i) => ({ ...news[0], headline: `n${i}` }))
    const manyVideos = Array.from({ length: 9 }, (_, i) => ({ ...videos[0], id: `v${i}` }))
    const input = buildInsightInput(stock, manyNews, manyVideos)
    expect(input.news).toHaveLength(10)
    expect(input.videos).toHaveLength(6)
  })
})

describe('computeInputHash', () => {
  it('is stable for the same input and ignores video order', () => {
    const a = buildInsightInput(stock, news, [videos[0], { ...videos[0], title: 'Other' }])
    const b = buildInsightInput(stock, news, [{ ...videos[0], title: 'Other' }, videos[0]])
    expect(computeInputHash(a)).toBe(computeInputHash(b))
  })
  it('changes when a news item changes', () => {
    const a = buildInsightInput(stock, news, videos)
    const b = buildInsightInput(stock, [{ ...news[0], headline: 'Different' }], videos)
    expect(computeInputHash(a)).not.toBe(computeInputHash(b))
  })
})

describe('generateInsight', () => {
  beforeEach(() => {
    vi.stubEnv('LLM_API_KEY', 'test-token')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns a parsed insight from the LLM response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] }), { status: 200 }),
      ),
    )
    const r = await generateInsight(buildInsightInput(stock, news, videos))
    expect(r).toMatchObject({ verdict: 'positive', score: 4 })
  })

  it('returns null without a configured LLM and does not call the API', async () => {
    vi.stubEnv('LLM_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await generateInsight(buildInsightInput(stock, news, videos))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/lib/stock-insight.test.ts`
Expected: FAIL (modulo `@/lib/stock-insight` non trovato)

- [ ] **Step 3: Implementare**

`lib/stock-insight.ts`:

```ts
import { createHash } from 'node:crypto'
import { requestLlmJson } from './llm-news'

export type Verdict = 'positive' | 'neutral' | 'negative'
export type Confidence = 'low' | 'medium' | 'high'

export interface InsightInput {
  stock: { symbol: string; name: string }
  news: { headline: string; source: string; publishedAt: Date; summary: string | null }[]
  videos: { title: string; channel: string; publishedAt: string }[]
}

export interface InsightResult {
  summary: string
  verdict: Verdict
  score: number
  keyPoints: string[]
  risks: string[]
  confidence: Confidence
  model: string
}

const MAX_NEWS = 10
const MAX_VIDEOS = 6
const MAX_LIST = 4
const SUMMARY_CHARS = 400

const SYSTEM_PROMPT = `Sei un analista azionario prudente. Ricevi le ultime notizie e i titoli dei video YouTube recenti su un titolo quotato.
Scrivi un riassunto e una valutazione complessiva, solo in base al contenuto fornito. Non inventare fatti e non fare previsioni di prezzo.
Le notizie sono più affidabili dei video: i video sono opinioni di terzi, usali solo come segnale di sentiment e pesali meno.
Se il materiale è scarso o non riguarda davvero il titolo, usa verdict "neutral" e confidence "low".
Rispondi SOLO con un oggetto JSON con questi campi:
- summary: riassunto in italiano, massimo 500 caratteri, parole semplici
- verdict: "positive" | "neutral" | "negative" (tono complessivo del materiale per il titolo)
- score: intero da 1 (segnale debolissimo) a 5 (segnale molto forte) sulla forza del verdetto
- keyPoints: da 1 a 4 punti chiave in italiano, ciascuno massimo 140 caratteri
- risks: da 0 a 4 rischi o incognite in italiano, ciascuno massimo 140 caratteri
- confidence: "low" | "medium" | "high" (quanto il materiale basta a giudicare)`

export function buildInsightInput(
  stock: { symbol: string; name: string },
  news: InsightInput['news'],
  videos: { title: string; channel: string; publishedAt: string }[],
): InsightInput {
  return {
    stock: { symbol: stock.symbol, name: stock.name },
    news: news.slice(0, MAX_NEWS).map((n) => ({
      headline: n.headline,
      source: n.source,
      publishedAt: n.publishedAt,
      summary: n.summary ? n.summary.slice(0, SUMMARY_CHARS) : null,
    })),
    videos: videos
      .slice(0, MAX_VIDEOS)
      .map((v) => ({ title: v.title, channel: v.channel, publishedAt: v.publishedAt })),
  }
}

export function computeInputHash(input: InsightInput): string {
  const payload = {
    symbol: input.stock.symbol,
    news: input.news.map((n) => [n.headline, n.publishedAt.toISOString(), n.summary]),
    // L'ordine per rilevanza di YouTube può cambiare senza che cambi il contenuto.
    videos: input.videos.map((v) => [v.title, v.channel, v.publishedAt]).sort((a, b) => a.join('|').localeCompare(b.join('|'))),
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function stringList(value: unknown, min: number): string[] | null {
  if (!Array.isArray(value)) return null
  const items = value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().slice(0, 200))
    .slice(0, MAX_LIST)
  return items.length >= min ? items : null
}

export function parseInsight(raw: unknown, model: string): InsightResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const summary = typeof r.summary === 'string' ? r.summary.trim() : ''
  const score = typeof r.score === 'number' ? Math.round(r.score) : NaN
  const keyPoints = stringList(r.keyPoints, 1)
  const risks = stringList(r.risks, 0)

  if (summary.length === 0) return null
  if (r.verdict !== 'positive' && r.verdict !== 'neutral' && r.verdict !== 'negative') return null
  if (r.confidence !== 'low' && r.confidence !== 'medium' && r.confidence !== 'high') return null
  if (!Number.isFinite(score) || score < 1 || score > 5) return null
  if (!keyPoints || !risks) return null

  return { summary: summary.slice(0, 600), verdict: r.verdict, score, keyPoints, risks, confidence: r.confidence, model }
}

function buildUserPrompt({ stock, news, videos }: InsightInput): string {
  const newsLines = news.map(
    (n) => `- [${n.publishedAt.toISOString().slice(0, 10)}] ${n.source}: ${n.headline}${n.summary ? ` — ${n.summary}` : ''}`,
  )
  const videoLines = videos.map((v) => `- [${v.publishedAt.slice(0, 10)}] ${v.channel}: ${v.title}`)
  return [
    `Titolo: ${stock.name} (${stock.symbol})`,
    `Notizie recenti:\n${newsLines.length ? newsLines.join('\n') : '(nessuna)'}`,
    `Video YouTube recenti (solo titoli):\n${videoLines.length ? videoLines.join('\n') : '(nessuno)'}`,
  ].join('\n\n')
}

export async function generateInsight(input: InsightInput): Promise<InsightResult | null> {
  const result = await requestLlmJson(SYSTEM_PROMPT, buildUserPrompt(input))
  if (!result) return null
  return parseInsight(result.json, result.model)
}
```

- [ ] **Step 4: Verificare che passino**

Run: `npx vitest run tests/lib/stock-insight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/stock-insight.ts tests/lib/stock-insight.test.ts
git commit -m "feat: add stock insight generation logic"
```

---

### Task 4: `refreshStockInsight` e integrazione nel refresh (TDD)

**Files:**
- Modify: `lib/stock-insight.ts` (aggiungere in fondo e gli import)
- Modify: `lib/refresh.ts` (dopo il blocco `News analysis`)
- Test: `tests/lib/stock-insight.test.ts` (aggiungere un `describe`)

**Interfaces:**
- Consumes: `generateInsight`, `buildInsightInput`, `computeInputHash` (Task 3), `getRecentVideos` da `lib/youtube`, `isLlmConfigured` da `lib/llm-news`, `prisma.stockInsight` (Task 2).
- Produces: `export async function refreshStockInsight(stockId: string): Promise<'skipped' | 'unchanged' | 'updated' | 'failed'>`.

- [ ] **Step 1: Aggiungere i test che falliscono**

In testa a `tests/lib/stock-insight.test.ts` aggiungere gli import `import { prisma } from '@/lib/db'`, `import { resetDb } from '../helpers/db'`, `import * as llm from '@/lib/llm-news'`, `import * as youtube from '@/lib/youtube'` e estendere l'import da `@/lib/stock-insight` con `refreshStockInsight`. In fondo al file:

```ts
describe('refreshStockInsight', () => {
  let stockId: string

  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
    vi.stubEnv('LLM_API_KEY', 'test-token')
    const s = await prisma.stock.create({ data: { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' } })
    stockId = s.id
    vi.spyOn(youtube, 'getRecentVideos').mockResolvedValue([])
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function addNews(headline: string) {
    await prisma.newsItem.create({
      data: { stockId, headline, url: `https://x/${headline}`, source: 'Yahoo', publishedAt: new Date('2026-11-12T10:00:00Z') },
    })
  }

  it('skips when there is no news and no video', async () => {
    const spy = vi.spyOn(llm, 'requestLlmJson')
    expect(await refreshStockInsight(stockId)).toBe('skipped')
    expect(spy).not.toHaveBeenCalled()
  })

  it('stores the insight, then skips the LLM when inputs are unchanged', async () => {
    await addNews('NVIDIA beats')
    const spy = vi.spyOn(llm, 'requestLlmJson').mockResolvedValue({ json: valid, model: 'm' })

    expect(await refreshStockInsight(stockId)).toBe('updated')
    const saved = await prisma.stockInsight.findUniqueOrThrow({ where: { stockId } })
    expect(saved).toMatchObject({ verdict: 'positive', score: 4, keyPoints: ['Ricavi oltre le attese'] })

    expect(await refreshStockInsight(stockId)).toBe('unchanged')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('regenerates when a new news item arrives', async () => {
    await addNews('NVIDIA beats')
    const spy = vi.spyOn(llm, 'requestLlmJson').mockResolvedValue({ json: valid, model: 'm' })
    await refreshStockInsight(stockId)
    await addNews('NVIDIA new chip')
    expect(await refreshStockInsight(stockId)).toBe('updated')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('keeps the previous insight when the LLM answer is invalid', async () => {
    await addNews('NVIDIA beats')
    vi.spyOn(llm, 'requestLlmJson').mockResolvedValueOnce({ json: valid, model: 'm' })
    await refreshStockInsight(stockId)
    await addNews('NVIDIA new chip')
    vi.spyOn(llm, 'requestLlmJson').mockResolvedValueOnce({ json: { bad: true }, model: 'm' })
    expect(await refreshStockInsight(stockId)).toBe('failed')
    const saved = await prisma.stockInsight.findUniqueOrThrow({ where: { stockId } })
    expect(saved.summary).toBe(valid.summary)
  })
})
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/lib/stock-insight.test.ts -t refreshStockInsight`
Expected: FAIL (`refreshStockInsight` non esportata)

- [ ] **Step 3: Implementare**

In `lib/stock-insight.ts` cambiare gli import in testa:

```ts
import { createHash } from 'node:crypto'
import { prisma } from './db'
import { isLlmConfigured, requestLlmJson } from './llm-news'
import { getRecentVideos } from './youtube'
```

E aggiungere in fondo:

```ts
export type InsightStatus = 'skipped' | 'unchanged' | 'updated' | 'failed'

// Un errore YouTube non blocca: si procede con le sole news. Gli errori LLM si propagano al chiamante.
export async function refreshStockInsight(stockId: string): Promise<InsightStatus> {
  if (!isLlmConfigured()) return 'skipped'

  const stock = await prisma.stock.findUnique({
    where: { id: stockId },
    include: { news: { orderBy: { publishedAt: 'desc' }, take: MAX_NEWS }, insight: true },
  })
  if (!stock) return 'skipped'

  const videos = await getRecentVideos(stock.symbol, stock.name).catch(() => [])
  if (stock.news.length === 0 && videos.length === 0) return 'skipped'

  const input = buildInsightInput(stock, stock.news, videos)
  const inputHash = computeInputHash(input)
  if (stock.insight?.inputHash === inputHash) return 'unchanged'

  const result = await generateInsight(input)
  if (!result) return 'failed'

  const data = {
    summary: result.summary,
    verdict: result.verdict,
    score: result.score,
    keyPoints: result.keyPoints,
    risks: result.risks,
    confidence: result.confidence,
    model: result.model,
    inputHash,
    generatedAt: new Date(),
  }
  await prisma.stockInsight.upsert({ where: { stockId }, create: { stockId, ...data }, update: data })
  return 'updated'
}
```

Nota: `getRecentVideos` ha già un proprio `try/catch`, il `.catch` extra è una protezione per mock che rifiutano.

- [ ] **Step 4: Integrare in `lib/refresh.ts`**

Aggiungere l'import `import { refreshStockInsight } from './stock-insight'` e, dopo il blocco `News analysis`:

```ts
    try {
      await refreshStockInsight(stock.id)
    } catch (err) {
      logFailure('Stock insight', symbol, err)
    }
```

- [ ] **Step 5: Eseguire test del modulo e del refresh**

Run: `npx vitest run tests/lib/stock-insight.test.ts tests/lib/refresh.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/stock-insight.ts lib/refresh.ts tests/lib/stock-insight.test.ts
git commit -m "feat: generate stock insight during refresh"
```

---

### Task 5: UI — `InsightPanel` e pagina stock

**Files:**
- Create: `components/InsightPanel.tsx`
- Create: `components/InsightPanel.module.css`
- Modify: `app/stock/[symbol]/page.tsx` (query `include`, tab `notizie`)

**Interfaces:**
- Consumes: `prisma.stock.findUnique({ include: { insight: true } })` (Task 2).
- Produces: `<InsightPanel insight={...} />`, props: `{ summary: string; verdict: string; score: number; keyPoints: string[]; risks: string[]; confidence: string; generatedAt: Date }`.

- [ ] **Step 1: Creare il componente**

`components/InsightPanel.tsx`:

```tsx
import styles from './InsightPanel.module.css'

interface InsightPanelProps {
  insight: {
    summary: string
    verdict: string
    score: number
    keyPoints: string[]
    risks: string[]
    confidence: string
    generatedAt: Date
  }
}

const VERDICT_LABEL: Record<string, string> = {
  positive: 'Tono positivo',
  neutral: 'Tono neutro',
  negative: 'Tono negativo',
}
const CONFIDENCE_LABEL: Record<string, string> = { low: 'bassa', medium: 'media', high: 'alta' }

export function InsightPanel({ insight }: InsightPanelProps) {
  const tone = insight.verdict in VERDICT_LABEL ? insight.verdict : 'neutral'
  return (
    <div className={`${styles.card} ${styles[tone]}`}>
      <div className={styles.head}>
        <strong className={styles.verdict}>{VERDICT_LABEL[tone]}</strong>
        <span className={styles.meta}>
          Forza {insight.score}/5 · confidenza {CONFIDENCE_LABEL[insight.confidence] ?? insight.confidence}
        </span>
      </div>
      <p className={styles.summary}>{insight.summary}</p>
      {insight.keyPoints.length > 0 && (
        <div>
          <h3 className={styles.label}>Punti chiave</h3>
          <ul className={styles.list}>
            {insight.keyPoints.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {insight.risks.length > 0 && (
        <div>
          <h3 className={styles.label}>Rischi e incognite</h3>
          <ul className={styles.list}>
            {insight.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <p className={styles.footnote}>
        Sintesi generata da un modello IA su notizie e titoli dei video, aggiornata il{' '}
        {insight.generatedAt.toLocaleDateString('it-IT')}. Non è consulenza finanziaria.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Creare gli stili**

`components/InsightPanel.module.css`:

```css
.card {
  --tone: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 24px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-left: 4px solid var(--tone);
  border-radius: 6px;
}

.positive {
  --tone: var(--gain-bright);
}

.negative {
  --tone: var(--loss-bright);
}

.neutral {
  --tone: var(--amber-bright);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 12px;
}

.verdict {
  color: var(--tone);
  font-size: 16px;
}

.meta {
  color: var(--muted);
  font-size: 13px;
}

.summary {
  color: var(--bone);
  line-height: 1.55;
}

.label {
  margin-bottom: 6px;
  color: var(--brass);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 18px;
  color: var(--bone);
  font-size: 14px;
  line-height: 1.5;
}

.footnote {
  color: var(--muted);
  font-size: 12px;
}
```

- [ ] **Step 3: Collegare la pagina**

In `app/stock/[symbol]/page.tsx`:

1. Aggiungere l'import `import { InsightPanel } from '@/components/InsightPanel'` accanto agli altri.
2. Nell'`include` della query `prisma.stock.findUnique` aggiungere `insight: true,` dopo `recommendations: { ... },`.
3. Nel tab `notizie`, dentro il fragment `<>` e prima di `<section className={styles.news}>` delle notizie, aggiungere:

```tsx
                {stock.insight && (
                  <section className={styles.news}>
                    <h2 className={styles.sectionTitle}>
                      Riassunto e valutazione
                      <InfoTip
                        label="Come leggere il riassunto"
                        source="Google Gemini, a partire dalle ultime 10 notizie (Finnhub) e dai titoli degli ultimi video YouTube; salvato nel database e rigenerato solo quando notizie o video cambiano"
                        formula="il modello restituisce tono (positivo/neutro/negativo), forza 1-5, confidenza, punti chiave e rischi; le notizie pesano più dei video. Non entra nel verdetto di valutazione del titolo"
                      >
                        <strong>Sintesi di notizie e video</strong>
                        <span>Un riassunto unico di ciò che dicono notizie e video recenti sul titolo, con un tono complessivo.</span>
                        <span>È una stima di un modello: può sbagliare e non è una previsione di prezzo.</span>
                      </InfoTip>
                    </h2>
                    <InsightPanel insight={stock.insight} />
                  </section>
                )}

```

- [ ] **Step 4: Verificare tipi e lint**

Run: `npx tsc --noEmit && npx eslint components/InsightPanel.tsx "app/stock/[symbol]/page.tsx" lib/stock-insight.ts`
Expected: nessun errore

- [ ] **Step 5: Verifica manuale (dev server)**

Con `GEMINI_API_KEY` configurata: `npm run dev`, aprire una pagina titolo, premere "Aggiorna" (RefreshButton), poi aprire il tab "Notizie e video" e controllare il riquadro. Verificare anche che un titolo senza insight non mostri il riquadro. Fermare il server a fine verifica.

- [ ] **Step 6: Commit**

```bash
git add components/InsightPanel.tsx components/InsightPanel.module.css "app/stock/[symbol]/page.tsx"
git commit -m "feat: show stock insight panel on stock page"
```

---

### Task 6: Verifica finale

- [ ] **Step 1:** `npx vitest run` — Expected: tutta la suite PASS.
- [ ] **Step 2:** `npm run lint && npx tsc --noEmit` — Expected: nessun errore nuovo.
- [ ] **Step 3:** `npm run build` — Expected: build completata senza errori.
