# Chat sul titolo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chat flottante nella scheda titolo che risponde a domande sul titolo usando i dati dell'app e la ricerca web di Gemini, con risposte in streaming.

**Architecture:** `POST /api/stocks/[symbol]/chat` autentica, applica il rate-limit, valida la cronologia, costruisce sul server un contesto testuale del titolo e chiama l'API nativa Gemini (`streamGenerateContent` con `google_search`); rigira gli eventi al client come SSE. Il client (`StockChat`) tiene la cronologia solo in `useState`. Un parser SSE condiviso serve sia a Gemini sia al client.

**Tech Stack:** Next.js 16.4 (App Router, `cacheComponents: true`), React 19, Prisma 7, Vitest + Testing Library, nessuna dipendenza nuova.

**Spec:** `docs/superpowers/specs/2026-11-18-stock-chat-design.md`

## Differenze rispetto alla spec (scoperte leggendo il codice)

1. **Solo titoli in watchlist.** La scheda di un titolo non seguito (`StockPreview`) non ha snapshot, notizie né valutazione, e il titolo può non esistere in `Stock`. La route usa `findEntry(userId, symbol)` (come `refresh/route.ts`): 404 se il titolo non è nella watchlist dell'utente. Il bottone compare solo nella scheda dei titoli seguiti.
2. **Niente `connection()` né `export const dynamic`.** Un `POST` non è mai in cache, e con `cacheComponents: true` la route segment config `dynamic` non è ammessa. La route esporta solo `maxDuration = 60`, come `app/api/scanner/step/route.ts`.
3. **Contesto:** il settore non è salvato nel DB, quindi non entra. I dividendi usano rendimento, payout e crescita EPS 5 anni dello snapshot (niente storico dividendi). Congresso = numero di acquisti e vendite negli ultimi 180 giorni.
4. **Chiusura del pannello:** chiudere il pannello non ferma lo stream (la chat resta viva finché la pagina è aperta). Lo stream si ferma con "Interrompi", con "Nuova chat" o lasciando la pagina (cleanup del componente). Il server annulla la chiamata a Gemini quando il client si disconnette.

## Global Constraints

- Nessuna dipendenza nuova in `package.json`.
- Nessun HTML dalle risposte del modello: solo testo (`white-space: pre-wrap`). Link alle fonti solo se `http(s)`, con `target="_blank"` e `rel="noopener noreferrer"`.
- Limiti: massimo 20 messaggi, massimo 2000 caratteri per messaggio, contesto massimo 6000 caratteri.
- Timeout Gemini 45 s, nessun retry automatico.
- Chiave: `GEMINI_API_KEY`. Modello: `GEMINI_CHAT_MODEL` (mai `LLM_MODEL`), default `gemini-3.8-flash`.
- Codici d'errore verso il client: `rate_limited`, `upstream`, `timeout`, `unavailable`.
- Il client non invia mai il contesto del titolo.
- Testi per l'utente in italiano; avviso fisso "Può contenere errori e non è consulenza finanziaria."
- Ogni handler di `app/api/**/route.ts` chiama `await requireUser(` (test `tests/api/auth-coverage.test.ts`).
- Messaggi di commit in stile `feat:` / `test:`, senza menzioni di strumenti o di generazione automatica e senza trailer.
- AGENTS.md: Next 16 ha API diverse da quelle note; prima di scrivere codice di route o di pagina consultare `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.

## Review Focus

1. Gemini risponde 200 ma senza testo (risposta bloccata o vuota): l'utente non deve vedere una risposta vuota, ma un errore `upstream` (Task 3).
2. Una fonte con URI non `http(s)` (es. `javascript:`): mai renderizzata come link (Task 3 e Task 6).
3. Messaggi solo spazi, oltre 2000 caratteri, ruoli non alternati o ultimo messaggio non `user`: 400 (Task 4).
4. Lo stream si interrompe a metà risposta: il testo parziale resta, compare l'errore, e il turno fallito non finisce nella cronologia inviata dopo (Task 6).
5. Il client chiude la connessione: la route annulla la chiamata a Gemini (Task 5).

## File Structure

| File | Responsabilità |
|---|---|
| `lib/sse.ts` (nuovo) | parser SSE generico da `ReadableStream`, usato da server e client |
| `lib/chat-request.ts` (nuovo) | tipo `ChatTurn`, limiti, validazione del body della richiesta |
| `lib/stock-chat-context.ts` (nuovo) | `buildStockContext` (pura) e `SYSTEM_PROMPT` |
| `lib/stock-chat-data.ts` (nuovo) | `loadStockChatInput`: carica i dati del titolo per il contesto |
| `lib/gemini-chat.ts` (nuovo) | `isChatConfigured`, `streamChat` verso Gemini |
| `app/api/stocks/[symbol]/chat/route.ts` (nuovo) | route POST in streaming |
| `components/StockChat.tsx` + `.module.css` (nuovi) | bottone flottante e pannello |
| `app/stock/[symbol]/page.tsx` (modifica) | montaggio del componente |
| `.env.example` (modifica) | variabile `GEMINI_CHAT_MODEL` |

Test: `tests/lib/sse.test.ts`, `tests/lib/chat-request.test.ts`, `tests/lib/stock-chat-context.test.ts`, `tests/lib/stock-chat-data.test.ts`, `tests/lib/gemini-chat.test.ts`, `tests/api/stock-chat.test.ts`, `tests/components/StockChat.test.tsx`.

Eseguire i test con `npx vitest run <file>`. I test che toccano il DB (`stock-chat-data`, `stock-chat`) richiedono il database di test configurato in `.env.test`.

---

### Task 1: Parser SSE condiviso

**Files:**
- Create: `lib/sse.ts`
- Test: `tests/lib/sse.test.ts`

**Interfaces:**
- Produces: `interface SseMessage { event: string; data: string }` e `sseMessages(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage>`. `event` vale `'message'` se non indicato; più righe `data:` si uniscono con `\n`; i commenti (`:`) si ignorano. Uscendo dal ciclo `for await` il lettore viene annullato.

- [ ] **Step 1: Scrivi i test che falliscono**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { sseMessages } from '@/lib/sse'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

async function collect(body: ReadableStream<Uint8Array>) {
  const out = []
  for await (const m of sseMessages(body)) out.push(m)
  return out
}

describe('sseMessages', () => {
  it('parses event and data', async () => {
    expect(await collect(streamOf('event: text\ndata: {"a":1}\n\n'))).toEqual([{ event: 'text', data: '{"a":1}' }])
  })

  it('defaults the event name to message', async () => {
    expect(await collect(streamOf('data: hi\n\n'))).toEqual([{ event: 'message', data: 'hi' }])
  })

  it('handles a message split across chunks, even in the middle of a line', async () => {
    expect(await collect(streamOf('event: te', 'xt\ndata: {"a"', ':1}\n', '\nevent: x\ndata: 2\n\n'))).toEqual([
      { event: 'text', data: '{"a":1}' },
      { event: 'x', data: '2' },
    ])
  })

  it('handles CRLF, even when \\r and \\n arrive in different chunks', async () => {
    expect(await collect(streamOf('data: a\r', '\n\r\ndata: b\r\n\r\n'))).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ])
  })

  it('joins multi-line data and ignores comments', async () => {
    expect(await collect(streamOf(': keepalive\n\ndata: one\ndata: two\n\n'))).toEqual([{ event: 'message', data: 'one\ntwo' }])
  })

  it('emits a final message that lacks the closing blank line', async () => {
    expect(await collect(streamOf('data: tail'))).toEqual([{ event: 'message', data: 'tail' }])
  })

  it('keeps multi-byte characters split across chunks intact', async () => {
    const bytes = new TextEncoder().encode('data: è\n\n')
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 7))
        c.enqueue(bytes.slice(7))
        c.close()
      },
    })
    expect(await collect(body)).toEqual([{ event: 'message', data: 'è' }])
  })
})
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/lib/sse.test.ts`
Expected: FAIL (`Cannot find module '@/lib/sse'`).

- [ ] **Step 3: Implementa**

```ts
export interface SseMessage {
  event: string
  data: string
}

function parseBlock(block: string): SseMessage | null {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null
}

// Reads a Server-Sent Events body. Leaving the loop early cancels the underlying reader.
export async function* sseMessages(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      // Normalize on the whole buffer: a "\r" at the end of a chunk pairs with the "\n" of the next one.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      let end = buffer.indexOf('\n\n')
      while (end !== -1) {
        const message = parseBlock(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
        if (message) yield message
        end = buffer.indexOf('\n\n')
      }
    }
    buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n')
    const last = parseBlock(buffer)
    if (last) yield last
  } finally {
    await reader.cancel().catch(() => {})
  }
}
```

- [ ] **Step 4: Verifica che passino**

Run: `npx vitest run tests/lib/sse.test.ts`
Expected: PASS (7 test).

- [ ] **Step 5: Commit**

```bash
git add lib/sse.ts tests/lib/sse.test.ts
git commit -m "feat: add shared SSE stream parser"
```

---

### Task 2: Contesto del titolo e system prompt

**Files:**
- Create: `lib/stock-chat-context.ts`
- Test: `tests/lib/stock-chat-context.test.ts`

**Interfaces:**
- Consumes: `Evaluation` da `@/lib/evaluate`, `InsiderSummary` da `@/lib/insiders`.
- Produces:
  - `CONTEXT_MAX_CHARS = 6000`
  - `interface StockChatInput { symbol: string; name: string; exchange: string; snapshot: { price: number; changePct: number; marketCap: number | null; peRatio: number | null; week52High: number | null; week52Low: number | null; dividendYield: number | null; payoutRatio: number | null; epsGrowth5Y: number | null; timestamp: Date } | null; evaluation: Evaluation | null; minervini: { stage2: boolean; criteria: { label: string; ok: boolean }[] } | null; earnings: { date: Date | null; hour: string | null; epsEstimate: number | null }; news: { headline: string; source: string; publishedAt: Date }[]; insiders: InsiderSummary | null; congress: { buys: number; sells: number } | null }`
  - `buildStockContext(input: StockChatInput): string`
  - `SYSTEM_PROMPT: string`

- [ ] **Step 1: Scrivi i test che falliscono**

```ts
import { describe, it, expect } from 'vitest'
import { buildStockContext, CONTEXT_MAX_CHARS, SYSTEM_PROMPT, type StockChatInput } from '@/lib/stock-chat-context'
import type { Evaluation } from '@/lib/evaluate'

function evaluation(bigNote = 'ok'): Evaluation {
  return {
    sinceWatching: { pct: 4.2, sinceDate: new Date('2026-09-01T00:00:00Z'), note: 'ok' },
    shortTerm: { label: 'Neutrale', note: bigNote },
    mediumTerm: { label: 'Positivo', note: 'ok', strongBuy: 10, buy: 12, hold: 8, sell: 1, strongSell: 0 },
    longTerm: { label: 'Solido', note: bigNote },
    fairValue: { position: 'inside', reliable: true, low: 150, high: 210, median: 180, note: 'ok' },
    newsImpact: { counted: 2, positive: 1, negative: 0, net: 1, adjustment: 0, note: 'ok' },
    details: { pegRatio: 1.8, roe: 150, debtToEquity: 1.5, netMargin: 25, dividendYield: 0.5, payoutRatio: 15 },
  }
}

const full: StockChatInput = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  exchange: 'NASDAQ',
  snapshot: { price: 189.5, changePct: -1.25, marketCap: 2_900_000, peRatio: 29.1, week52High: 199.6, week52Low: 124.2, dividendYield: 0.5, payoutRatio: 15, epsGrowth5Y: 12.3, timestamp: new Date('2026-11-17T21:05:00Z') },
  evaluation: evaluation(),
  minervini: { stage2: true, criteria: [{ label: 'Prezzo sopra la SMA 200', ok: true }, { label: 'RS sopra 70', ok: false }] },
  earnings: { date: new Date('2026-12-02T00:00:00Z'), hour: 'amc', epsEstimate: 1.62 },
  news: Array.from({ length: 7 }, (_, i) => ({ headline: `Notizia ${i + 1}`, source: 'Reuters', publishedAt: new Date(`2026-11-1${i}T10:00:00Z`) })),
  insiders: { buys: 1, sells: 4, netShares: -9000, buyValue: 10_000, sellValue: 900_000, mood: 'selling' },
  congress: { buys: 2, sells: 0 },
}

const empty: StockChatInput = { ...full, snapshot: null, evaluation: null, minervini: null, earnings: { date: null, hour: null, epsEstimate: null }, news: [], insiders: null, congress: null }

describe('buildStockContext', () => {
  it('describes identity and price with the date of the data', () => {
    const text = buildStockContext(full)
    expect(text).toContain('Apple Inc. (NASDAQ: AAPL)')
    expect(text).toContain('189.50')
    expect(text).toContain('2026-11-17')
    expect(text).toContain('124.20')
  })

  it('includes evaluation, Minervini, earnings, insiders and congress', () => {
    const text = buildStockContext(full)
    expect(text).toContain('VALUTAZIONE DELL’APP')
    expect(text).toContain('Neutrale')
    expect(text).toContain('Prezzo sopra la SMA 200')
    expect(text).toContain('2026-12-02')
    expect(text).toContain('INSIDER')
    expect(text).toContain('CONGRESSO')
  })

  it('omits blocks with no data instead of writing placeholders', () => {
    const text = buildStockContext(empty)
    expect(text).toContain('Apple Inc. (NASDAQ: AAPL)')
    for (const word of ['PREZZO', 'VALUTAZIONE', 'MINERVINI', 'DIVIDENDI', 'TRIMESTRALE', 'NOTIZIE', 'INSIDER', 'CONGRESSO']) {
      expect(text).not.toContain(word)
    }
    expect(text).not.toMatch(/n\/d|null|undefined|NaN/i)
  })

  it('keeps only the five most recent news', () => {
    const text = buildStockContext(full)
    expect(text).toContain('Notizia 1')
    expect(text).toContain('Notizia 5')
    expect(text).not.toContain('Notizia 6')
  })

  it('drops news first when the context is too long', () => {
    const long = { ...full, evaluation: evaluation('x'.repeat(2200)), news: full.news.map((n) => ({ ...n, headline: 'h'.repeat(400) })) }
    const text = buildStockContext(long)
    expect(text.length).toBeLessThanOrEqual(CONTEXT_MAX_CHARS)
    expect(text).not.toContain('NOTIZIE')
    expect(text).toContain('INSIDER')
  })

  it('never exceeds the cap, even when no droppable block is left', () => {
    const text = buildStockContext({ ...full, evaluation: evaluation('x'.repeat(4000)) })
    expect(text.length).toBeLessThanOrEqual(CONTEXT_MAX_CHARS)
  })
})

describe('SYSTEM_PROMPT', () => {
  it('states the rules the spec requires', () => {
    expect(SYSTEM_PROMPT).toMatch(/italiano/i)
    expect(SYSTEM_PROMPT).toMatch(/consigli personalizzati/i)
    expect(SYSTEM_PROMPT).toMatch(/previsioni di prezzo/i)
    expect(SYSTEM_PROMPT).toMatch(/web/i)
  })
})
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/lib/stock-chat-context.test.ts`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementa**

```ts
import type { Evaluation } from '@/lib/evaluate'
import type { InsiderSummary } from '@/lib/insiders'

export const CONTEXT_MAX_CHARS = 6000
const MAX_NEWS = 5

export interface StockChatInput {
  symbol: string
  name: string
  exchange: string
  snapshot: {
    price: number
    changePct: number
    // In millions of dollars, like PriceSnapshot.marketCap.
    marketCap: number | null
    peRatio: number | null
    week52High: number | null
    week52Low: number | null
    dividendYield: number | null
    payoutRatio: number | null
    epsGrowth5Y: number | null
    timestamp: Date
  } | null
  evaluation: Evaluation | null
  minervini: { stage2: boolean; criteria: { label: string; ok: boolean }[] } | null
  earnings: { date: Date | null; hour: string | null; epsEstimate: number | null }
  news: { headline: string; source: string; publishedAt: Date }[]
  insiders: InsiderSummary | null
  congress: { buys: number; sells: number } | null
}

export const SYSTEM_PROMPT = `Sei l'assistente di un'app di analisi azionaria e rispondi a domande su UN solo titolo, indicato nel contesto qui sotto.
- Rispondi sempre in italiano, in modo breve e chiaro.
- Per i dati del titolo (prezzo, fondamentali, valutazione dell'app) usa il contesto fornito. Per notizie ed eventi recenti puoi cercare sul web e citare le fonti.
- Se il contesto e il web discordano, dillo esplicitamente.
- Non dare consigli personalizzati ("compra", "vendi") e non fare previsioni di prezzo: offri analisi, pro e contro, e ricorda che non è consulenza finanziaria.
- Se la domanda non riguarda questo titolo o la finanza, rifiuta con gentilezza.
- Non inventare dati: se non li trovi, dì che non li hai.`

const day = (d: Date) => d.toISOString().slice(0, 10)
const num = (v: number) => v.toFixed(2)

function formatMarketCap(millions: number): string {
  if (millions >= 1_000_000) return `$${(millions / 1_000_000).toFixed(2)}T`
  if (millions >= 1_000) return `$${(millions / 1_000).toFixed(1)}B`
  return `$${millions.toFixed(0)}M`
}

type Key = 'identity' | 'price' | 'evaluation' | 'minervini' | 'dividends' | 'earnings' | 'news' | 'insiders' | 'congress'
interface Block {
  key: Key
  text: string
}

// Dropped in this order when the context is over the cap.
const DROP_ORDER: Key[] = ['news', 'congress', 'insiders']

function priceBlock(s: NonNullable<StockChatInput['snapshot']>): string {
  const lines = [`PREZZO (dati al ${day(s.timestamp)})`, `- Ultimo prezzo: $${num(s.price)} (${s.changePct >= 0 ? '+' : ''}${num(s.changePct)}% sul giorno)`]
  if (s.week52Low !== null && s.week52High !== null) lines.push(`- Intervallo a 52 settimane: $${num(s.week52Low)} - $${num(s.week52High)}`)
  if (s.marketCap !== null) lines.push(`- Capitalizzazione: ${formatMarketCap(s.marketCap)}`)
  if (s.peRatio !== null) lines.push(`- P/E: ${num(s.peRatio)}`)
  return lines.join('\n')
}

function evaluationBlock(e: Evaluation): string {
  const m = e.mediumTerm
  const lines = [
    'VALUTAZIONE DELL’APP',
    `- Breve termine: ${e.shortTerm.label}. ${e.shortTerm.note}`,
    `- Medio termine: ${m.label}. ${m.note} (analisti: ${m.strongBuy} strong buy, ${m.buy} buy, ${m.hold} hold, ${m.sell} sell, ${m.strongSell} strong sell)`,
    `- Lungo termine: ${e.longTerm.label}. ${e.longTerm.note}`,
    `- Valore equo: ${e.fairValue.note}`,
    `- Impatto delle notizie: ${e.newsImpact.note}`,
  ]
  if (e.sinceWatching.pct !== null) lines.push(`- Da quando è seguito: ${e.sinceWatching.pct >= 0 ? '+' : ''}${num(e.sinceWatching.pct)}%`)
  return lines.join('\n')
}

function minerviniBlock(m: NonNullable<StockChatInput['minervini']>): string {
  const passed = m.criteria.filter((c) => c.ok).map((c) => c.label)
  const failed = m.criteria.filter((c) => !c.ok).map((c) => c.label)
  const lines = ['TREND TEMPLATE DI MINERVINI', `- Stage 2: ${m.stage2 ? 'sì' : 'no'}`]
  if (passed.length > 0) lines.push(`- Criteri passati: ${passed.join('; ')}`)
  if (failed.length > 0) lines.push(`- Criteri non passati: ${failed.join('; ')}`)
  return lines.join('\n')
}

function dividendsBlock(s: NonNullable<StockChatInput['snapshot']>): string | null {
  const lines: string[] = []
  if (s.dividendYield !== null) lines.push(`- Rendimento da dividendo: ${num(s.dividendYield)}%`)
  if (s.payoutRatio !== null) lines.push(`- Payout ratio: ${num(s.payoutRatio)}%`)
  if (s.epsGrowth5Y !== null) lines.push(`- Crescita EPS a 5 anni: ${num(s.epsGrowth5Y)}%`)
  return lines.length > 0 ? ['DIVIDENDI E CRESCITA', ...lines].join('\n') : null
}

function earningsBlock(e: StockChatInput['earnings']): string | null {
  if (!e.date) return null
  const lines = ['PROSSIMA TRIMESTRALE', `- Data: ${day(e.date)}${e.hour ? ` (${e.hour})` : ''}`]
  if (e.epsEstimate !== null) lines.push(`- EPS stimato: ${num(e.epsEstimate)}`)
  return lines.join('\n')
}

function newsBlock(news: StockChatInput['news']): string | null {
  if (news.length === 0) return null
  return ['NOTIZIE RECENTI', ...news.slice(0, MAX_NEWS).map((n) => `- ${day(n.publishedAt)} ${n.source}: ${n.headline}`)].join('\n')
}

function insidersBlock(i: InsiderSummary): string {
  return ['INSIDER (ultimi 180 giorni)', `- ${i.buys} acquisti per $${Math.round(i.buyValue)}, ${i.sells} vendite per $${Math.round(i.sellValue)}; saldo ${i.mood === 'buying' ? 'in acquisto' : i.mood === 'selling' ? 'in vendita' : 'neutro'}`].join('\n')
}

export function buildStockContext(input: StockChatInput): string {
  const optional: (Block | null)[] = [
    input.snapshot ? { key: 'price', text: priceBlock(input.snapshot) } : null,
    input.evaluation ? { key: 'evaluation', text: evaluationBlock(input.evaluation) } : null,
    input.minervini ? { key: 'minervini', text: minerviniBlock(input.minervini) } : null,
    input.snapshot ? toBlock('dividends', dividendsBlock(input.snapshot)) : null,
    toBlock('earnings', earningsBlock(input.earnings)),
    toBlock('news', newsBlock(input.news)),
    input.insiders && input.insiders.buys + input.insiders.sells > 0 ? { key: 'insiders', text: insidersBlock(input.insiders) } : null,
    input.congress && input.congress.buys + input.congress.sells > 0
      ? { key: 'congress', text: `CONGRESSO (ultimi 180 giorni)\n- ${input.congress.buys} acquisti e ${input.congress.sells} vendite di membri del Congresso USA` }
      : null,
  ]
  const blocks: Block[] = [{ key: 'identity', text: `TITOLO\n${input.name} (${input.exchange}: ${input.symbol})` }, ...optional.filter((b): b is Block => b !== null)]

  const render = () => blocks.map((b) => b.text).join('\n\n')
  for (const key of DROP_ORDER) {
    if (render().length <= CONTEXT_MAX_CHARS) break
    const at = blocks.findIndex((b) => b.key === key)
    if (at !== -1) blocks.splice(at, 1)
  }
  return render().slice(0, CONTEXT_MAX_CHARS)
}

function toBlock(key: Key, text: string | null): Block | null {
  return text === null ? null : { key, text }
}
```

- [ ] **Step 4: Verifica che passino**

Run: `npx vitest run tests/lib/stock-chat-context.test.ts`
Expected: PASS (8 test).

- [ ] **Step 5: Commit**

```bash
git add lib/stock-chat-context.ts tests/lib/stock-chat-context.test.ts
git commit -m "feat: build the stock context and system prompt for the chat"
```

---

### Task 3: Client Gemini in streaming

**Files:**
- Create: `lib/gemini-chat.ts`
- Create: `lib/chat-request.ts` (solo il tipo `ChatTurn` e le costanti in questo task; la validazione arriva nel Task 4)
- Test: `tests/lib/gemini-chat.test.ts`

**Interfaces:**
- Consumes: `sseMessages` da `@/lib/sse` (Task 1).
- Produces:
  - da `lib/chat-request.ts`: `type ChatTurn = { role: 'user' | 'model'; text: string }`, `MAX_MESSAGES = 20`, `MAX_CHARS = 2000`
  - da `lib/gemini-chat.ts`: `type ChatErrorCode = 'rate_limited' | 'upstream' | 'timeout' | 'unavailable'`; `type ChatEvent = { type: 'text'; delta: string } | { type: 'sources'; items: { title: string; url: string }[] } | { type: 'error'; code: ChatErrorCode }`; `isChatConfigured(): boolean`; `streamChat(args: { system: string; history: ChatTurn[]; signal?: AbortSignal }): AsyncGenerator<ChatEvent>`

- [ ] **Step 1: Crea il tipo e le costanti**

`lib/chat-request.ts`:

```ts
export type ChatTurn = { role: 'user' | 'model'; text: string }

export const MAX_MESSAGES = 20
export const MAX_CHARS = 2000
```

- [ ] **Step 2: Scrivi i test che falliscono**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isChatConfigured, streamChat, type ChatEvent } from '@/lib/gemini-chat'

function sseResponse(payloads: unknown[], init: ResponseInit = { status: 200 }): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of payloads) c.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`))
      c.close()
    },
  })
  return new Response(body, init)
}

const textChunk = (text: string, extra: object = {}) => ({ candidates: [{ content: { parts: [{ text }] }, ...extra }] })

async function collect(gen: AsyncGenerator<ChatEvent>) {
  const out: ChatEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const args = { system: 'sys', history: [{ role: 'user' as const, text: 'ciao' }] }

describe('gemini-chat', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    vi.stubEnv('GEMINI_CHAT_MODEL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('is configured only with GEMINI_API_KEY', () => {
    expect(isChatConfigured()).toBe(true)
    vi.stubEnv('GEMINI_API_KEY', '')
    expect(isChatConfigured()).toBe(false)
  })

  it('reports unavailable without a key, without calling the network', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await collect(streamChat(args))).toEqual([{ type: 'error', code: 'unavailable' }])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends system instruction, turns and the google_search tool to the native API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([textChunk('ok')]))
    vi.stubGlobal('fetch', fetchMock)
    await collect(streamChat({ system: 'sys', history: [{ role: 'user', text: 'a' }, { role: 'model', text: 'b' }, { role: 'user', text: 'c' }] }))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
    expect(init.headers['x-goog-api-key']).toBe('k')
    expect(JSON.parse(init.body)).toEqual({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [
        { role: 'user', parts: [{ text: 'a' }] },
        { role: 'model', parts: [{ text: 'b' }] },
        { role: 'user', parts: [{ text: 'c' }] },
      ],
      tools: [{ google_search: {} }],
    })
  })

  it('uses GEMINI_CHAT_MODEL when set', async () => {
    vi.stubEnv('GEMINI_CHAT_MODEL', 'gemini-x')
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([textChunk('ok')]))
    vi.stubGlobal('fetch', fetchMock)
    await collect(streamChat(args))
    expect(fetchMock.mock.calls[0][0]).toContain('/models/gemini-x:streamGenerateContent')
  })

  it('emits text deltas, skips thought parts, then deduplicated sources', async () => {
    const web = (uri: string, title: string) => ({ web: { uri, title } })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          { candidates: [{ content: { parts: [{ text: 'pensiero', thought: true }, { text: 'Ciao ' }] } }] },
          textChunk('mondo', { groundingMetadata: { groundingChunks: [web('https://a.example/x', 'A'), web('https://a.example/x', 'A again')] } }),
          { candidates: [{ groundingMetadata: { groundingChunks: [web('https://b.example/y', 'B')] } }] },
        ]),
      ),
    )
    expect(await collect(streamChat(args))).toEqual([
      { type: 'text', delta: 'Ciao ' },
      { type: 'text', delta: 'mondo' },
      { type: 'sources', items: [{ title: 'A', url: 'https://a.example/x' }, { title: 'B', url: 'https://b.example/y' }] },
    ])
  })

  it('drops sources whose URL is not http(s)', async () => {
    const chunk = textChunk('x', { groundingMetadata: { groundingChunks: [{ web: { uri: 'javascript:alert(1)', title: 'bad' } }, { web: { uri: 'https://ok.example', title: 'ok' } }] } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([chunk])))
    const events = await collect(streamChat(args))
    expect(events[events.length - 1]).toEqual({ type: 'sources', items: [{ title: 'ok', url: 'https://ok.example' }] })
  })

  it('reports upstream when the stream ends without any text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([{ candidates: [{ finishReason: 'SAFETY' }] }])))
    expect(await collect(streamChat(args))).toEqual([{ type: 'error', code: 'upstream' }])
  })

  it('maps HTTP 429 to rate_limited and other failures to upstream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))
    expect(await collect(streamChat(args))).toEqual([{ type: 'error', code: 'rate_limited' }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    expect(await collect(streamChat(args))).toEqual([{ type: 'error', code: 'upstream' }])
  })

  it('reports an error after partial text when the network drops mid-stream', async () => {
    const enc = new TextEncoder()
    // error() would discard queued chunks, so fail on the read that follows the first chunk.
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent) return c.error(new Error('socket hang up'))
        sent = true
        c.enqueue(enc.encode(`data: ${JSON.stringify(textChunk('par'))}\n\n`))
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    expect(await collect(streamChat(args))).toEqual([{ type: 'text', delta: 'par' }, { type: 'error', code: 'upstream' }])
  })

  it('stays silent when the caller aborts', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      controller.abort()
      throw init.signal?.reason ?? new DOMException('aborted', 'AbortError')
    }))
    expect(await collect(streamChat({ ...args, signal: controller.signal }))).toEqual([])
  })

  it('reports timeout when the deadline fires', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')))
    expect(await collect(streamChat(args))).toEqual([{ type: 'error', code: 'timeout' }])
  })
})
```

- [ ] **Step 3: Verifica che falliscano**

Run: `npx vitest run tests/lib/gemini-chat.test.ts`
Expected: FAIL (modulo mancante).

- [ ] **Step 4: Implementa**

```ts
import { sseMessages } from '@/lib/sse'
import type { ChatTurn } from '@/lib/chat-request'

// The google_search tool is only documented on the native API, not on the OpenAI-compatible endpoint llm-news.ts uses.
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-3.8-flash'
const TIMEOUT_MS = 45_000

export type ChatErrorCode = 'rate_limited' | 'upstream' | 'timeout' | 'unavailable'

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'sources'; items: { title: string; url: string }[] }
  | { type: 'error'; code: ChatErrorCode }

interface GeminiChunk {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] }
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] }
  }[]
}

export function isChatConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY)
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError'
}

export async function* streamChat({ system, history, signal }: { system: string; history: ChatTurn[]; signal?: AbortSignal }): AsyncGenerator<ChatEvent> {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    yield { type: 'error', code: 'unavailable' }
    return
  }
  const model = process.env.GEMINI_CHAT_MODEL || DEFAULT_MODEL
  const deadline = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        tools: [{ google_search: {} }],
      }),
      signal: combined,
    })
  } catch (err) {
    if (signal?.aborted) return
    yield { type: 'error', code: isTimeout(err) ? 'timeout' : 'upstream' }
    return
  }
  if (!res.ok || !res.body) {
    yield { type: 'error', code: res.status === 429 ? 'rate_limited' : 'upstream' }
    return
  }

  let sawText = false
  const sources = new Map<string, string>()
  try {
    for await (const message of sseMessages(res.body)) {
      let chunk: GeminiChunk
      try {
        chunk = JSON.parse(message.data) as GeminiChunk
      } catch {
        continue
      }
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.thought || !part.text) continue
          sawText = true
          yield { type: 'text', delta: part.text }
        }
        for (const g of candidate.groundingMetadata?.groundingChunks ?? []) {
          const uri = g.web?.uri
          // Only http(s) links: the URL ends up in an href.
          if (uri && /^https?:\/\//i.test(uri) && !sources.has(uri)) sources.set(uri, g.web?.title || uri)
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return
    yield { type: 'error', code: isTimeout(err) ? 'timeout' : 'upstream' }
    return
  }
  if (!sawText) {
    yield { type: 'error', code: 'upstream' }
    return
  }
  if (sources.size > 0) yield { type: 'sources', items: [...sources].map(([url, title]) => ({ title, url })) }
}
```

- [ ] **Step 5: Verifica che passino**

Run: `npx vitest run tests/lib/gemini-chat.test.ts`
Expected: PASS (11 test).

- [ ] **Step 6: Commit**

```bash
git add lib/gemini-chat.ts lib/chat-request.ts tests/lib/gemini-chat.test.ts
git commit -m "feat: add the Gemini streaming client with web grounding"
```

---

### Task 4: Validazione della richiesta e caricamento dei dati

**Files:**
- Modify: `lib/chat-request.ts`
- Create: `lib/stock-chat-data.ts`
- Test: `tests/lib/chat-request.test.ts`, `tests/lib/stock-chat-data.test.ts`

**Interfaces:**
- Consumes: `ChatTurn`, `MAX_MESSAGES`, `MAX_CHARS` (Task 3); `StockChatInput` (Task 2); `findEntry` da `@/lib/watchlist`.
- Produces:
  - `parseChatRequest(json: unknown): { ok: true; history: ChatTurn[] } | { ok: false; error: string }`
  - `type WatchedEntry = NonNullable<Awaited<ReturnType<typeof findEntry>>>` e `loadStockChatInput(entry: WatchedEntry, now?: Date): Promise<StockChatInput>`

- [ ] **Step 1: Test di `parseChatRequest` (falliscono)**

```ts
import { describe, it, expect } from 'vitest'
import { parseChatRequest, MAX_CHARS, MAX_MESSAGES } from '@/lib/chat-request'

const u = (text: string) => ({ role: 'user', text })
const m = (text: string) => ({ role: 'model', text })

describe('parseChatRequest', () => {
  it('accepts a single user message and trims it', () => {
    expect(parseChatRequest({ messages: [u('  ciao  ')] })).toEqual({ ok: true, history: [{ role: 'user', text: 'ciao' }] })
  })

  it('accepts alternating turns ending with a user message', () => {
    const r = parseChatRequest({ messages: [u('a'), m('b'), u('c')] })
    expect(r.ok).toBe(true)
  })

  it.each([
    ['non-object body', null],
    ['missing messages', {}],
    ['messages not an array', { messages: 'x' }],
    ['empty list', { messages: [] }],
    ['whitespace-only text', { messages: [u('   ')] }],
    ['non-string text', { messages: [{ role: 'user', text: 5 }] }],
    ['unknown role', { messages: [{ role: 'system', text: 'x' }] }],
    ['starts with model', { messages: [m('x'), u('y')] }],
    ['ends with model', { messages: [u('x'), m('y')] }],
    ['two user messages in a row', { messages: [u('x'), u('y')] }],
    ['text over the limit', { messages: [u('x'.repeat(MAX_CHARS + 1))] }],
    ['too many messages', { messages: Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => (i % 2 === 0 ? u('x') : m('y'))) }],
  ])('rejects %s', (_name, body) => {
    expect(parseChatRequest(body).ok).toBe(false)
  })

  it('accepts exactly the limits', () => {
    // 19 alternating messages: user first and last, the longest conversation that can still end with the user.
    const messages = Array.from({ length: MAX_MESSAGES - 1 }, (_, i) => (i % 2 === 0 ? u('x') : m('y')))
    messages[messages.length - 1] = u('x'.repeat(MAX_CHARS))
    expect(parseChatRequest({ messages }).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/lib/chat-request.test.ts`
Expected: FAIL (`parseChatRequest` non esportata).

- [ ] **Step 3: Implementa `parseChatRequest`**

Aggiungi in fondo a `lib/chat-request.ts`:

```ts
export type ParsedChat = { ok: true; history: ChatTurn[] } | { ok: false; error: string }

// Turns must start with the user, alternate, and end with the user: the Gemini API expects that shape.
export function parseChatRequest(json: unknown): ParsedChat {
  const messages = (json as { messages?: unknown } | null)?.messages
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, error: 'messages required' }
  if (messages.length > MAX_MESSAGES) return { ok: false, error: `at most ${MAX_MESSAGES} messages` }
  const history: ChatTurn[] = []
  for (const [i, raw] of messages.entries()) {
    const role = (raw as { role?: unknown } | null)?.role
    const text = (raw as { text?: unknown } | null)?.text
    if (role !== 'user' && role !== 'model') return { ok: false, error: 'invalid role' }
    if (role !== (i % 2 === 0 ? 'user' : 'model')) return { ok: false, error: 'turns must alternate, starting with the user' }
    if (typeof text !== 'string') return { ok: false, error: 'invalid text' }
    const trimmed = text.trim()
    if (trimmed.length === 0) return { ok: false, error: 'empty message' }
    if (trimmed.length > MAX_CHARS) return { ok: false, error: `message over ${MAX_CHARS} characters` }
    history.push({ role, text: trimmed })
  }
  if (history[history.length - 1].role !== 'user') return { ok: false, error: 'last message must be from the user' }
  return { ok: true, history }
}
```

- [ ] **Step 4: Verifica che passino**

Run: `npx vitest run tests/lib/chat-request.test.ts`
Expected: PASS.

- [ ] **Step 5: Test di `loadStockChatInput` (falliscono)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, watch } from '../helpers/db'
import { findEntry } from '@/lib/watchlist'

vi.mock('@/lib/finnhub', () => ({ getMetrics: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/insider-data', () => ({ getInsiderData: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/congress', () => ({ getCongressTrades: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/minervini-data', () => ({ getMinerviniAnalysis: vi.fn().mockResolvedValue(null) }))

import * as insiderData from '@/lib/insider-data'
import * as congress from '@/lib/congress'
import * as minervini from '@/lib/minervini-data'
import { loadStockChatInput } from '@/lib/stock-chat-data'

const NOW = new Date('2026-11-18T12:00:00Z')

async function entry() {
  const found = await findEntry('dev', 'AAPL')
  if (!found) throw new Error('missing entry')
  return found
}

describe('loadStockChatInput', () => {
  beforeEach(async () => {
    await resetDb()
    vi.clearAllMocks()
  })

  it('returns identity and nulls for a stock with no data yet', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const input = await loadStockChatInput(await entry(), NOW)
    expect(input).toMatchObject({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', snapshot: null, evaluation: null, minervini: null, insiders: null, congress: null, news: [] })
  })

  it('maps the latest snapshot, news and earnings, and evaluates the stock', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', addedAt: new Date('2026-09-01T00:00:00Z') } })
    const stock = await prisma.stock.findUniqueOrThrow({ where: { symbol: 'AAPL' } })
    await prisma.stock.update({ where: { id: stock.id }, data: { nextEarningsDate: new Date('2026-12-02T00:00:00Z'), nextEarningsHour: 'amc', nextEarningsEpsEstimate: 1.62 } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 100, changePct: 1, timestamp: new Date('2026-09-02T00:00:00Z') } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 110, changePct: -2, peRatio: 25, timestamp: new Date('2026-11-17T00:00:00Z') } })
    await prisma.newsItem.create({ data: { stockId: stock.id, headline: 'Nuovo iPhone', url: 'https://x.example/1', source: 'Reuters', publishedAt: new Date('2026-11-16T00:00:00Z') } })

    const input = await loadStockChatInput(await entry(), NOW)
    expect(input.snapshot).toMatchObject({ price: 110, changePct: -2, peRatio: 25 })
    expect(input.news).toEqual([{ headline: 'Nuovo iPhone', source: 'Reuters', publishedAt: new Date('2026-11-16T00:00:00Z') }])
    expect(input.earnings).toEqual({ date: new Date('2026-12-02T00:00:00Z'), hour: 'amc', epsEstimate: 1.62 })
    expect(input.evaluation?.sinceWatching.pct).toBeCloseTo(10)
  })

  it('summarizes insiders and congress trades of the last 180 days only', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    vi.mocked(insiderData.getInsiderData).mockResolvedValue({
      sentiment: [],
      trades: [
        { name: 'A', side: 'sell', shares: 100, price: 10, value: 1000, date: '2026-10-01', filingDate: '2026-10-03' },
        { name: 'B', side: 'buy', shares: 50, price: 10, value: 500, date: '2025-01-01', filingDate: '2025-01-03' },
      ],
    })
    vi.mocked(congress.getCongressTrades).mockResolvedValue([
      { member: 'X', chamber: 'house', state: 'CA', side: 'buy', amountLow: 1, amountHigh: 2, date: '2026-10-10', disclosedAt: '2026-10-20' },
      { member: 'Y', chamber: 'senate', state: 'NY', side: 'sell', amountLow: 1, amountHigh: 2, date: '2024-01-10', disclosedAt: '2024-01-20' },
    ])
    const input = await loadStockChatInput(await entry(), NOW)
    expect(input.insiders).toMatchObject({ buys: 0, sells: 1, sellValue: 1000 })
    expect(input.congress).toEqual({ buys: 1, sells: 0 })
  })

  it('maps the Minervini analysis and survives a failing data source', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    vi.mocked(minervini.getMinerviniAnalysis).mockResolvedValue({
      template: { criteria: [{ id: 1, label: 'Prezzo sopra la SMA 200', ok: true, value: '', margin: null }], passedCount: 1, total: 1, passed: true, stage2: true, levels: [] },
      vcp: {} as never,
      peerCount: 10,
    })
    vi.mocked(insiderData.getInsiderData).mockRejectedValue(new Error('finnhub down'))
    const input = await loadStockChatInput(await entry(), NOW)
    expect(input.minervini).toEqual({ stage2: true, criteria: [{ label: 'Prezzo sopra la SMA 200', ok: true }] })
    expect(input.insiders).toBeNull()
  })
})
```

- [ ] **Step 6: Verifica che falliscano**

Run: `npx vitest run tests/lib/stock-chat-data.test.ts`
Expected: FAIL (modulo mancante).

- [ ] **Step 7: Implementa `loadStockChatInput`**

```ts
import { prisma } from '@/lib/db'
import { evaluateStock } from '@/lib/evaluate'
import { buildFairValueInput, fairValue } from '@/lib/fair-value'
import { getMetrics } from '@/lib/finnhub'
import { getCongressTrades } from '@/lib/congress'
import { getInsiderData } from '@/lib/insider-data'
import { daysAgoISO, summarizeTrades } from '@/lib/insiders'
import { getMinerviniAnalysis } from '@/lib/minervini-data'
import type { StockChatInput } from '@/lib/stock-chat-context'
import type { findEntry } from '@/lib/watchlist'

export type WatchedEntry = NonNullable<Awaited<ReturnType<typeof findEntry>>>

const RECENT_DAYS = 180

// Loads what the page shows for a watched stock, with the same functions. A failing source degrades to null instead of failing the chat.
export async function loadStockChatInput(entry: WatchedEntry, now = new Date()): Promise<StockChatInput> {
  const stock = entry.stock
  const [latest, firstSinceAdded, news, recommendations] = await Promise.all([
    prisma.priceSnapshot.findFirst({ where: { stockId: stock.id }, orderBy: { timestamp: 'desc' } }),
    prisma.priceSnapshot.findFirst({ where: { stockId: stock.id, timestamp: { gte: entry.addedAt } }, orderBy: { timestamp: 'asc' } }),
    prisma.newsItem.findMany({ where: { stockId: stock.id }, orderBy: { publishedAt: 'desc' }, take: 20, include: { analysis: true } }),
    prisma.analystRecommendation.findMany({ where: { stockId: stock.id }, orderBy: { period: 'desc' }, take: 6 }),
  ])
  const [metrics, insiderData, congressTrades, minervini] = await Promise.all([
    getMetrics(stock.symbol).catch(() => null),
    getInsiderData(stock.symbol).catch(() => null),
    getCongressTrades(stock.symbol).catch(() => null),
    getMinerviniAnalysis(stock.symbol).catch(() => null),
  ])

  const earliestSnapshot = firstSinceAdded && firstSinceAdded.id !== latest?.id ? firstSinceAdded : null
  const evaluation = latest
    ? evaluateStock({
        fairValue: metrics ? fairValue(buildFairValueInput(latest.price, metrics)) : null,
        latestSnapshot: {
          price: latest.price,
          week52High: latest.week52High,
          week52Low: latest.week52Low,
          relativePerf13W: latest.relativePerf13W,
          pegRatio: latest.pegRatio,
          roe: latest.roe,
          debtToEquity: latest.debtToEquity,
          netMargin: latest.netMargin,
          dividendYield: latest.dividendYield,
          payoutRatio: latest.payoutRatio,
          epsTTM: latest.epsTTM,
          epsGrowth5Y: latest.epsGrowth5Y,
        },
        earliestSnapshot: earliestSnapshot ? { price: earliestSnapshot.price, timestamp: earliestSnapshot.timestamp } : null,
        newsAnalyses: news.flatMap((n) => (n.analysis ? [{ ...n.analysis, publishedAt: n.publishedAt }] : [])),
        recentRecommendations: recommendations.slice(0, 2).map((r) => ({
          period: r.period,
          strongBuy: r.strongBuy,
          buy: r.buy,
          hold: r.hold,
          sell: r.sell,
          strongSell: r.strongSell,
        })),
      })
    : null

  const since = daysAgoISO(RECENT_DAYS, now)
  const recentInsiders = insiderData ? insiderData.trades.filter((t) => t.date >= since) : null
  const recentCongress = congressTrades ? congressTrades.filter((t) => t.date >= since) : null

  return {
    symbol: stock.symbol,
    name: stock.name,
    exchange: stock.exchange,
    snapshot: latest
      ? {
          price: latest.price,
          changePct: latest.changePct,
          marketCap: latest.marketCap,
          peRatio: latest.peRatio,
          week52High: latest.week52High,
          week52Low: latest.week52Low,
          dividendYield: latest.dividendYield,
          payoutRatio: latest.payoutRatio,
          epsGrowth5Y: latest.epsGrowth5Y,
          timestamp: latest.timestamp,
        }
      : null,
    evaluation,
    minervini: minervini ? { stage2: minervini.template.stage2, criteria: minervini.template.criteria.map((c) => ({ label: c.label, ok: c.ok })) } : null,
    earnings: { date: stock.nextEarningsDate, hour: stock.nextEarningsHour, epsEstimate: stock.nextEarningsEpsEstimate },
    news: news.map((n) => ({ headline: n.headline, source: n.source, publishedAt: n.publishedAt })),
    insiders: recentInsiders ? summarizeTrades(recentInsiders) : null,
    congress: recentCongress ? { buys: recentCongress.filter((t) => t.side === 'buy').length, sells: recentCongress.filter((t) => t.side === 'sell').length } : null,
  }
}
```

- [ ] **Step 8: Verifica che passino**

Run: `npx vitest run tests/lib/stock-chat-data.test.ts tests/lib/chat-request.test.ts`
Expected: PASS. Se `evaluateStock` o `daysAgoISO` hanno una firma diversa da quella usata qui, adegua la chiamata copiando quella di `app/stock/[symbol]/page.tsx` (la fonte di verità), non i test.

- [ ] **Step 9: Commit**

```bash
git add lib/chat-request.ts lib/stock-chat-data.ts tests/lib/chat-request.test.ts tests/lib/stock-chat-data.test.ts
git commit -m "feat: validate chat requests and load the stock data for the context"
```

---

### Task 5: Route `POST /api/stocks/[symbol]/chat`

**Files:**
- Create: `app/api/stocks/[symbol]/chat/route.ts`
- Test: `tests/api/stock-chat.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `rateLimit('heavy')`, `currentUserId`, `findEntry`, `parseChatRequest`, `loadStockChatInput`, `buildStockContext`, `SYSTEM_PROMPT`, `isChatConfigured`, `streamChat`.
- Produces: risposta `text/event-stream`; eventi `event: text|sources|error` con `data` = l'evento JSON (`{ type, ... }`). Errori HTTP: 401 (da `requireUser`), 429 (da `rateLimit`), 503 senza chiave, 400 body non valido, 404 titolo non in watchlist.

Prima di scrivere: leggi `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (sezione streaming) per confermare che un `Response` con `ReadableStream` è supportato nei Route Handler (AGENTS.md).

- [ ] **Step 1: Scrivi i test che falliscono**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetDb, watch } from '../helpers/db'

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => null as Response | null),
  isChatConfigured: vi.fn(() => true),
  streamChat: vi.fn(),
  loadStockChatInput: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }))
vi.mock('@/lib/gemini-chat', () => ({ isChatConfigured: mocks.isChatConfigured, streamChat: mocks.streamChat }))
vi.mock('@/lib/stock-chat-data', () => ({ loadStockChatInput: mocks.loadStockChatInput }))

import { POST } from '@/app/api/stocks/[symbol]/chat/route'

const input = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', snapshot: null, evaluation: null, minervini: null, earnings: { date: null, hour: null, epsEstimate: null }, news: [], insiders: null, congress: null }

function call(symbol: string, body: unknown) {
  const request = new Request('http://localhost/api/stocks/x/chat', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
  return POST(request as never, { params: Promise.resolve({ symbol }) })
}
const ask = (text = 'Come va?') => ({ messages: [{ role: 'user', text }] })

describe('POST /api/stocks/[symbol]/chat', () => {
  beforeEach(async () => {
    await resetDb()
    vi.clearAllMocks()
    mocks.rateLimit.mockResolvedValue(null)
    mocks.isChatConfigured.mockReturnValue(true)
    mocks.loadStockChatInput.mockResolvedValue(input)
    mocks.streamChat.mockImplementation(async function* () {
      yield { type: 'text', delta: 'Ciao' }
      yield { type: 'sources', items: [{ title: 'A', url: 'https://a.example' }] }
    })
  })

  it('returns 503 when the chat is not configured', async () => {
    mocks.isChatConfigured.mockReturnValue(false)
    expect((await call('AAPL', ask())).status).toBe(503)
  })

  it('returns the rate limit response when over the limit', async () => {
    mocks.rateLimit.mockResolvedValue(Response.json({ error: 'Too many requests' }, { status: 429 }))
    expect((await call('AAPL', ask())).status).toBe(429)
    expect(mocks.streamChat).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON and for an invalid conversation', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    expect((await call('AAPL', '{not json')).status).toBe(400)
    expect((await call('AAPL', { messages: [] })).status).toBe(400)
    expect((await call('AAPL', { messages: [{ role: 'user', text: '   ' }] })).status).toBe(400)
  })

  it('returns 404 for a stock that is not in the watchlist', async () => {
    expect((await call('NOPE', ask())).status).toBe(404)
    expect(mocks.streamChat).not.toHaveBeenCalled()
  })

  it('streams the events as SSE and passes context and history to the model', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const res = await call('aapl', ask('Perché è sceso?'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.text()
    expect(body).toContain('event: text\ndata: {"type":"text","delta":"Ciao"}\n\n')
    expect(body).toContain('event: sources\ndata: {"type":"sources","items":[{"title":"A","url":"https://a.example"}]}\n\n')
    const args = mocks.streamChat.mock.calls[0][0]
    expect(args.history).toEqual([{ role: 'user', text: 'Perché è sceso?' }])
    expect(args.system).toContain('Apple Inc. (NASDAQ: AAPL)')
    expect(args.system).toContain('italiano')
  })

  it('forwards a model error event and still closes the stream', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    mocks.streamChat.mockImplementation(async function* () {
      yield { type: 'error', code: 'upstream' }
    })
    expect(await (await call('AAPL', ask())).text()).toContain('event: error\ndata: {"type":"error","code":"upstream"}')
  })

  it('reports upstream when the model client throws', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    // eslint-disable-next-line require-yield
    mocks.streamChat.mockImplementation(async function* () {
      throw new Error('boom')
    })
    expect(await (await call('AAPL', ask())).text()).toContain('"code":"upstream"')
  })

  it('aborts the model call when the client disconnects', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    let seen: AbortSignal | undefined
    mocks.streamChat.mockImplementation(async function* ({ signal }: { signal: AbortSignal }) {
      seen = signal
      yield { type: 'text', delta: 'a' }
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    })
    const res = await call('AAPL', ask())
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    await vi.waitFor(() => expect(seen?.aborted).toBe(true))
  })
})
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/api/stock-chat.test.ts`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementa la route**

```ts
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { currentUserId, findEntry } from '@/lib/watchlist'
import { parseChatRequest } from '@/lib/chat-request'
import { isChatConfigured, streamChat } from '@/lib/gemini-chat'
import { loadStockChatInput } from '@/lib/stock-chat-data'
import { buildStockContext, SYSTEM_PROMPT } from '@/lib/stock-chat-context'

export const maxDuration = 60

const encoder = new TextEncoder()
const sse = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

export async function POST(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  if (!isChatConfigured()) return NextResponse.json({ error: 'Chat not configured' }, { status: 503 })
  const limited = await rateLimit('heavy')
  if (limited) return limited

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = parseChatRequest(json)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()
  const entry = await findEntry(await currentUserId(), symbol)
  if (!entry) return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })

  const system = `${SYSTEM_PROMPT}\n\n--- CONTESTO DEL TITOLO ---\n${buildStockContext(await loadStockChatInput(entry))}`

  const abort = new AbortController()
  request.signal.addEventListener('abort', () => abort.abort())
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamChat({ system, history: parsed.history, signal: abort.signal })) {
          if (abort.signal.aborted) break
          controller.enqueue(sse(event.type, event))
        }
      } catch {
        if (!abort.signal.aborted) controller.enqueue(sse('error', { type: 'error', code: 'upstream' }))
      }
      if (!abort.signal.aborted) controller.close()
    },
    cancel() {
      abort.abort()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' },
  })
}
```

- [ ] **Step 4: Verifica che passino, insieme al test di copertura auth**

Run: `npx vitest run tests/api/stock-chat.test.ts tests/api/auth-coverage.test.ts`
Expected: PASS (la nuova route è rilevata da `auth-coverage` e ha un solo handler con un solo `await requireUser(`).

- [ ] **Step 5: Commit**

```bash
git add "app/api/stocks/[symbol]/chat/route.ts" tests/api/stock-chat.test.ts
git commit -m "feat: add the streaming chat route for a watched stock"
```

---

### Task 6: Componente `StockChat`

**Files:**
- Create: `components/StockChat.tsx`, `components/StockChat.module.css`
- Test: `tests/components/StockChat.test.tsx`

**Interfaces:**
- Consumes: `sseMessages` (Task 1), `MAX_MESSAGES`, `MAX_CHARS`, `ChatTurn` (Task 3).
- Produces: `StockChat({ symbol, name }: { symbol: string; name: string })`. Fa `POST /api/stocks/${symbol}/chat` con `{ messages: ChatTurn[] }`.

- [ ] **Step 1: Scrivi i test che falliscono**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StockChat } from '@/components/StockChat'

const enc = new TextEncoder()

const frame = (e: { event: string; data: unknown }) => enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)

// A finished stream, a stream that breaks after its events (error() would drop queued chunks, so it fails on the next read),
// or a stream that stays open until the request is aborted, like a real fetch body.
function sseBody(events: { event: string; data: unknown }[], opts: { hangUntil?: AbortSignal; fail?: boolean } = {}): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(c) {
      if (i < events.length) return c.enqueue(frame(events[i++]))
      if (opts.fail) return c.error(new Error('network down'))
      if (opts.hangUntil) {
        return new Promise<void>((resolve) => {
          opts.hangUntil!.addEventListener('abort', () => {
            c.error(new DOMException('aborted', 'AbortError'))
            resolve()
          })
        })
      }
      c.close()
    },
  })
}

const ok = (events: { event: string; data: unknown }[], opts = {}) => ({ ok: true, status: 200, body: sseBody(events, opts) })
const hanging = (events: { event: string; data: unknown }[]) => (_url: string, init: RequestInit) => Promise.resolve(ok(events, { hangUntil: init.signal as AbortSignal }))
const text = (delta: string) => ({ event: 'text', data: { type: 'text', delta } })

function open() {
  render(<StockChat symbol="AAPL" name="Apple Inc." />)
  fireEvent.click(screen.getByRole('button', { name: /chiedi all.ia/i }))
  return screen.getByRole('textbox')
}

function sentBody(call: number) {
  return JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[call][1].body)
}

describe('StockChat', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows only the launcher until opened, then a dialog with suggestions and the disclaimer', () => {
    render(<StockChat symbol="AAPL" name="Apple Inc." />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /chiedi all.ia/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /perché si è mosso oggi/i })).toBeInTheDocument()
    expect(screen.getByText(/non è consulenza finanziaria/i)).toBeInTheDocument()
  })

  it('streams the answer and shows http sources as safe links', async () => {
    ;(fetch as any).mockResolvedValue(
      ok([text('Ciao '), text('mondo'), { event: 'sources', data: { type: 'sources', items: [{ title: 'Reuters', url: 'https://r.example/a' }, { title: 'Bad', url: 'javascript:alert(1)' }] } }]),
    )
    const box = open()
    fireEvent.change(box, { target: { value: 'Come va?' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(await screen.findByText('Ciao mondo')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/stocks/AAPL/chat', expect.objectContaining({ method: 'POST' }))
    expect(sentBody(0)).toEqual({ messages: [{ role: 'user', text: 'Come va?' }] })
    const link = await screen.findByRole('link', { name: 'Reuters' })
    expect(link).toHaveAttribute('href', 'https://r.example/a')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByRole('link', { name: 'Bad' })).toBeNull()
  })

  it('sends a suggested question when clicked', async () => {
    ;(fetch as any).mockResolvedValue(ok([text('ok')]))
    open()
    fireEvent.click(screen.getByRole('button', { name: /quali sono i rischi principali/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(sentBody(0).messages[0].text).toMatch(/rischi principali/i)
  })

  it('does not send on Shift+Enter, nor an empty message', () => {
    const box = open()
    fireEvent.change(box, { target: { value: 'riga uno' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores a second send while an answer is streaming, and stops on "Interrompi"', async () => {
    ;(fetch as any).mockImplementation(hanging([text('parziale')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'uno' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('parziale')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'due' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(fetch).toHaveBeenCalledTimes(1)

    const signal = (fetch as any).mock.calls[0][1].signal as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: /interrompi/i }))
    expect(signal.aborted).toBe(true)
    await waitFor(() => expect(screen.queryByRole('button', { name: /interrompi/i })).toBeNull())
    expect(screen.getByText('parziale')).toBeInTheDocument()
    expect(screen.queryByText(/qualcosa è andato storto|riprova/i)).toBeNull()
  })

  it('shows the error for the status code and retries the same question', async () => {
    ;(fetch as any).mockResolvedValueOnce({ ok: false, status: 429, body: null }).mockResolvedValueOnce(ok([text('risposta')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'domanda' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/troppe richieste/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /riprova/i }))
    expect(await screen.findByText('risposta')).toBeInTheDocument()
    expect(sentBody(1)).toEqual({ messages: [{ role: 'user', text: 'domanda' }] })
  })

  it('keeps partial text when the stream breaks, and leaves the failed turn out of the next request', async () => {
    ;(fetch as any).mockResolvedValueOnce(ok([text('metà')], { fail: true })).mockResolvedValueOnce(ok([text('ok')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'prima' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('metà')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /riprova/i })).toBeInTheDocument()

    fireEvent.change(box, { target: { value: 'seconda' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(sentBody(1)).toEqual({ messages: [{ role: 'user', text: 'seconda' }] })
  })

  it('sends the whole conversation on the second question', async () => {
    ;(fetch as any).mockResolvedValueOnce(ok([text('r1')])).mockResolvedValueOnce(ok([text('r2')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'q1' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('r1')
    await waitFor(() => expect(screen.queryByRole('button', { name: /interrompi/i })).toBeNull())
    fireEvent.change(box, { target: { value: 'q2' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('r2')
    expect(sentBody(1).messages).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'model', text: 'r1' },
      { role: 'user', text: 'q2' },
    ])
  })

  it('"Nuova chat" clears the conversation', async () => {
    ;(fetch as any).mockResolvedValue(ok([text('r1')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'q1' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('r1')
    fireEvent.click(screen.getByRole('button', { name: /nuova chat/i }))
    expect(screen.queryByText('r1')).toBeNull()
    expect(screen.getByRole('button', { name: /perché si è mosso oggi/i })).toBeInTheDocument()
  })

  it('closes on Escape and gives the focus back to the launcher', () => {
    open()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /chiedi all.ia/i })).toHaveFocus()
  })

  it('aborts a running answer when the page is left', async () => {
    ;(fetch as any).mockImplementation(hanging([text('x')]))
    const { unmount } = render(<StockChat symbol="AAPL" name="Apple Inc." />)
    fireEvent.click(screen.getByRole('button', { name: /chiedi all.ia/i }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await screen.findByText('x')
    const signal = (fetch as any).mock.calls[0][1].signal as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
```

Nota: i test `open()` usano `render` interno; il test "aborts a running answer" fa il proprio `render` per avere `unmount`.

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/components/StockChat.test.tsx`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementa il componente**

```tsx
'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { sseMessages } from '@/lib/sse'
import { MAX_CHARS, MAX_MESSAGES, type ChatTurn } from '@/lib/chat-request'
import styles from './StockChat.module.css'

type ErrorCode = 'rate_limited' | 'upstream' | 'timeout' | 'unavailable'

interface Message {
  role: 'user' | 'model'
  text: string
  sources?: { title: string; url: string }[]
  error?: ErrorCode
}

const ERRORS: Record<ErrorCode, string> = {
  rate_limited: 'Troppe richieste in poco tempo: riprova tra un minuto.',
  upstream: 'Il servizio non ha risposto: riprova.',
  timeout: 'La risposta ha impiegato troppo: riprova.',
  unavailable: 'La chat non è disponibile al momento.',
}

const SUGGESTIONS = ['Perché si è mosso oggi?', 'Ci sono notizie recenti rilevanti?', 'Quali sono i rischi principali?']

// A turn that failed (error or no text) is left out, together with its question, so the conversation keeps alternating.
function toHistory(messages: Message[]): ChatTurn[] {
  const out: ChatTurn[] = []
  for (let i = 0; i < messages.length; i++) {
    const next = messages[i + 1]
    if (messages[i].role === 'user' && next && next.role === 'model' && (next.error || !next.text)) {
      i++
      continue
    }
    out.push({ role: messages[i].role, text: messages[i].text })
  }
  return out
}

export function StockChat({ symbol, name }: { symbol: string; name: string }) {
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const busy = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  const full = toHistory(messages).length >= MAX_MESSAGES

  async function send(raw: string, base: Message[] = messages) {
    const question = raw.trim().slice(0, MAX_CHARS)
    if (!question || busy.current) return
    const history = toHistory(base)
    if (history.length >= MAX_MESSAGES) return

    busy.current = true
    setStreaming(true)
    setDraft('')
    setMessages([...base, { role: 'user', text: question }, { role: 'model', text: '' }])
    const controller = new AbortController()
    abortRef.current = controller
    const patch = (fn: (m: Message) => Message) => setMessages((cur) => cur.map((m, i) => (i === cur.length - 1 ? fn(m) : m)))

    try {
      const res = await fetch(`/api/stocks/${encodeURIComponent(symbol)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...history, { role: 'user', text: question }] }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const error: ErrorCode = res.status === 429 ? 'rate_limited' : res.status === 503 ? 'unavailable' : 'upstream'
        patch((m) => ({ ...m, error }))
        return
      }
      for await (const message of sseMessages(res.body)) {
        const data = JSON.parse(message.data)
        if (message.event === 'text') patch((m) => ({ ...m, text: m.text + data.delta }))
        else if (message.event === 'sources') patch((m) => ({ ...m, sources: data.items }))
        else if (message.event === 'error') patch((m) => ({ ...m, error: data.code }))
      }
    } catch {
      if (!controller.signal.aborted) patch((m) => ({ ...m, error: 'upstream' }))
    } finally {
      busy.current = false
      setStreaming(false)
    }
  }

  function retry() {
    const at = messages.map((m) => m.role).lastIndexOf('user')
    if (at !== -1) void send(messages[at].text, messages.slice(0, at))
  }

  function reset() {
    abortRef.current?.abort()
    busy.current = false
    setStreaming(false)
    setMessages([])
    setDraft('')
  }

  function close() {
    setOpen(false)
    queueMicrotask(() => launcherRef.current?.focus())
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(draft)
    }
  }

  const last = messages[messages.length - 1]
  const canRetry = !streaming && last?.role === 'model' && Boolean(last.error) && last.error !== 'unavailable'

  return (
    <>
      {!open && (
        <button ref={launcherRef} type="button" className={styles.launcher} aria-label={`Chiedi all’IA su ${symbol}`} onClick={() => setOpen(true)}>
          <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true" fill="currentColor">
            <path d="M8 0l1.7 5.3L15 7l-5.3 1.7L8 14l-1.7-5.3L1 7l5.3-1.7z" />
          </svg>
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className={styles.panel}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
          }}
        >
          <header className={styles.head}>
            <div>
              <h2 id={titleId} className={styles.title}>
                Chiedi all’IA su {symbol}
              </h2>
              <span className={styles.badge}>Scritto dall’IA</span>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.textButton} onClick={reset}>
                Nuova chat
              </button>
              <button type="button" className={styles.iconButton} aria-label="Chiudi" onClick={close}>
                ×
              </button>
            </div>
          </header>

          <div ref={listRef} className={styles.list} aria-live="polite">
            {messages.length === 0 && (
              <div className={styles.empty}>
                <p>Chiedimi di {name}: uso i dati dell’app e, per le notizie recenti, il web.</p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className={styles.suggestion} onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) =>
              m.role === 'model' && !m.text && !m.error ? null : (
                <div key={i} className={m.role === 'user' ? styles.user : styles.model}>
                  {m.text && <p className={styles.text}>{m.text}</p>}
                  {m.sources && m.sources.length > 0 && (
                    <p className={styles.sources}>
                      Fonti:{' '}
                      {m.sources
                        .filter((s) => /^https?:\/\//i.test(s.url))
                        .map((s) => (
                          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
                            {s.title}
                          </a>
                        ))}
                    </p>
                  )}
                  {m.error && <p className={styles.error}>{ERRORS[m.error]}</p>}
                </div>
              ),
            )}
            {canRetry && (
              <button type="button" className={styles.textButton} onClick={retry}>
                Riprova
              </button>
            )}
          </div>

          <div className={styles.composer}>
            {full ? (
              <p className={styles.hint}>La conversazione è lunga: avvia una nuova chat per continuare.</p>
            ) : (
              <textarea
                ref={inputRef}
                className={styles.input}
                rows={2}
                maxLength={MAX_CHARS}
                value={draft}
                placeholder={`Chiedi qualcosa su ${name}`}
                aria-label="La tua domanda"
                disabled={streaming}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
              />
            )}
            {streaming && (
              <button type="button" className={styles.stop} onClick={() => abortRef.current?.abort()}>
                Interrompi
              </button>
            )}
            <p className={styles.disclaimer}>Può contenere errori e non è consulenza finanziaria.</p>
          </div>
        </div>
      )}
    </>
  )
}
```

Attenzione: durante lo streaming la `textarea` è `disabled`; i test inviano comunque via `fireEvent.keyDown` sul nodo, quindi il guard `busy.current` è ciò che li protegge (e quello che il test "ignores a second send" verifica).

- [ ] **Step 4: Aggiungi gli stili**

`components/StockChat.module.css`:

```css
.launcher {
  position: fixed;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom));
  z-index: 50;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  color: var(--ink);
  background: var(--ai);
  border: 0;
  border-radius: 999px;
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.35);
  cursor: pointer;
}

.panel {
  position: fixed;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom));
  z-index: 50;
  display: flex;
  flex-direction: column;
  width: 380px;
  height: 560px;
  max-height: calc(100dvh - 32px);
  background: var(--ai-surface);
  border: 1px solid var(--ai-rule);
  border-radius: var(--radius-card);
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.45);
  overflow: hidden;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ai-rule);
}

.title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ai);
  background: color-mix(in srgb, var(--ai) 14%, transparent);
  border-radius: 999px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.textButton,
.iconButton,
.suggestion,
.stop {
  font: inherit;
  color: var(--bone);
  background: transparent;
  border: 1px solid var(--ai-rule);
  border-radius: var(--radius-inner);
  cursor: pointer;
}

.textButton {
  padding: 4px 10px;
  font-size: 12px;
}

.iconButton {
  width: 28px;
  height: 28px;
  font-size: 18px;
  line-height: 1;
}

.list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  overflow-y: auto;
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}

.suggestion {
  padding: 8px 12px;
  font-size: 13px;
  text-align: left;
}

.user,
.model {
  max-width: 92%;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.45;
  border-radius: var(--radius-inner);
}

.user {
  align-self: flex-end;
  background: color-mix(in srgb, var(--ai) 22%, transparent);
}

.model {
  align-self: flex-start;
  background: var(--surface-raised);
}

.text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.sources {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.sources a {
  margin-right: 8px;
  color: var(--ai);
}

.error {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--loss-bright);
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--ai-rule);
}

.input {
  width: 100%;
  padding: 8px 10px;
  font: inherit;
  font-size: 14px;
  color: var(--bone);
  background: var(--surface);
  border: 1px solid var(--ai-rule);
  border-radius: var(--radius-inner);
  resize: none;
}

.stop {
  align-self: flex-end;
  padding: 4px 12px;
  font-size: 12px;
}

.hint,
.disclaimer {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}

@media (max-width: 640px) {
  .panel {
    inset: 0;
    width: auto;
    height: auto;
    max-height: none;
    border-radius: 0;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .panel {
    animation: rise 160ms ease-out;
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
```

- [ ] **Step 5: Verifica che passino**

Run: `npx vitest run tests/components/StockChat.test.tsx`
Expected: PASS (11 test).

- [ ] **Step 6: Commit**

```bash
git add components/StockChat.tsx components/StockChat.module.css tests/components/StockChat.test.tsx
git commit -m "feat: add the floating stock chat component"
```

---

### Task 7: Montaggio nella scheda, configurazione e verifica

**Files:**
- Modify: `app/stock/[symbol]/page.tsx` (import in cima; il componente dopo `<StockTabs ... />`, riga ~497-630)
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-11-18-stock-chat-design.md` (allineamento alle differenze)

**Interfaces:**
- Consumes: `StockChat` (Task 6), `isChatConfigured` (Task 3).

- [ ] **Step 1: Monta il componente nella scheda dei titoli seguiti**

Aggiungi gli import tra quelli esistenti:

```tsx
import { StockChat } from '@/components/StockChat'
import { isChatConfigured } from '@/lib/gemini-chat'
```

Subito dopo la chiusura di `<StockTabs ... />` (l'ultimo elemento del fragment restituito da `StockDetail`, prima di `</>`), aggiungi:

```tsx
      {isChatConfigured() && <StockChat symbol={stock.symbol} name={stock.name} />}
```

Non toccare `StockPreview` né `IpoPreview` (titoli non seguiti: vedi differenza 1).

- [ ] **Step 2: Documenta la variabile**

In `.env.example`, dopo la riga `GEMINI_API_KEY`:

```
# Chat sul titolo (usa GEMINI_API_KEY e la ricerca web di Gemini). Opzionale: modello, default gemini-3.8-flash
# GEMINI_CHAT_MODEL="gemini-3.8-flash"
```

- [ ] **Step 3: Verifica che il modello di default supporti `google_search`**

Con una chiave valida in `.env.local`, una chiamata reale (il documento di riferimento mostra `gemini-3.8-flash`):

```bash
set -a; source .env.local; set +a
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Qual è l'\''ultima notizia su Apple Inc.?"}]}],"tools":[{"google_search":{}}]}' \
  | head -c 1200
```

Expected: JSON con `candidates[0].content` e `groundingMetadata`. Se risponde con un errore sul tool o sul modello, scegli un altro modello Gemini che supporta il grounding, aggiorna `DEFAULT_MODEL` in `lib/gemini-chat.ts` e il valore in `tests/lib/gemini-chat.test.ts` (test "sends system instruction...") e in `.env.example`.

- [ ] **Step 4: Controlli statici e suite completa**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: nessun errore di tipo né di lint; tutti i test passano.

- [ ] **Step 5: Prova nel browser**

Run: `npm run dev`, apri la scheda di un titolo in watchlist e verifica a mano:
1. il bottone tondo compare in basso a destra, e non compare senza `GEMINI_API_KEY`;
2. una domanda ("Perché si è mosso oggi?") produce testo in streaming e, se il modello ha cercato sul web, i link "Fonti";
3. "Interrompi" ferma la risposta; "Nuova chat" svuota la chat; Esc chiude e riporta il focus sul bottone;
4. su viewport stretto (< 640 px) il pannello è a schermo intero e il bottone non copre la navigazione mobile (se la copre, alza `bottom` in `.launcher` e `.panel`);
5. dopo qualche domanda ripetuta, la risposta 429 mostra "Troppe richieste in poco tempo";
6. tema chiaro e scuro leggibili.

- [ ] **Step 6: Allinea la spec**

Nella spec, applica le quattro differenze elencate all'inizio di questo piano:
- "Il simbolo deve esistere in `Stock`" diventa "il titolo deve essere nella watchlist dell'utente (`findEntry`)", e il bottone compare solo nella scheda dei titoli seguiti;
- sostituisci "Nessuna cache di Next: ... (`connection()`...)" con "La route esporta solo `maxDuration = 60`: un `POST` non è in cache e `cacheComponents` non ammette `dynamic`";
- nei blocchi del contesto togli "settore", scrivi "Dividendi e crescita: rendimento, payout, crescita EPS 5 anni" e "Congresso: acquisti e vendite negli ultimi 180 giorni";
- sostituisci "la chiusura del pannello ferma lo stream" con "lo stream si ferma con Interrompi, Nuova chat o lasciando la pagina; il server annulla Gemini se il client si disconnette".

- [ ] **Step 7: Commit**

```bash
git add "app/stock/[symbol]/page.tsx" .env.example docs/superpowers/specs/2026-11-18-stock-chat-design.md
git commit -m "feat: mount the stock chat on the watched stock page"
```
