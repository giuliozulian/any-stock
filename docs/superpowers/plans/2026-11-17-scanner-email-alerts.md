# Avvisi email dello scanner Minervini Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inviare una email quando un titolo raggiunge gli 8 criteri su 8 (busta per titolo e interruttore sui nuovi 8 su 8), far partire la scansione ogni sera in automatico e mostrare uno skeleton mentre `/scanner` carica.

**Architecture:** Alla chiusura di una scansione, `notifyScanAlerts` (nuovo modulo DB in `lib/scan-alerts-db.ts`) raccoglie i titoli armati e i nuovi 8 su 8, costruisce una sola email HTML con testo di riserva (`lib/scan-alerts.ts`, funzioni pure) e la invia con `sendEmail`; solo a invio riuscito segna gli avvisi come inviati. I testi del verdetto escono da `ScannerTable` in `lib/scan-verdict.ts` per essere identici in pagina e in email. Un workflow GitHub Actions serale lancia la scansione tramite le route già esistenti.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 7 + Postgres, nodemailer / Resend, CSS modules, vitest + Testing Library, GitHub Actions + bash/curl/jq.

**Spec:** `docs/superpowers/specs/2026-11-17-scanner-email-alerts-design.md`. Deviazioni intenzionali: (1) il codice del workflow sta inline in `.github/workflows/scanner.yml`, perché `.gitignore` esclude ogni cartella chiamata `scripts/` (anche `.github/scripts/`); (2) le funzioni che toccano il DB stanno in `lib/scan-alerts-db.ts` e quelle pure in `lib/scan-alerts.ts`, per evitare un import circolare con `lib/scanner-run.ts`; (3) `setNewEntrants(true)` fotografa `knownFull` solo quando l'interruttore passa da spento ad acceso, così un secondo `PUT true` non cancella i nuovi 8 su 8 in attesa.

## Global Constraints

- Testi UI e email in italiano, frasi in minuscolo con la maiuscola iniziale, come il resto dell'app. Messaggi di commit in inglese, stile convenzionale (`feat:`, `fix:`, `refactor:`), **senza trailer `Co-Authored-By` e senza menzionare Claude o AI** (regola utente in `~/.claude/CLAUDE.md`).
- **Commit:** l'utente ha scritto "commit fatto io". Prima del Task 1 l'esecutore chiede se può committare; se no, salta ogni passo "Commit", elenca nel ledger i file modificati per task e non esegue `git add`/`git commit`.
- AGENTS.md: questo Next.js ha differenze rispetto al noto. Le route seguono `app/api/scanner/route.ts`: `export async function POST(...)` e, per i parametri dinamici, `{ params }: { params: Promise<{ symbol: string }> }` (vedi `app/api/discover/[symbol]/route.ts`).
- Test in `tests/lib/*.test.ts`, `tests/api/*.test.ts`, `tests/components/*.test.tsx`; alias `@/` = radice. Comando: `npx vitest run <file>`. Test su DB: `docker compose -f docker-compose.test.yml up -d` (già attivo come `any-stock-postgres-test-1`).
- **Mai eseguire migrazioni sul DB remoto** (`.env.local`, Supabase). Si migra solo il DB di test: `DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2- | tr -d '"') npx prisma migrate dev --name <nome>`, poi `npx prisma generate`. Il `migrate deploy` remoto lo fa l'utente.
- `lib/notify.ts`: `sendEmail` non lancia mai eccezioni e restituisce `false` se l'email non è configurata o fallisce. Il comportamento senza `html` non cambia.
- La chiusura di una scansione non deve mai fallire per colpa dell'email: `notifyScanAlerts` non lancia eccezioni.
- Condizione di avviso: `passedCount >= 8`. Avviso una volta sola per titolo (`notifiedAt`). Contesto dei prezzi nell'email come in pagina: `caution = 'session'` se la scansione è partita o finita in sessione USA (`isUsSession`), salute del mercato da `marketHealth`.
- Variabile opzionale `APP_URL`: se manca, l'email esce senza link.
- Le route non hanno autenticazione, come il resto dell'app (task 4 di `auditcalc.md`); non aggiungerla qui.
- `scripts/` è ignorata da git: nessun file da committare lì (gli script di prova vanno nella scratchpad).
- Fuori scope: più destinatari o account, push/SMS, avvisi in uscita dagli 8 su 8, avvisi sul prezzo, orari di silenzio.

## Review Focus

Condizioni che la spec implica ma non descrive passo per passo; ognuna ha un test nel task indicato.

1. Invio fallito, errore lanciato da `sendEmail` o email non configurata → nulla viene segnato come inviato e il tentativo si ripete alla scansione dopo (Task 5).
2. Nome o settore di un'azienda con `<`, `&` o virgolette → l'HTML li escapa, il testo semplice no (Task 4).
3. Due richieste `step` che chiudono insieme la scansione → una sola email (Task 5).
4. Armare un simbolo che non è nell'ultima scansione completa, che vi compare solo come "non letto", o senza alcuna scansione → 404 e nessuna riga creata (Task 6).
5. Interruttore globale: la prima attivazione non invia l'elenco già esistente e un secondo `PUT true` non cancella i nuovi 8 su 8 in attesa (Task 6 e 5). Inoltre, clic rapidi sulla busta: l'esito di una vecchia richiesta non sovrascrive l'ultimo clic (Task 7).

---

### Task 1: `sendEmail` con HTML e `emailConfigured`

**Files:**
- Modify: `lib/notify.ts`
- Test: `tests/lib/notify.test.ts` (nuovo)

**Interfaces:**
- Produces:
  - `sendEmail(subject: string, text: string, html?: string): Promise<boolean>` (stesso comportamento di prima quando `html` manca)
  - `emailConfigured(): boolean` (true se `ALERT_EMAIL_TO` e almeno uno tra `SMTP_HOST` e `RESEND_API_KEY` sono impostati)

- [ ] **Step 1: Write the failing test** — crea `tests/lib/notify.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue({}))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))

import { emailConfigured, sendEmail } from '@/lib/notify'

describe('sendEmail', () => {
  beforeEach(() => {
    sendMail.mockClear()
    vi.stubEnv('ALERT_EMAIL_TO', 'me@example.com')
    vi.stubEnv('SMTP_HOST', 'smtp.example.com')
    vi.stubEnv('RESEND_API_KEY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('sends the html next to the plain text over SMTP', async () => {
    expect(await sendEmail('Oggetto', 'testo', '<p>html</p>')).toBe(true)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'me@example.com', subject: 'Oggetto', text: 'testo', html: '<p>html</p>' }))
  })

  it('sends no html key when none is given, as before', async () => {
    await sendEmail('Oggetto', 'testo')
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('html')
  })

  it('sends the html through Resend too', async () => {
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('RESEND_API_KEY', 'key')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendEmail('Oggetto', 'testo', '<p>html</p>')).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ subject: 'Oggetto', text: 'testo', html: '<p>html</p>', to: ['me@example.com'] })
  })

  it('leaves html out of the Resend body when none is given', async () => {
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('RESEND_API_KEY', 'key')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await sendEmail('Oggetto', 'testo')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('html')
  })

  it('returns false instead of throwing when the transport fails', async () => {
    sendMail.mockRejectedValueOnce(new Error('boom'))
    expect(await sendEmail('Oggetto', 'testo', '<p>x</p>')).toBe(false)
  })

  it('returns false when no recipient or provider is configured', async () => {
    vi.stubEnv('ALERT_EMAIL_TO', '')
    expect(await sendEmail('Oggetto', 'testo')).toBe(false)
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('emailConfigured', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('needs a recipient and a provider', () => {
    vi.stubEnv('ALERT_EMAIL_TO', 'me@example.com')
    vi.stubEnv('SMTP_HOST', 'smtp.example.com')
    vi.stubEnv('RESEND_API_KEY', '')
    expect(emailConfigured()).toBe(true)
    vi.stubEnv('SMTP_HOST', '')
    expect(emailConfigured()).toBe(false)
    vi.stubEnv('RESEND_API_KEY', 'key')
    expect(emailConfigured()).toBe(true)
    vi.stubEnv('ALERT_EMAIL_TO', '')
    expect(emailConfigured()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/notify.test.ts`
Expected: FAIL (`emailConfigured` non esportata; i test con `html` falliscono).

- [ ] **Step 3: Write minimal implementation** — in `lib/notify.ts` applicare con Python (le sostituzioni sono esatte sul testo attuale):

```python
p='lib/notify.ts'
s=open(p).read()
pairs=[
("async function sendViaSmtp(to: string, subject: string, text: string): Promise<void> {","async function sendViaSmtp(to: string, subject: string, text: string, html?: string): Promise<void> {"),
("await transport.sendMail({ from: process.env.ALERT_EMAIL_FROM ?? process.env.SMTP_USER, to, subject, text })","await transport.sendMail({ from: process.env.ALERT_EMAIL_FROM ?? process.env.SMTP_USER, to, subject, text, ...(html ? { html } : {}) })"),
("async function sendViaResend(apiKey: string, to: string, subject: string, text: string): Promise<void> {","async function sendViaResend(apiKey: string, to: string, subject: string, text: string, html?: string): Promise<void> {"),
("to: [to], subject, text }),","to: [to], subject, text, ...(html ? { html } : {}) }),"),
("export async function sendEmail(subject: string, text: string): Promise<boolean> {","export async function sendEmail(subject: string, text: string, html?: string): Promise<boolean> {"),
("await sendViaSmtp(to, subject, text)","await sendViaSmtp(to, subject, text, html)"),
("await sendViaResend(resendKey!, to, subject, text)","await sendViaResend(resendKey!, to, subject, text, html)"),
]
for a,b in pairs:
    assert a in s, a
    s=s.replace(a,b,1)
s+='''
// True when sendEmail can actually deliver: a recipient and either SMTP or Resend.
export function emailConfigured(): boolean {
  return Boolean(process.env.ALERT_EMAIL_TO) && Boolean(process.env.SMTP_HOST || process.env.RESEND_API_KEY)
}
'''
open(p,'w').write(s)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/notify.test.ts tests/lib/alerts.test.ts && npx tsc --noEmit`
Expected: PASS, nessun errore di tipi.

- [ ] **Step 5: Commit**

```bash
git add lib/notify.ts tests/lib/notify.test.ts
git commit -m "feat: let emails carry an html body"
```

---

### Task 2: Modulo condiviso `lib/scan-verdict.ts`

**Files:**
- Create: `lib/scan-verdict.ts`
- Modify: `components/ScannerTable.tsx`
- Test: `tests/lib/scan-verdict.test.ts` (nuovo); `tests/components/ScannerTable.test.tsx` deve restare verde senza modifiche

**Interfaces:**
- Consumes: da `lib/scanner.ts`: `tradePlan`, `withContext`, `missingCriterion`, `isUsSession`, tipi `Verdict`, `TradePlan`, `PlanNote`, `PlanContext`, `MarketLevel`; da `lib/minervini.ts`: tipi `Criterion`, `VcpStatus`.
- Produces (da `lib/scan-verdict.ts`):
  - `interface ScanRow { symbol: string; name: string; sector: string | null; price: number; rs: number | null; passedCount: number; vcpStatus: VcpStatus | null; pivot: number | null; pivotDistancePct: number | null; volumeRatio: number | null; missing: string | null }`
  - `const VERDICT: Record<Verdict, { label: string; tone: 'buy' | 'gain' | 'warn' | 'loss' | 'muted'; rank: number }>`
  - `const MARKET_TEXT: Record<MarketLevel, (pct: number) => string>`
  - `fmtNum(v: number, digits?: number): string` (default 1 decimale, locale it-IT) e `fmtPrice(v: number): string` (2 decimali)
  - `sentence(row: ScanRow, plan: TradePlan, note: PlanNote): string`
  - `planFor(row: ScanRow, ctx: PlanContext): { plan: TradePlan; note: PlanNote }`
  - `interface ResultLike { symbol: string; name: string; sector: string | null; price: number | null; rs: number | null; passedCount: number | null; vcpStatus: string | null; pivot: number | null; pivotDistancePct: number | null; volumeRatio: number | null; criteria: unknown }`
  - `toScanRow(r: ResultLike): ScanRow`
  - `duringSession(startedAt: Date, finishedAt: Date | null): boolean`
- `components/ScannerTable.tsx` continua a esportare `ScannerRow` (ora `type ScannerRow = ScanRow`).

- [ ] **Step 1: Write the failing test** — crea `tests/lib/scan-verdict.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MARKET_TEXT, VERDICT, duringSession, fmtNum, fmtPrice, planFor, sentence, toScanRow, type ScanRow } from '@/lib/scan-verdict'
import { tradePlan } from '@/lib/scanner'

const row = (over: Partial<ScanRow> = {}): ScanRow => ({
  symbol: 'AAA', name: 'Alpha', sector: 'Tech', price: 102, rs: 90, passedCount: 8, vcpStatus: 'breakout', pivot: 98, pivotDistancePct: 2, volumeRatio: 1.8, missing: null, ...over,
})

describe('formatting', () => {
  it('writes numbers the Italian way', () => {
    expect(fmtNum(4.83)).toBe('4,8')
    expect(fmtNum(8, 1)).toBe('8,0')
    expect(fmtPrice(98)).toBe('98,00')
    expect(fmtPrice(1234.5)).toBe('1.234,50')
  })
})

describe('VERDICT', () => {
  it('has a label and a unique rank for every verdict', () => {
    const ranks = Object.values(VERDICT).map((v) => v.rank)
    expect(new Set(ranks).size).toBe(7)
    expect(VERDICT.buy.label).toBe('Si può comprare')
    expect(VERDICT.confirm.label).toBe('Aspetta conferma')
  })
})

describe('sentence', () => {
  it('explains a confirmed breakout with the pivot and the volume', () => {
    const r = row()
    const text = sentence(r, tradePlan(r), null)
    expect(text).toContain('98,00')
    expect(text).toContain('+80% sulla media')
  })

  it('explains why a breakout is not a buy when the scan ran with the market open', () => {
    const r = row()
    expect(sentence(r, { ...tradePlan(r), verdict: 'confirm' }, 'session')).toMatch(/volume di oggi è parziale/i)
  })

  it('explains why a breakout is not a buy in a weak market', () => {
    const r = row()
    expect(sentence(r, { ...tradePlan(r), verdict: 'confirm' }, 'weak-market')).toMatch(/il mercato è debole/i)
  })

  it('says what is missing for a 7-of-8 stock', () => {
    const r = row({ passedCount: 7, missing: 'Forza relativa almeno 70' })
    expect(sentence(r, tradePlan(r), null)).toContain('Manca un criterio: Forza relativa almeno 70')
  })

  it('explains a stock without a base', () => {
    const r = row({ vcpStatus: null, pivot: null, pivotDistancePct: null })
    expect(sentence(r, tradePlan(r), null)).toMatch(/nessuna base/i)
  })
})

describe('planFor', () => {
  it('turns a buy into "wait for confirmation" with the market open and keeps the note', () => {
    const out = planFor(row(), { caution: 'session', market: 'healthy' })
    expect(out.plan.verdict).toBe('confirm')
    expect(out.note).toBe('session')
  })

  it('keeps a buy in normal conditions', () => {
    expect(planFor(row(), { caution: null, market: null })).toMatchObject({ plan: { verdict: 'buy' }, note: null })
  })
})

describe('MARKET_TEXT', () => {
  it('words each level with the rounded percentage', () => {
    expect(MARKET_TEXT.healthy(68.4)).toBe('Mercato in salute: 68% dei titoli è sopra le medie a 150 e 200 giorni.')
    expect(MARKET_TEXT.weak(35)).toBe('Mercato debole: solo 35% dei titoli è sopra le medie a 150 e 200 giorni.')
  })
})

describe('toScanRow', () => {
  const result = {
    symbol: 'AAA', name: 'Alpha', sector: 'Tech', price: 102, rs: 90, passedCount: 8, vcpStatus: 'breakout',
    pivot: 98, pivotDistancePct: 2, volumeRatio: 1.8, criteria: [],
  }

  it('maps a stored result and leaves "missing" empty for an 8-of-8 stock', () => {
    expect(toScanRow(result)).toEqual({ ...row(), missing: null })
  })

  it('names the failed criterion of a 7-of-8 stock', () => {
    const criteria = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, label: `c${i + 1}`, ok: i !== 4, value: '', margin: null }))
    expect(toScanRow({ ...result, passedCount: 7, criteria }).missing).toBe('c5')
  })

  it('survives missing numbers and criteria', () => {
    const r = toScanRow({ ...result, price: null, passedCount: null, criteria: null })
    expect(r.price).toBe(0)
    expect(r.passedCount).toBe(0)
  })
})

describe('duringSession', () => {
  it('is true when the scan started or ended while the US market was open', () => {
    expect(duringSession(new Date('2026-11-16T14:00:00Z'), new Date('2026-11-16T14:03:00Z'))).toBe(true)
    expect(duringSession(new Date('2026-11-16T20:59:00Z'), new Date('2026-11-16T21:02:00Z'))).toBe(true)
    expect(duringSession(new Date('2026-11-16T13:29:00Z'), new Date('2026-11-16T13:31:00Z'))).toBe(true)
  })

  it('is false for a scan entirely outside the session or a missing end', () => {
    expect(duringSession(new Date('2026-11-16T22:00:00Z'), new Date('2026-11-16T22:03:00Z'))).toBe(false)
    expect(duringSession(new Date('2026-11-14T15:00:00Z'), null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/scan-verdict.test.ts`
Expected: FAIL (modulo `@/lib/scan-verdict` non esiste).

- [ ] **Step 3: Write minimal implementation**

`lib/scan-verdict.ts`:

```ts
import type { Criterion, VcpStatus } from '@/lib/minervini'
import {
  isUsSession,
  missingCriterion,
  tradePlan,
  withContext,
  type MarketLevel,
  type PlanContext,
  type PlanNote,
  type TradePlan,
  type Verdict,
} from '@/lib/scanner'

// One scanned stock as the page and the emails show it.
export interface ScanRow {
  symbol: string
  name: string
  sector: string | null
  price: number
  rs: number | null
  passedCount: number
  vcpStatus: VcpStatus | null
  pivot: number | null
  pivotDistancePct: number | null
  volumeRatio: number | null
  missing: string | null
}

export const fmtNum = (v: number, digits = 1) => v.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
export const fmtPrice = (v: number) => fmtNum(v, 2)

export const VERDICT: Record<Verdict, { label: string; tone: 'buy' | 'gain' | 'warn' | 'loss' | 'muted'; rank: number }> = {
  buy: { label: 'Si può comprare', tone: 'buy', rank: 0 },
  confirm: { label: 'Aspetta conferma', tone: 'warn', rank: 1 },
  watch: { label: 'Da tenere d’occhio', tone: 'gain', rank: 2 },
  'no-base': { label: 'Nessun punto d’ingresso', tone: 'muted', rank: 3 },
  late: { label: 'Troppo tardi', tone: 'warn', rank: 4 },
  almost: { label: 'Non ancora pronto', tone: 'muted', rank: 5 },
  broken: { label: 'Da evitare', tone: 'loss', rank: 6 },
}

export const MARKET_TEXT: Record<MarketLevel, (pct: number) => string> = {
  healthy: (p) => `Mercato in salute: ${Math.round(p)}% dei titoli è sopra le medie a 150 e 200 giorni.`,
  neutral: (p) => `Mercato neutro: ${Math.round(p)}% dei titoli è sopra le medie a 150 e 200 giorni.`,
  weak: (p) => `Mercato debole: solo ${Math.round(p)}% dei titoli è sopra le medie a 150 e 200 giorni.`,
}

export function sentence(r: ScanRow, plan: TradePlan, note: PlanNote): string {
  const pivot = r.pivot === null ? '' : fmtPrice(r.pivot)
  if (note === 'session') return `Ha superato il livello chiave (${pivot}), ma il volume di oggi è parziale: la rottura non si può confermare. Rilancia la scansione a mercato chiuso.`
  if (note === 'weak-market') return `Ha superato il livello chiave (${pivot}), ma il mercato è debole e la maggior parte delle rotture fallisce. Meglio aspettare.`
  switch (plan.verdict) {
    case 'buy':
      return `Il prezzo ha superato il livello chiave (${pivot}) con scambi forti${r.volumeRatio !== null ? ` (+${Math.round((r.volumeRatio - 1) * 100)}% sulla media)` : ''}. Per il metodo è il momento d’ingresso.`
    case 'confirm':
      return `Ha superato il livello chiave (${pivot}) ma con pochi scambi: queste rotture spesso falliscono. Meglio aspettare una conferma.`
    case 'watch':
      return `È in forma ma non ha ancora superato il livello chiave (${pivot}). Si compra solo se lo supera con scambi forti.`
    case 'late':
      return 'È già oltre il 5% sopra il livello chiave: comprare ora vuol dire inseguire il prezzo. Aspetta una nuova base.'
    case 'broken':
      return 'È sceso sotto l’ultimo minimo della base: il setup è saltato.'
    case 'no-base':
      return 'Trend forte ma nessuna base da cui entrare. Aspetta che il prezzo si fermi e ne formi una.'
    case 'almost':
      return `Manca un criterio: ${r.missing ?? 'uno dei controlli'}. Non è ancora in una tendenza solida.`
  }
}

// What to do with a stock once the context of the scan is known (partial volume, weak market).
export function planFor(row: ScanRow, ctx: PlanContext): { plan: TradePlan; note: PlanNote } {
  return withContext(tradePlan(row), ctx)
}

// The fields of a stored ScanResult that the page and the emails need.
export interface ResultLike {
  symbol: string
  name: string
  sector: string | null
  price: number | null
  rs: number | null
  passedCount: number | null
  vcpStatus: string | null
  pivot: number | null
  pivotDistancePct: number | null
  volumeRatio: number | null
  criteria: unknown
}

export function toScanRow(r: ResultLike): ScanRow {
  return {
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    price: r.price ?? 0,
    rs: r.rs,
    passedCount: r.passedCount ?? 0,
    vcpStatus: r.vcpStatus as VcpStatus | null,
    pivot: r.pivot,
    pivotDistancePct: r.pivotDistancePct,
    volumeRatio: r.volumeRatio,
    missing: r.passedCount === 7 ? missingCriterion((Array.isArray(r.criteria) ? r.criteria : []) as Criterion[], r.rs) : null,
  }
}

// Daily volume is only final once the US market has closed: a scan that touched the session has partial volume.
export function duringSession(startedAt: Date, finishedAt: Date | null): boolean {
  return isUsSession(startedAt) || (finishedAt !== null && isUsSession(finishedAt))
}
```

- [ ] **Step 4: Point `ScannerTable` at the shared module** — in `components/ScannerTable.tsx` applicare con Python:

```python
p='components/ScannerTable.tsx'
s=open(p).read()

a=s.index("export interface ScannerRow {"); b=s.index("type Group =")
s=s[:a]+"export type ScannerRow = ScanRow\n\n"+s[b:]

a=s.index("const num = (v: number, digits = 1)"); b=s.index("// A row together with what to do about it")
s=s[:a]+s[b:]

a=s.index("const MARKET_TEXT: Record<MarketLevel"); b=s.index("export function ScannerTable(")
s=s[:a]+s[b:]

old="import type { VcpStatus } from '@/lib/minervini'\nimport { tradePlan, withContext, type Caution, type MarketLevel, type PlanNote, type TradePlan, type Verdict } from '@/lib/scanner'\n"
new="import { MARKET_TEXT, VERDICT, fmtNum as num, fmtPrice as price, sentence, type ScanRow } from '@/lib/scan-verdict'\nimport { tradePlan, withContext, type Caution, type MarketLevel, type PlanNote, type TradePlan } from '@/lib/scanner'\n"
assert old in s
s=s.replace(old,new,1)
open(p,'w').write(s)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/scan-verdict.test.ts tests/components/ScannerTable.test.tsx && npx tsc --noEmit && npm run lint 2>&1 | grep -E "ScannerTable|scan-verdict"`
Expected: PASS (le 34 prove della tabella restano verdi), nessun errore di tipi, nessuna riga di lint sui due file (se `lint` segnala import non usati in `ScannerTable.tsx`, toglierli).

- [ ] **Step 6: Commit**

```bash
git add lib/scan-verdict.ts components/ScannerTable.tsx tests/lib/scan-verdict.test.ts
git commit -m "refactor: share scanner verdict texts between page and emails"
```

---

### Task 3: Schema Prisma e migrazione

**Files:**
- Modify: `prisma/schema.prisma` (in fondo)
- Create: `prisma/migrations/<timestamp>_add_scan_alerts/migration.sql` (generata)
- Modify: `tests/helpers/db.ts`

**Interfaces:**
- Produces: modelli Prisma `ScanAlert { id, symbol @unique, armedAt, notifiedAt? }` e `ScannerAlertSettings { id @default("default"), newEntrants, knownFull String[], updatedAt }`; `resetDb()` svuota anche le due tabelle.

- [ ] **Step 1: Aggiungere i modelli** in fondo a `prisma/schema.prisma`:

```prisma
model ScanAlert {
  id         String    @id @default(cuid())
  symbol     String    @unique
  armedAt    DateTime  @default(now())
  notifiedAt DateTime?
}

model ScannerAlertSettings {
  id          String   @id @default("default")
  newEntrants Boolean  @default(false)
  knownFull   String[]
  updatedAt   DateTime @updatedAt
}
```

- [ ] **Step 2: Migrazione sul solo DB di test**

Run: `DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2- | tr -d '"') npx prisma migrate dev --name add_scan_alerts && npx prisma generate`
Expected: crea `prisma/migrations/<timestamp>_add_scan_alerts/migration.sql` con `CREATE TABLE "ScanAlert"` e `"ScannerAlertSettings"`, applica sul DB `any_stock_test` a `localhost:5433`, rigenera il client.

- [ ] **Step 3: Aggiornare `resetDb()`** — in `tests/helpers/db.ts`, prima di `await prisma.scanResult.deleteMany()` aggiungere:

```ts
  await prisma.scanAlert.deleteMany()
  await prisma.scannerAlertSettings.deleteMany()
```

- [ ] **Step 4: Verificare**

Run: `npx tsc --noEmit && npx vitest run tests/helpers/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.ts
git commit -m "feat: add scan alert tables"
```

---

### Task 4: Logica pura degli avvisi e costruzione dell'email

**Files:**
- Create: `lib/scan-alerts.ts`
- Test: `tests/lib/scan-alerts.test.ts`

**Interfaces:**
- Consumes (Task 2): `ScanRow`, `VERDICT`, `MARKET_TEXT`, `fmtNum`, `fmtPrice`, `sentence`, `planFor`; da `lib/scanner.ts`: `TradePlan`, `PlanNote`, `MarketLevel`.
- Produces (da `lib/scan-alerts.ts`):
  - `collectAlerts(input: { full: string[]; armed: string[]; newEntrantsOn: boolean; knownFull: string[] }): { watched: string[]; entrants: string[] }`
  - `interface EmailItem { row: ScanRow; plan: TradePlan; note: PlanNote; reason: 'watched' | 'new' }`
  - `interface EmailInput { items: EmailItem[]; market: { abovePct: number; level: MarketLevel } | null; sessionScan: boolean; appUrl: string | null }`
  - `buildScanEmail(input: EmailInput): { subject: string; text: string; html: string }`
  - `escapeHtml(value: string): string`

- [ ] **Step 1: Write the failing test** — crea `tests/lib/scan-alerts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildScanEmail, collectAlerts, escapeHtml, type EmailInput, type EmailItem } from '@/lib/scan-alerts'
import { planFor, type ScanRow } from '@/lib/scan-verdict'
import type { PlanContext } from '@/lib/scanner'

const row = (over: Partial<ScanRow> = {}): ScanRow => ({
  symbol: 'AAA', name: 'Alpha', sector: 'Tech', price: 102, rs: 90, passedCount: 8, vcpStatus: 'breakout', pivot: 100, pivotDistancePct: 2, volumeRatio: 1.8, missing: null, ...over,
})
const NO_CTX: PlanContext = { caution: null, market: null }
const item = (over: Partial<ScanRow> = {}, reason: EmailItem['reason'] = 'watched', ctx: PlanContext = NO_CTX): EmailItem => {
  const r = row(over)
  return { row: r, ...planFor(r, ctx), reason }
}
const input = (items: EmailItem[], over: Partial<EmailInput> = {}): EmailInput => ({ items, market: null, sessionScan: false, appUrl: null, ...over })

describe('collectAlerts', () => {
  it('watches the armed stocks that reached 8 of 8, ignoring the others', () => {
    expect(collectAlerts({ full: ['AAA', 'BBB'], armed: ['AAA', 'CCC'], newEntrantsOn: false, knownFull: [] })).toEqual({ watched: ['AAA'], entrants: [] })
  })

  it('adds the new 8-of-8 stocks only when the switch is on', () => {
    const base = { full: ['AAA', 'BBB', 'CCC'], armed: [], knownFull: ['AAA'] }
    expect(collectAlerts({ ...base, newEntrantsOn: false }).entrants).toEqual([])
    expect(collectAlerts({ ...base, newEntrantsOn: true }).entrants).toEqual(['BBB', 'CCC'])
  })

  it('never lists a stock twice: a watched stock is not also a new entrant', () => {
    expect(collectAlerts({ full: ['AAA', 'BBB'], armed: ['BBB'], newEntrantsOn: true, knownFull: [] })).toEqual({ watched: ['BBB'], entrants: ['AAA'] })
  })

  it('says nothing when there is nothing new', () => {
    expect(collectAlerts({ full: [], armed: ['AAA'], newEntrantsOn: true, knownFull: [] })).toEqual({ watched: [], entrants: [] })
  })
})

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;')
  })
})

describe('buildScanEmail subject', () => {
  it('names the stock when there is one', () => {
    expect(buildScanEmail(input([item()])).subject).toBe('Scanner Minervini: AAA ha raggiunto 8 su 8')
  })

  it('counts and lists the stocks, strongest relative strength first', () => {
    const { subject } = buildScanEmail(input([item({ symbol: 'LOW', rs: 75 }), item({ symbol: 'TOP', rs: 99 })]))
    expect(subject).toBe('Scanner Minervini: 2 titoli hanno raggiunto 8 su 8 (TOP, LOW)')
  })
})

describe('buildScanEmail content', () => {
  it('writes buy range, stop and profit zone on separate lines, with the maximum loss', () => {
    const { text } = buildScanEmail(input([item()]))
    expect(text).toContain('Cosa fare: Si può comprare')
    expect(text).toContain('Compra: tra 100,00 e 105,00')
    expect(text).toContain('Vendi sotto: 93,84 (perdita massima circa 8,0%)')
    expect(text).toContain('Profitto: verso 122,40–127,50')
  })

  it('says "sopra" for a stock still below its pivot', () => {
    const { text } = buildScanEmail(input([item({ vcpStatus: 'forming', price: 96, pivotDistancePct: -4, volumeRatio: 1 })]))
    expect(text).toContain('Cosa fare: Da tenere d’occhio')
    expect(text).toContain('Compra: sopra 100,00')
  })

  it('says there are no prices when there is nothing to buy', () => {
    const { text, html } = buildScanEmail(input([item({ vcpStatus: null, pivot: null, pivotDistancePct: null })]))
    expect(text).toContain('Prezzi: nessuno')
    expect(html).toContain('Nessun punto d’ingresso')
    expect(text).not.toContain('Vendi sotto')
  })

  it('shows relative strength, pivot with distance and volume against the average', () => {
    const { text } = buildScanEmail(input([item()]))
    expect(text).toContain('Forza relativa: 90')
    expect(text).toContain('Pivot: 100,00, 2,0% sopra')
    expect(text).toContain('Volume: +80% sulla media')
  })

  it('names why each stock is in the email', () => {
    const { text } = buildScanEmail(input([item({ symbol: 'AAA', rs: 99 }, 'watched'), item({ symbol: 'BBB', rs: 80 }, 'new')]))
    expect(text).toContain('Motivo: Lo seguivi')
    expect(text).toContain('Motivo: Nuovo negli 8 su 8')
  })

  it('opens with the health of the market and the partial-volume warning', () => {
    const { text } = buildScanEmail(input([item()], { market: { abovePct: 35, level: 'weak' }, sessionScan: true }))
    expect(text).toContain('Mercato debole: solo 35% dei titoli')
    expect(text).toContain('mercato aperto')
  })

  it('links to the stock page when APP_URL is known, tolerating a trailing slash', () => {
    const { text, html } = buildScanEmail(input([item({ symbol: 'BRK.B' })], { appUrl: 'https://app.example.com/' }))
    expect(text).toContain('Scheda: https://app.example.com/stock/BRK.B')
    expect(html).toContain('href="https://app.example.com/stock/BRK.B"')
  })

  it('has no link when APP_URL is unknown', () => {
    const { text, html } = buildScanEmail(input([item()]))
    expect(text).not.toContain('Scheda:')
    expect(html).not.toContain('href=')
  })

  it('ends with the disclaimer in both formats', () => {
    const { text, html } = buildScanEmail(input([item()]))
    expect(text).toContain('non è consulenza finanziaria')
    expect(html).toContain('non è consulenza finanziaria')
  })

  it('is a narrow html document with inline styles', () => {
    const { html } = buildScanEmail(input([item()]))
    expect(html).toContain('max-width:600px')
    expect(html).toContain('Si può comprare')
  })
})

describe('buildScanEmail escaping', () => {
  it('escapes company data in the html and leaves the plain text untouched', () => {
    const evil = { name: '<b>Evil</b> & "Co"', sector: 'A<B' }
    const { html, text } = buildScanEmail(input([item(evil)]))
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; &quot;Co&quot;')
    expect(html).toContain('A&lt;B')
    expect(html).not.toContain('<b>Evil')
    expect(text).toContain('<b>Evil</b> & "Co"')
  })

  it('escapes a hostile link base', () => {
    const { html } = buildScanEmail(input([item()], { appUrl: 'https://x.test/"><script>' }))
    expect(html).not.toContain('<script>')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/scan-alerts.test.ts`
Expected: FAIL (modulo `@/lib/scan-alerts` non esiste).

- [ ] **Step 3: Write minimal implementation** — crea `lib/scan-alerts.ts`:

```ts
import { MARKET_TEXT, VERDICT, fmtNum, fmtPrice, sentence, type ScanRow } from '@/lib/scan-verdict'
import type { MarketLevel, PlanNote, TradePlan } from '@/lib/scanner'

// Which stocks an email is about: the armed ones that reached 8 of 8, plus (switch on) the 8-of-8 ones not seen before.
export function collectAlerts(input: { full: string[]; armed: string[]; newEntrantsOn: boolean; knownFull: string[] }): { watched: string[]; entrants: string[] } {
  const full = new Set(input.full)
  const watched = [...new Set(input.armed)].filter((symbol) => full.has(symbol))
  const taken = new Set([...watched, ...input.knownFull])
  const entrants = input.newEntrantsOn ? input.full.filter((symbol) => !taken.has(symbol)) : []
  return { watched, entrants }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export interface EmailItem {
  row: ScanRow
  plan: TradePlan
  note: PlanNote
  reason: 'watched' | 'new'
}

export interface EmailInput {
  items: EmailItem[]
  market: { abovePct: number; level: MarketLevel } | null
  sessionScan: boolean
  appUrl: string | null
}

const REASON = { watched: 'Lo seguivi', new: 'Nuovo negli 8 su 8' } as const
const DISCLAIMER = 'Indicazioni calcolate con le regole del metodo: non è consulenza finanziaria.'
const SESSION_WARNING = 'Scansione fatta a mercato aperto: il volume di oggi è parziale, quindi nessun titolo è segnalato come da comprare.'
const NO_PRICES = 'Prezzi: nessuno, al momento non c’è un punto d’ingresso.'

// Same colours as the chips on the page, tuned for a white background.
const TONES: Record<'buy' | 'gain' | 'warn' | 'loss' | 'muted', { bg: string; fg: string }> = {
  buy: { bg: '#0f9d58', fg: '#ffffff' },
  gain: { bg: '#e6f4ea', fg: '#137333' },
  warn: { bg: '#fef3c7', fg: '#92400e' },
  loss: { bg: '#fce8e6', fg: '#b3261e' },
  muted: { bg: '#eceff1', fg: '#455a64' },
}

interface Line {
  label: string
  value: string
  note?: string
}

function priceLines(plan: TradePlan): Line[] {
  const { buyFrom, buyTo, stop, riskPct, profitFrom, profitTo } = plan
  if (buyFrom === null || buyTo === null || stop === null || profitFrom === null || profitTo === null) return []
  return [
    { label: 'Compra', value: plan.verdict === 'watch' ? `sopra ${fmtPrice(buyFrom)}` : `tra ${fmtPrice(buyFrom)} e ${fmtPrice(buyTo)}` },
    { label: 'Vendi sotto', value: fmtPrice(stop), note: riskPct === null ? undefined : `perdita massima circa ${fmtNum(riskPct)}%` },
    { label: 'Profitto', value: `verso ${fmtPrice(profitFrom)}–${fmtPrice(profitTo)}` },
  ]
}

function detailLines(row: ScanRow): Line[] {
  const lines: Line[] = [{ label: 'Forza relativa', value: row.rs === null ? '—' : String(Math.round(row.rs)) }]
  if (row.pivot !== null && row.pivotDistancePct !== null) {
    lines.push({ label: 'Pivot', value: `${fmtPrice(row.pivot)}, ${fmtNum(Math.abs(row.pivotDistancePct))}% ${row.pivotDistancePct >= 0 ? 'sopra' : 'sotto'}` })
  }
  if (row.volumeRatio !== null) {
    lines.push({ label: 'Volume', value: `${row.volumeRatio >= 1 ? '+' : '−'}${Math.round(Math.abs(row.volumeRatio - 1) * 100)}% sulla media` })
  }
  return lines
}

const linkFor = (appUrl: string | null, symbol: string) => (appUrl ? `${appUrl.replace(/\/+$/, '')}/stock/${encodeURIComponent(symbol)}` : null)
const headline = ({ row }: EmailItem) => `${row.symbol} - ${row.name}${row.sector ? ` (${row.sector})` : ''}, prezzo ${fmtPrice(row.price)}`

function itemText(item: EmailItem, appUrl: string | null): string {
  const { row, plan, note, reason } = item
  const lines = [headline(item), `Motivo: ${REASON[reason]}`, `Cosa fare: ${VERDICT[plan.verdict].label}`, sentence(row, plan, note)]
  const prices = priceLines(plan)
  if (prices.length === 0) lines.push(NO_PRICES)
  for (const p of prices) lines.push(`${p.label}: ${p.value}${p.note ? ` (${p.note})` : ''}`)
  for (const d of detailLines(row)) lines.push(`${d.label}: ${d.value}`)
  const link = linkFor(appUrl, row.symbol)
  if (link) lines.push(`Scheda: ${link}`)
  return lines.join('\n')
}

const e = escapeHtml

function itemHtml(item: EmailItem, appUrl: string | null): string {
  const { row, plan, note, reason } = item
  const verdict = VERDICT[plan.verdict]
  const tone = TONES[verdict.tone]
  const prices = priceLines(plan)
  const priceRows =
    prices.length === 0
      ? `<p style="margin:0 0 10px;color:#5f6368;font-size:14px">Al momento non c’è un punto d’ingresso.</p>`
      : `<table role="presentation" style="border-collapse:collapse;margin:0 0 10px">${prices
          .map(
            (p) =>
              `<tr><td style="padding:2px 14px 2px 0;color:#5f6368;font-size:13px">${e(p.label)}</td><td style="padding:2px 0;font-size:15px;font-weight:600">${e(p.value)}${
                p.note ? ` <span style="font-weight:400;color:#5f6368;font-size:13px">(${e(p.note)})</span>` : ''
              }</td></tr>`,
          )
          .join('')}</table>`
  const details = detailLines(row)
    .map((d) => `<span style="white-space:nowrap">${e(d.label)}: <strong>${e(d.value)}</strong></span>`)
    .join(' &middot; ')
  const link = linkFor(appUrl, row.symbol)
  return `<div style="border:1px solid #e2e5e9;border-radius:12px;padding:16px;margin:0 0 16px">
<p style="margin:0 0 2px;font-size:18px;font-weight:700">${e(row.symbol)} <span style="font-weight:400;color:#5f6368;font-size:14px">${e(row.name)}${row.sector ? ` &middot; ${e(row.sector)}` : ''}</span></p>
<p style="margin:0 0 10px;color:#5f6368;font-size:13px">Prezzo ${e(fmtPrice(row.price))} &middot; ${e(REASON[reason])}</p>
<p style="margin:0 0 8px"><span style="display:inline-block;padding:3px 12px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-size:14px;font-weight:700">${e(verdict.label)}</span></p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${e(sentence(row, plan, note))}</p>
${priceRows}
<p style="margin:0 0 ${link ? '10px' : '0'};color:#3c4043;font-size:13px;line-height:1.6">${details}</p>
${link ? `<p style="margin:0"><a href="${e(link)}" style="color:#0b57d0;font-size:14px">Apri la scheda di ${e(row.symbol)}</a></p>` : ''}
</div>`
}

function subjectFor(items: EmailItem[]): string {
  const symbols = items.map((i) => i.row.symbol)
  return items.length === 1 ? `Scanner Minervini: ${symbols[0]} ha raggiunto 8 su 8` : `Scanner Minervini: ${items.length} titoli hanno raggiunto 8 su 8 (${symbols.join(', ')})`
}

export function buildScanEmail(input: EmailInput): { subject: string; text: string; html: string } {
  const items = [...input.items].sort((a, b) => (b.row.rs ?? -1) - (a.row.rs ?? -1))
  const marketLine = input.market ? MARKET_TEXT[input.market.level](input.market.abovePct) : null
  const intro = [marketLine, input.sessionScan ? SESSION_WARNING : null].filter((l): l is string => l !== null)

  const text = [...(intro.length > 0 ? [intro.join('\n'), ''] : []), items.map((i) => itemText(i, input.appUrl)).join('\n\n'), '', DISCLAIMER].join('\n')

  const introHtml = intro.map((l) => `<p style="margin:0 0 10px;color:#5f6368;font-size:14px">${e(l)}</p>`).join('')
  const html = `<!doctype html><html lang="it"><body style="margin:0;padding:16px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#202124">
<div style="max-width:600px;margin:0 auto">
<h1 style="margin:0 0 12px;font-size:18px">${e(subjectFor(items))}</h1>
${introHtml}
${items.map((i) => itemHtml(i, input.appUrl)).join('\n')}
<p style="margin:0;color:#5f6368;font-size:12px">${e(DISCLAIMER)}</p>
</div></body></html>`

  return { subject: subjectFor(items), text, html }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/scan-alerts.test.ts && npx tsc --noEmit`
Expected: PASS. Se un test sui prezzi fallisce per arrotondamento (es. `122,40`), verificare prima il valore di `tradePlan` e non cambiare il test.

- [ ] **Step 5: Commit**

```bash
git add lib/scan-alerts.ts tests/lib/scan-alerts.test.ts
git commit -m "feat: build the scanner alert email"
```

---

### Task 5: Invio alla chiusura della scansione (`lib/scan-alerts-db.ts`)

**Files:**
- Create: `lib/scan-alerts-db.ts`
- Modify: `lib/scanner-run.ts` (in `closeRun`)
- Test: `tests/lib/scan-alerts-db.test.ts`

**Interfaces:**
- Consumes: `collectAlerts`, `buildScanEmail`, `EmailItem` (Task 4); `toScanRow`, `planFor`, `duringSession` (Task 2); `marketHealth`, `PlanContext` da `lib/scanner.ts`; `sendEmail` da `lib/notify.ts`; modelli `ScanAlert`, `ScannerAlertSettings` (Task 3).
- Produces (da `lib/scan-alerts-db.ts`):
  - `notifyScanAlerts(runId: string): Promise<'sent' | 'nothing' | 'failed'>` (non lancia mai)
  - `armAlert(symbol: string): Promise<'ok' | 'unknown-symbol'>`
  - `disarmAlert(symbol: string): Promise<void>`
  - `setNewEntrants(on: boolean): Promise<void>`
  - `getAlertState(): Promise<{ armed: string[]; newEntrants: boolean }>`

- [ ] **Step 1: Write the failing test** — crea `tests/lib/scan-alerts-db.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify', () => ({ sendEmail: vi.fn(), emailConfigured: vi.fn() }))

import { prisma } from '@/lib/db'
import type { Bar } from '@/lib/history'
import { sendEmail } from '@/lib/notify'
import { getAlertState, notifyScanAlerts } from '@/lib/scan-alerts-db'
import { startRun, stepRun } from '@/lib/scanner-run'
import { resetDb } from '../helpers/db'

const send = vi.mocked(sendEmail)
const DAY = 86_400_000
const CRITERIA = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, label: `c${i + 1}`, ok: true, value: '', margin: null }))

async function makeRun(rows: Array<{ symbol: string; passedCount: number; rs?: number; name?: string }>, startedAt = new Date('2026-11-16T22:00:00Z')) {
  const run = await prisma.scanRun.create({
    data: { status: 'done', total: rows.length, cursor: rows.length, startedAt, finishedAt: new Date(startedAt.getTime() + 120_000) },
  })
  await prisma.scanResult.createMany({
    data: rows.map((r) => ({
      runId: run.id, symbol: r.symbol, name: r.name ?? `${r.symbol} Inc`, sector: 'Tech', status: 'ok', price: 102, weightedReturn: 0.5,
      criteria: CRITERIA, rs: r.rs ?? 90, passedCount: r.passedCount, vcpStatus: 'breakout', pivot: 100, pivotDistancePct: 2, volumeRatio: 1.8,
    })),
  })
  return run
}

describe('notifyScanAlerts', () => {
  beforeEach(async () => {
    await resetDb()
    send.mockReset()
    send.mockResolvedValue(true)
  })

  it('sends one email for an armed stock that reached 8 of 8, then marks it as notified', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'AAA' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }, { symbol: 'BBB', passedCount: 7 }])

    expect(await notifyScanAlerts(run.id)).toBe('sent')

    expect(send).toHaveBeenCalledTimes(1)
    const [subject, text, html] = send.mock.calls[0]
    expect(subject).toContain('AAA')
    expect(subject).not.toContain('BBB')
    expect(text).toContain('Lo seguivi')
    expect(html).toContain('<html')
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { symbol: 'AAA' } })).notifiedAt).not.toBeNull()
  })

  it('stays silent for an armed stock that is still at 7 of 8', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'BBB' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }, { symbol: 'BBB', passedCount: 7 }])

    expect(await notifyScanAlerts(run.id)).toBe('nothing')
    expect(send).not.toHaveBeenCalled()
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { symbol: 'BBB' } })).notifiedAt).toBeNull()
  })

  it('does not notify a stock twice', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'AAA', notifiedAt: new Date() } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }])

    expect(await notifyScanAlerts(run.id)).toBe('nothing')
    expect(send).not.toHaveBeenCalled()
  })

  it('marks nothing and retries on the next scan when the email fails', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'AAA' } })
    await prisma.scannerAlertSettings.create({ data: { id: 'default', newEntrants: true, knownFull: [] } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }])
    send.mockResolvedValueOnce(false)

    expect(await notifyScanAlerts(run.id)).toBe('failed')
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { symbol: 'AAA' } })).notifiedAt).toBeNull()
    expect((await prisma.scannerAlertSettings.findUniqueOrThrow({ where: { id: 'default' } })).knownFull).toEqual([])

    expect(await notifyScanAlerts(run.id)).toBe('sent')
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { symbol: 'AAA' } })).notifiedAt).not.toBeNull()
  })

  it('never throws, even when sending throws', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'AAA' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }])
    send.mockRejectedValueOnce(new Error('boom'))

    expect(await notifyScanAlerts(run.id)).toBe('failed')
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { symbol: 'AAA' } })).notifiedAt).toBeNull()
  })

  it('does nothing for an unknown run or one still running', async () => {
    expect(await notifyScanAlerts('nope')).toBe('nothing')
    const running = await prisma.scanRun.create({ data: { status: 'running', total: 1 } })
    expect(await notifyScanAlerts(running.id)).toBe('nothing')
    expect(send).not.toHaveBeenCalled()
  })

  it('with the switch on, lists only the 8-of-8 stocks it had not seen and remembers all of them', async () => {
    await prisma.scannerAlertSettings.create({ data: { id: 'default', newEntrants: true, knownFull: ['OLD'] } })
    const run = await makeRun([{ symbol: 'OLD', passedCount: 8 }, { symbol: 'NEW', passedCount: 8 }])

    expect(await notifyScanAlerts(run.id)).toBe('sent')

    const [subject, text] = send.mock.calls[0]
    expect(subject).toContain('NEW')
    expect(subject).not.toContain('OLD')
    expect(text).toContain('Nuovo negli 8 su 8')
    expect((await prisma.scannerAlertSettings.findUniqueOrThrow({ where: { id: 'default' } })).knownFull.sort()).toEqual(['NEW', 'OLD'])
  })

  it('with the switch off, new 8-of-8 stocks do not trigger anything and knownFull is left alone', async () => {
    await prisma.scannerAlertSettings.create({ data: { id: 'default', newEntrants: false, knownFull: [] } })
    const run = await makeRun([{ symbol: 'NEW', passedCount: 8 }])

    expect(await notifyScanAlerts(run.id)).toBe('nothing')
    expect(send).not.toHaveBeenCalled()
    expect((await prisma.scannerAlertSettings.findUniqueOrThrow({ where: { id: 'default' } })).knownFull).toEqual([])
  })

  it('puts watched and new stocks in one single email', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'AAA' } })
    await prisma.scannerAlertSettings.create({ data: { id: 'default', newEntrants: true, knownFull: [] } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8, rs: 99 }, { symbol: 'BBB', passedCount: 8, rs: 80 }])

    await notifyScanAlerts(run.id)

    expect(send).toHaveBeenCalledTimes(1)
    const text = send.mock.calls[0][1]
    expect(text).toContain('Lo seguivi')
    expect(text).toContain('Nuovo negli 8 su 8')
  })

  it('downgrades a buy to "wait for confirmation" when the scan ran with the US market open', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'AAA' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }], new Date('2026-11-16T15:00:00Z'))

    await notifyScanAlerts(run.id)

    const text = send.mock.calls[0][1]
    expect(text).toContain('Cosa fare: Aspetta conferma')
    expect(text).toContain('mercato aperto')
  })

  it('links to the stock page when APP_URL is set', async () => {
    vi.stubEnv('APP_URL', 'https://app.example.com')
    await prisma.scanAlert.create({ data: { symbol: 'AAA' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }])

    await notifyScanAlerts(run.id)

    expect(send.mock.calls[0][1]).toContain('https://app.example.com/stock/AAA')
    vi.unstubAllEnvs()
  })
})

describe('closing a scan sends the alerts', () => {
  beforeEach(async () => {
    await resetDb()
    send.mockReset()
    send.mockResolvedValue(true)
  })

  const uptrend = (slope: number): Bar[] =>
    Array.from({ length: 300 }, (_, i) => {
      const close = 100 + i * slope
      return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
    })
  const universe = Array.from({ length: 8 }, (_, i) => ({ symbol: `S${i}`, name: `Stock ${i}`, sector: 'Tech' }))
  const fetchBars = async (symbol: string) => uptrend(0.1 + Number(symbol.slice(1)) * 0.1)

  it('sends one email when a real scan closes with an armed stock at 8 of 8', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'S7' } })
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')

    await stepRun(started.run.id, { universe, fetchBars })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toContain('S7')
  })

  it('sends one email, not two, when two steps race on the last block', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'S7' } })
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')

    await Promise.all([stepRun(started.run.id, { universe, fetchBars }), stepRun(started.run.id, { universe, fetchBars })])

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('still closes the scan when the email cannot be sent', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'S7' } })
    send.mockRejectedValue(new Error('smtp down'))
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')

    const step = await stepRun(started.run.id, { universe, fetchBars })

    expect(step).toMatchObject({ kind: 'advanced', run: { status: 'done' } })
  })
})

describe('getAlertState', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('lists only the armed stocks that have not notified yet, and the switch', async () => {
    await prisma.scanAlert.createMany({ data: [{ symbol: 'AAA' }, { symbol: 'BBB', notifiedAt: new Date() }] })
    expect(await getAlertState()).toEqual({ armed: ['AAA'], newEntrants: false })
    await prisma.scannerAlertSettings.create({ data: { id: 'default', newEntrants: true, knownFull: [] } })
    expect(await getAlertState()).toEqual({ armed: ['AAA'], newEntrants: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/scan-alerts-db.test.ts`
Expected: FAIL (modulo `@/lib/scan-alerts-db` non esiste).

- [ ] **Step 3: Write minimal implementation** — crea `lib/scan-alerts-db.ts`:

```ts
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
```

- [ ] **Step 4: Aggancio in `closeRun`** — in `lib/scanner-run.ts` aggiungere l'import `import { notifyScanAlerts } from '@/lib/scan-alerts-db'` accanto agli altri e, in fondo a `closeRun`, dopo la riga `if (old.length > 0) await prisma.scanRun.deleteMany(...)`, aggiungere:

```ts
  // Only the caller that won the close sends the alerts, so two racing steps never send two emails.
  await notifyScanAlerts(runId)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/scan-alerts-db.test.ts tests/lib/scanner-run.test.ts tests/api/scanner.test.ts && npx tsc --noEmit`
Expected: PASS. I test esistenti di `scanner-run` restano verdi: senza avvisi armati e senza impostazioni `notifyScanAlerts` restituisce `'nothing'` e non invia nulla. Se `S7` non risulta 8 su 8 nel test "real scan", controllare `passedCount` di `S7` in DB prima di cambiare la serie: con pendenza 0,8 devono passare tutti i criteri e la RS è 100.

- [ ] **Step 6: Commit**

```bash
git add lib/scan-alerts-db.ts lib/scanner-run.ts tests/lib/scan-alerts-db.test.ts
git commit -m "feat: email the scan alerts when a scan closes"
```

---

### Task 6: Route API degli avvisi

**Files:**
- Create: `app/api/scanner/alerts/[symbol]/route.ts`
- Create: `app/api/scanner/alerts/settings/route.ts`
- Test: `tests/api/scanner-alerts.test.ts`

**Interfaces:**
- Consumes (Task 5): `armAlert`, `disarmAlert`, `setNewEntrants`.
- Produces:
  - `POST /api/scanner/alerts/[symbol]` → 200 `{ symbol, armed: true }`; 400 se il simbolo non è valido (`/^[A-Z0-9.-]{1,10}$/` dopo maiuscolo e trim); 404 `{ error }` se non è nell'ultima scansione completa.
  - `DELETE /api/scanner/alerts/[symbol]` → 200 `{ symbol, armed: false }` (anche se non esisteva); 400 per simbolo non valido.
  - `PUT /api/scanner/alerts/settings` con `{ newEntrants: boolean }` → 200 `{ newEntrants }`; 400 se il corpo non è JSON o `newEntrants` non è booleano.

- [ ] **Step 1: Write the failing test** — crea `tests/api/scanner-alerts.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { DELETE, POST } from '@/app/api/scanner/alerts/[symbol]/route'
import { PUT } from '@/app/api/scanner/alerts/settings/route'

const ctx = (symbol: string) => ({ params: Promise.resolve({ symbol }) })
const req = (method: string, body?: string) => new Request('http://localhost/api/scanner/alerts/x', { method, body })

async function makeRun(rows: Array<{ symbol: string; passedCount: number; status?: string }>) {
  const run = await prisma.scanRun.create({ data: { status: 'done', total: rows.length, cursor: rows.length, finishedAt: new Date() } })
  await prisma.scanResult.createMany({
    data: rows.map((r) => ({ runId: run.id, symbol: r.symbol, name: r.symbol, status: r.status ?? 'ok', passedCount: r.passedCount })),
  })
  return run
}

describe('scanner alerts API: arm and disarm', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('POST arms a stock found in the last complete scan', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 7 }])
    const res = await POST(req('POST'), ctx('AAA'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ symbol: 'AAA', armed: true })
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { symbol: 'AAA' } })).notifiedAt).toBeNull()
  })

  it('POST normalises the symbol to upper case', async () => {
    await makeRun([{ symbol: 'BRK.B', passedCount: 7 }])
    expect((await POST(req('POST'), ctx(' brk.b '))).status).toBe(200)
    expect(await prisma.scanAlert.count({ where: { symbol: 'BRK.B' } })).toBe(1)
  })

  it('POST answers 404 for a symbol the last scan does not know, creating nothing', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 7 }])
    expect((await POST(req('POST'), ctx('ZZZ'))).status).toBe(404)
    expect(await prisma.scanAlert.count()).toBe(0)
  })

  it('POST answers 404 for a stock the scan could not read', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 7, status: 'unread' }])
    expect((await POST(req('POST'), ctx('AAA'))).status).toBe(404)
    expect(await prisma.scanAlert.count()).toBe(0)
  })

  it('POST answers 404 when no scan has been completed yet', async () => {
    expect((await POST(req('POST'), ctx('AAA'))).status).toBe(404)
    expect(await prisma.scanAlert.count()).toBe(0)
  })

  it('POST answers 400 for a malformed symbol', async () => {
    expect((await POST(req('POST'), ctx('bad symbol!'))).status).toBe(400)
    expect((await POST(req('POST'), ctx('A'.repeat(11)))).status).toBe(400)
  })

  it('POST arms again a stock that already sent its email', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 7 }])
    await prisma.scanAlert.create({ data: { symbol: 'AAA', notifiedAt: new Date() } })
    await POST(req('POST'), ctx('AAA'))
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { symbol: 'AAA' } })).notifiedAt).toBeNull()
  })

  it('DELETE disarms, and is fine when nothing was armed', async () => {
    await prisma.scanAlert.create({ data: { symbol: 'AAA' } })
    const res = await DELETE(req('DELETE'), ctx('AAA'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ symbol: 'AAA', armed: false })
    expect(await prisma.scanAlert.count()).toBe(0)
    expect((await DELETE(req('DELETE'), ctx('AAA'))).status).toBe(200)
  })

  it('DELETE answers 400 for a malformed symbol', async () => {
    expect((await DELETE(req('DELETE'), ctx('no way'))).status).toBe(400)
  })
})

describe('scanner alerts API: settings', () => {
  beforeEach(async () => {
    await resetDb()
  })

  const put = (body: string) => PUT(new Request('http://localhost/api/scanner/alerts/settings', { method: 'PUT', body }))
  const settings = () => prisma.scannerAlertSettings.findUniqueOrThrow({ where: { id: 'default' } })

  it('turning the switch on remembers the stocks that are already 8 of 8', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 8 }, { symbol: 'BBB', passedCount: 7 }, { symbol: 'CCC', passedCount: 8 }])
    const res = await put('{"newEntrants":true}')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ newEntrants: true })
    const s = await settings()
    expect(s.newEntrants).toBe(true)
    expect([...s.knownFull].sort()).toEqual(['AAA', 'CCC'])
  })

  it('turning it on with no scan yet leaves knownFull empty', async () => {
    await put('{"newEntrants":true}')
    expect((await settings()).knownFull).toEqual([])
  })

  it('turning it on twice does not forget the pending new entrants', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 8 }])
    await put('{"newEntrants":true}')
    await prisma.scannerAlertSettings.update({ where: { id: 'default' }, data: { knownFull: ['X'] } })
    await put('{"newEntrants":true}')
    expect((await settings()).knownFull).toEqual(['X'])
  })

  it('turning it off keeps what it knew', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 8 }])
    await put('{"newEntrants":true}')
    await put('{"newEntrants":false}')
    const s = await settings()
    expect(s.newEntrants).toBe(false)
    expect(s.knownFull).toEqual(['AAA'])
  })

  it('answers 400 for an invalid body and changes nothing', async () => {
    expect((await put('{}')).status).toBe(400)
    expect((await put('{"newEntrants":"yes"}')).status).toBe(400)
    expect((await put('not json')).status).toBe(400)
    expect(await prisma.scannerAlertSettings.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/scanner-alerts.test.ts`
Expected: FAIL (route non esistono).

- [ ] **Step 3: Write minimal implementation**

`app/api/scanner/alerts/[symbol]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { armAlert, disarmAlert } from '@/lib/scan-alerts-db'

type Context = { params: Promise<{ symbol: string }> }

const VALID = /^[A-Z0-9.-]{1,10}$/

async function symbolOf({ params }: Context): Promise<string | null> {
  const symbol = decodeURIComponent((await params).symbol).trim().toUpperCase()
  return VALID.test(symbol) ? symbol : null
}

export async function POST(_request: Request, context: Context) {
  const symbol = await symbolOf(context)
  if (!symbol) return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  try {
    if ((await armAlert(symbol)) === 'unknown-symbol') return NextResponse.json({ error: 'Symbol not in the last scan' }, { status: 404 })
    return NextResponse.json({ symbol, armed: true })
  } catch (err) {
    console.error('Arming scan alert failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Could not arm the alert' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: Context) {
  const symbol = await symbolOf(context)
  if (!symbol) return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  try {
    await disarmAlert(symbol)
    return NextResponse.json({ symbol, armed: false })
  } catch (err) {
    console.error('Disarming scan alert failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Could not disarm the alert' }, { status: 500 })
  }
}
```

`app/api/scanner/alerts/settings/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { setNewEntrants } from '@/lib/scan-alerts-db'

export async function PUT(request: Request) {
  let newEntrants: unknown
  try {
    newEntrants = ((await request.json()) as { newEntrants?: unknown }).newEntrants
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof newEntrants !== 'boolean') return NextResponse.json({ error: 'newEntrants must be true or false' }, { status: 400 })
  try {
    await setNewEntrants(newEntrants)
    return NextResponse.json({ newEntrants })
  } catch (err) {
    console.error('Saving scan alert settings failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Could not save the setting' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/scanner-alerts.test.ts tests/api/scanner.test.ts && npx tsc --noEmit`
Expected: PASS. Se `next build` si lamenta della cartella `[symbol]` accanto a `settings`, verificare che la route statica `settings` abbia la precedenza (è il comportamento standard del router).

- [ ] **Step 5: Commit**

```bash
git add app/api/scanner/alerts tests/api/scanner-alerts.test.ts
git commit -m "feat: add scanner alert routes"
```

---

### Task 7: Busta, interruttore, tabella e pagina

**Files:**
- Create: `components/EnvelopeIcon.tsx`
- Create: `components/AlertBell.tsx`, `components/AlertBell.module.css`
- Create: `components/AlertSwitch.tsx`, `components/AlertSwitch.module.css`
- Modify: `components/ScannerTable.tsx`, `components/ScannerTable.module.css`
- Modify: `app/scanner/page.tsx`
- Test: `tests/components/AlertBell.test.tsx`, `tests/components/AlertSwitch.test.tsx` (nuovi); `tests/components/ScannerTable.test.tsx` (aggiungere in fondo)

**Interfaces:**
- Consumes: route del Task 6; `getAlertState` (Task 5); `emailConfigured` (Task 1); `toScanRow`, `duringSession`, `ScanRow` (Task 2).
- Produces:
  - `EMAIL_NOT_READY: string` (da `components/AlertBell.tsx`)
  - `AlertBell({ symbol, armed, emailReady }: { symbol: string; armed: boolean; emailReady: boolean })`
  - `AlertSwitch({ enabled, emailReady }: { enabled: boolean; emailReady: boolean })`
  - `ScannerTable` accetta `alerts?: { emailReady: boolean; armed: string[]; newEntrants: boolean }`; senza la prop non mostra né buste né interruttore.

- [ ] **Step 1: Write the failing tests**

`tests/components/AlertBell.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AlertBell, EMAIL_NOT_READY } from '@/components/AlertBell'

const ok = { ok: true, status: 200, json: () => Promise.resolve({}) }
const unarmed = () => screen.getByRole('button', { name: 'Avvisami per email quando AAA arriva a 8 su 8' })
const armedButton = () => screen.getByRole('button', { name: 'Avviso attivo per AAA, clicca per disattivarlo' })

describe('AlertBell', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('arms the alert and shows it as on', async () => {
    ;(fetch as any).mockResolvedValue(ok)
    render(<AlertBell symbol="AAA" armed={false} emailReady />)
    expect(unarmed()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(unarmed())
    expect(armedButton()).toHaveAttribute('aria-pressed', 'true')
    expect(fetch).toHaveBeenCalledWith('/api/scanner/alerts/AAA', { method: 'POST' })
  })

  it('disarms an armed alert', async () => {
    ;(fetch as any).mockResolvedValue(ok)
    render(<AlertBell symbol="AAA" armed emailReady />)
    fireEvent.click(armedButton())
    expect(unarmed()).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/scanner/alerts/AAA', { method: 'DELETE' })
  })

  it('goes back and says so when the server refuses', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    render(<AlertBell symbol="AAA" armed={false} emailReady />)
    fireEvent.click(unarmed())
    expect(await screen.findByRole('status')).toHaveTextContent(/non sono riuscito/i)
    expect(unarmed()).toHaveAttribute('aria-pressed', 'false')
  })

  it('goes back when the network fails', async () => {
    ;(fetch as any).mockRejectedValue(new Error('offline'))
    render(<AlertBell symbol="AAA" armed={false} emailReady />)
    fireEvent.click(unarmed())
    await waitFor(() => expect(unarmed()).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('lets the last click decide: a late failure of an old click does not undo it', async () => {
    let failFirst: (v: unknown) => void = () => {}
    ;(fetch as any)
      .mockImplementationOnce(() => new Promise((resolve) => { failFirst = resolve }))
      .mockResolvedValue(ok)
    render(<AlertBell symbol="AAA" armed={false} emailReady />)
    fireEvent.click(unarmed()) // arm, still pending
    fireEvent.click(armedButton()) // disarm
    fireEvent.click(unarmed()) // arm again
    expect(armedButton()).toBeInTheDocument()
    failFirst({ ok: false, status: 500, json: () => Promise.resolve({}) })
    await new Promise((r) => setTimeout(r, 0))
    expect(armedButton()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is disabled with the reason when email is not configured, and never calls the API', () => {
    render(<AlertBell symbol="AAA" armed={false} emailReady={false} />)
    expect(unarmed()).toBeDisabled()
    expect(unarmed()).toHaveAttribute('title', EMAIL_NOT_READY)
    fireEvent.click(unarmed())
    expect(fetch).not.toHaveBeenCalled()
  })
})
```

`tests/components/AlertSwitch.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AlertSwitch } from '@/components/AlertSwitch'
import { EMAIL_NOT_READY } from '@/components/AlertBell'

const ok = { ok: true, status: 200, json: () => Promise.resolve({}) }

describe('AlertSwitch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('is a switch labelled with what it does', () => {
    render(<AlertSwitch enabled={false} emailReady />)
    expect(screen.getByRole('switch', { name: /avvisami dei nuovi 8 su 8/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('turns on and saves the setting', async () => {
    ;(fetch as any).mockResolvedValue(ok)
    render(<AlertSwitch enabled={false} emailReady />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(fetch).toHaveBeenCalledWith('/api/scanner/alerts/settings', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ newEntrants: true }) }))
  })

  it('turns off when it was on', () => {
    ;(fetch as any).mockResolvedValue(ok)
    render(<AlertSwitch enabled emailReady />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(fetch).toHaveBeenCalledWith('/api/scanner/alerts/settings', expect.objectContaining({ body: JSON.stringify({ newEntrants: false }) }))
  })

  it('goes back and says so when the save fails', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    render(<AlertSwitch enabled={false} emailReady />)
    fireEvent.click(screen.getByRole('switch'))
    expect(await screen.findByRole('status')).toHaveTextContent(/non sono riuscito/i)
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'))
  })

  it('explains the evening scan in a tooltip', () => {
    render(<AlertSwitch enabled={false} emailReady />)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/ogni sera/i)
  })

  it('is disabled with the reason when email is not configured', () => {
    render(<AlertSwitch enabled={false} emailReady={false} />)
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('switch')).toHaveAttribute('title', EMAIL_NOT_READY)
  })
})
```

In coda a `tests/components/ScannerTable.test.tsx` aggiungere:

```tsx
describe('email alerts', () => {
  const alerts = { emailReady: true, armed: ['NEAR'], newEntrants: false }

  it('shows no bell and no switch without the alerts prop', () => {
    render(<ScannerTable rows={rows} />)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /avvisami|avviso attivo/i })).not.toBeInTheDocument()
  })

  it('puts a bell only on the 7-of-8 stocks, not on the ones that already made it', () => {
    render(<ScannerTable rows={rows} alerts={alerts} />)
    expect(screen.queryByRole('button', { name: /avvisami|avviso attivo/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /quasi/i }))
    expect(screen.getByRole('button', { name: 'Avviso attivo per NEAR, clicca per disattivarlo' })).toBeInTheDocument()
  })

  it('keeps the bell outside the link of the row', () => {
    render(<ScannerTable rows={rows} alerts={{ ...alerts, armed: [] }} />)
    fireEvent.click(screen.getByRole('button', { name: /quasi/i }))
    const bell = screen.getByRole('button', { name: 'Avvisami per email quando NEAR arriva a 8 su 8' })
    expect(bell.closest('a')).toBeNull()
    expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(1)
  })

  it('shows the switch with the saved state', () => {
    render(<ScannerTable rows={rows} alerts={{ ...alerts, newEntrants: true }} />)
    expect(screen.getByRole('switch', { name: /nuovi 8 su 8/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('disables bells and switch when email is not configured', () => {
    render(<ScannerTable rows={rows} alerts={{ emailReady: false, armed: [], newEntrants: false }} />)
    expect(screen.getByRole('switch')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /quasi/i }))
    expect(screen.getByRole('button', { name: /avvisami per email quando NEAR/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/AlertBell.test.tsx tests/components/AlertSwitch.test.tsx tests/components/ScannerTable.test.tsx`
Expected: FAIL (componenti mancanti; test "email alerts" rossi).

- [ ] **Step 3: Write the components**

`components/EnvelopeIcon.tsx`:

```tsx
export function EnvelopeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </svg>
  )
}
```

`components/AlertBell.tsx`:

```tsx
'use client'

import { useRef, useState } from 'react'
import { EnvelopeIcon } from '@/components/EnvelopeIcon'
import styles from './AlertBell.module.css'

export const EMAIL_NOT_READY = 'Per ricevere le email imposta ALERT_EMAIL_TO e SMTP_HOST (oppure RESEND_API_KEY).'

export function AlertBell({ symbol, armed: initial, emailReady }: { symbol: string; armed: boolean; emailReady: boolean }) {
  const [armed, setArmed] = useState(initial)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)

  async function toggle() {
    const next = !armed
    const mine = ++latest.current
    setArmed(next)
    setFailed(false)
    try {
      const res = await fetch(`/api/scanner/alerts/${encodeURIComponent(symbol)}`, { method: next ? 'POST' : 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      // Only the newest click may undo itself: an old request failing late must not overwrite a later choice.
      if (mine === latest.current) {
        setArmed(!next)
        setFailed(true)
      }
    }
  }

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.bell}
        aria-pressed={armed}
        aria-label={armed ? `Avviso attivo per ${symbol}, clicca per disattivarlo` : `Avvisami per email quando ${symbol} arriva a 8 su 8`}
        title={emailReady ? undefined : EMAIL_NOT_READY}
        disabled={!emailReady}
        onClick={toggle}
      >
        <EnvelopeIcon />
      </button>
      {failed && (
        <span role="status" className={styles.error}>
          Non sono riuscito ad aggiornare l’avviso.
        </span>
      )}
    </span>
  )
}
```

`components/AlertBell.module.css`:

```css
.wrap {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.bell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.bell:hover:not(:disabled) {
  color: var(--bone);
  border-color: var(--muted);
}

.bell[aria-pressed='true'] {
  border-color: var(--brass);
  background: var(--brass);
  color: var(--ink);
}

.bell:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.error {
  max-width: 11rem;
  color: var(--loss-bright);
  font-size: 12px;
  line-height: 1.4;
  text-align: right;
}
```

`components/AlertSwitch.tsx`:

```tsx
'use client'

import { useRef, useState } from 'react'
import { EMAIL_NOT_READY } from '@/components/AlertBell'
import { EnvelopeIcon } from '@/components/EnvelopeIcon'
import { InfoTip } from '@/components/InfoTip'
import styles from './AlertSwitch.module.css'

export function AlertSwitch({ enabled: initial, emailReady }: { enabled: boolean; emailReady: boolean }) {
  const [enabled, setEnabled] = useState(initial)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)

  async function toggle() {
    const next = !enabled
    const mine = ++latest.current
    setEnabled(next)
    setFailed(false)
    try {
      const res = await fetch('/api/scanner/alerts/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newEntrants: next }) })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      if (mine === latest.current) {
        setEnabled(!next)
        setFailed(true)
      }
    }
  }

  return (
    <span className={styles.wrap}>
      <button type="button" role="switch" aria-checked={enabled} className={styles.switch} title={emailReady ? undefined : EMAIL_NOT_READY} disabled={!emailReady} onClick={toggle}>
        <EnvelopeIcon />
        <span>Avvisami dei nuovi 8 su 8</span>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
      </button>
      <InfoTip label="Come funziona l’avviso sui nuovi 8 su 8" source="Scansione serale dell’app">
        Quando è attivo, ricevi una email con i titoli entrati negli 8 su 8 dall’ultima volta. La scansione parte da sola ogni sera dopo la chiusura del mercato USA; puoi sempre lanciarla a mano.
      </InfoTip>
      {failed && (
        <span role="status" className={styles.error}>
          Non sono riuscito a salvare l’impostazione.
        </span>
      )}
    </span>
  )
}
```

`components/AlertSwitch.module.css`:

```css
.wrap {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--muted);
  font-family: var(--font-ui);
  font-size: 13px;
  cursor: pointer;
}

.switch[aria-checked='true'] {
  border-color: var(--brass);
  color: var(--bone);
}

.switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.track {
  position: relative;
  width: 28px;
  height: 16px;
  border-radius: 999px;
  background: var(--rule);
}

.switch[aria-checked='true'] .track {
  background: var(--brass);
}

.thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--bone);
}

.switch[aria-checked='true'] .thumb {
  left: 14px;
  background: var(--ink);
}

.error {
  color: var(--loss-bright);
  font-size: 12px;
}
```

- [ ] **Step 4: Wire the table** — in `components/ScannerTable.tsx` applicare con Python:

```python
p='components/ScannerTable.tsx'
s=open(p).read()

# imports
old="import { InfoTip } from '@/components/InfoTip'\n"
assert old in s
s=s.replace(old,"import { AlertBell } from '@/components/AlertBell'\nimport { AlertSwitch } from '@/components/AlertSwitch'\nimport { InfoTip } from '@/components/InfoTip'\n",1)

# Row takes the bell and puts it outside the link
old="function Row({ item: { r, plan, note } }: { item: Item }) {"
assert old in s
s=s.replace(old,"function Row({ item: { r, plan, note }, bell }: { item: Item; bell: React.ReactNode }) {",1)
a=s.index("function Row(")
head,tail=s[:a],s[a:]
tail=tail.replace("    <li>\n      <Link","    <li className={styles.item} data-bell={bell ? '' : undefined}>\n      <Link",1)
tail=tail.replace("      </Link>\n    </li>","      </Link>\n      {bell && <span className={styles.bell}>{bell}</span>}\n    </li>",1)
s=head+tail

# props
old="  market = null,\n}: {\n  rows: ScannerRow[]\n  caution?: Caution | null\n  market?: { abovePct: number; level: MarketLevel } | null\n}) {"
assert old in s
s=s.replace(old,"  market = null,\n  alerts,\n}: {\n  rows: ScannerRow[]\n  caution?: Caution | null\n  market?: { abovePct: number; level: MarketLevel } | null\n  alerts?: { emailReady: boolean; armed: string[]; newEntrants: boolean }\n}) {",1)

# rows
old="{shown.map((item) => (\n              <Row key={item.r.symbol} item={item} />\n            ))}"
assert old in s
s=s.replace(old,"""{shown.map((item) => (
              <Row
                key={item.r.symbol}
                item={item}
                bell={alerts && item.r.passedCount === 7 ? <AlertBell symbol={item.r.symbol} armed={alerts.armed.includes(item.r.symbol)} emailReady={alerts.emailReady} /> : null}
              />
            ))}""",1)

# switch in the filters bar
old="        {filtersActive && (\n          <button type=\"button\" onClick={reset}"
assert old in s
s=s.replace(old,"        {alerts && <AlertSwitch enabled={alerts.newEntrants} emailReady={alerts.emailReady} />}\n"+old,1)
open(p,'w').write(s)

p='components/ScannerTable.module.css'
s=open(p).read()
s+='''
.item {
  position: relative;
}

.bell {
  position: absolute;
  top: 12px;
  right: 14px;
}

.item[data-bell] .row {
  padding-right: 64px;
}
'''
open(p,'w').write(s)
```

- [ ] **Step 5: Wire the page** — sostituire l'intero `app/scanner/page.tsx` con:

```tsx
import { Suspense } from 'react'
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { ScannerButton } from '@/components/ScannerButton'
import { ScannerInfo } from '@/components/ScannerInfo'
import { ScannerTable } from '@/components/ScannerTable'
import type { Criterion } from '@/lib/minervini'
import { emailConfigured } from '@/lib/notify'
import { getAlertState } from '@/lib/scan-alerts-db'
import { duringSession, toScanRow } from '@/lib/scan-verdict'
import { marketHealth } from '@/lib/scanner'
import { PARTIAL_UNREAD_SHARE, latestCompleteRun, runTiming, runningRun } from '@/lib/scanner-run'
import styles from '../section.module.css'
import local from './page.module.css'

const ROME = 'Europe/Rome'
const day = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ROME })
const time = (d: Date) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: ROME })

const ageText = (days: number) => (days === 1 ? 'di ieri' : `di ${days} giorni fa`)

async function ScannerContent() {
  await connection()
  const [run, running, alertState] = await Promise.all([latestCompleteRun(), runningRun(), getAlertState()])
  const { lockedUntil, ageDays } = runTiming(run?.finishedAt ?? null, new Date())
  const lockedLabel = lockedUntil && !running ? `Disponibile dalle ${time(lockedUntil)}` : null

  const readable = run ? await prisma.scanResult.findMany({ where: { runId: run.id, status: 'ok' } }) : []
  const rows = readable.filter((r) => (r.passedCount ?? 0) >= 7).map(toScanRow)
  const market = marketHealth(readable.map((r) => (Array.isArray(r.criteria) ? r.criteria : []) as unknown as Criterion[]))
  const session = run !== null && duringSession(run.startedAt, run.finishedAt)
  const caution = session ? 'session' : ageDays >= 1 ? 'stale' : null

  return (
    <>
      <ScannerInfo defaultOpen={!run} />
      <ScannerButton resumable={running !== null} lockedLabel={lockedLabel} />
      {!run || !run.finishedAt ? (
        <p className={styles.empty}>Nessuna scansione ancora eseguita. Premi “Avvia scansione” per iniziare.</p>
      ) : (
        <>
          <p className={local.meta}>
            Ultima scansione il {day(run.finishedAt)} alle {time(run.finishedAt)}. Letti {run.total - run.unreadCount} titoli su {run.total}.
          </p>
          {session && (
            <p role="note" className={local.stale}>
              Scansione fatta a mercato aperto: il volume di oggi è parziale, quindi nessun titolo è segnalato come da comprare. Rilancia dopo le 22:30 ora italiana.
            </p>
          )}
          {ageDays >= 1 && (
            <p role="note" className={local.stale}>
              Risultati {ageText(ageDays)}: i prezzi non sono aggiornati. Rilancia la scansione.
            </p>
          )}
          {run.unreadCount > run.total * PARTIAL_UNREAD_SHARE && (
            <p role="note" className={local.stale}>
              Dati parziali: troppi titoli non sono stati letti, quindi la forza relativa è meno affidabile.
            </p>
          )}
          <ScannerTable rows={rows} caution={caution} market={market} alerts={{ emailReady: emailConfigured(), ...alertState }} />
        </>
      )}
    </>
  )
}

export default function ScannerPage() {
  return (
    <main className={styles.shell}>
      <h1 className={local.heading}>Scanner Minervini</h1>
      <p className={local.lead}>Titoli dell’S&amp;P 500 che passano il Trend Template di Minervini, con lo stato della base e la distanza dal pivot.</p>
      <Suspense fallback={<p className={styles.empty}>Carico lo scanner…</p>}>
        <ScannerContent />
      </Suspense>
    </main>
  )
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/components && npx tsc --noEmit && npm run lint 2>&1 | grep -E "^/Volumes"`
Expected: PASS (tutti i test dei componenti), nessun errore di tipi; il lint elenca solo i due file già noti (`app/scopri/page.tsx`, `components/CandidateCard.tsx`).

- [ ] **Step 7: Commit**

```bash
git add components/EnvelopeIcon.tsx components/AlertBell.tsx components/AlertBell.module.css components/AlertSwitch.tsx components/AlertSwitch.module.css components/ScannerTable.tsx components/ScannerTable.module.css app/scanner/page.tsx tests/components/AlertBell.test.tsx tests/components/AlertSwitch.test.tsx tests/components/ScannerTable.test.tsx
git commit -m "feat: add email alert bell and switch to the scanner"
```

---

### Task 8: Skeleton di caricamento

**Files:**
- Create: `app/scanner/ScannerSkeleton.tsx`, `app/scanner/ScannerSkeleton.module.css`
- Modify: `app/scanner/page.tsx`
- Test: `tests/components/ScannerSkeleton.test.tsx`

**Interfaces:**
- Produces: `ScannerSkeleton(): JSX.Element` (`role="status"`, `aria-busy="true"`, testo per screen reader "Carico lo scanner…", decorazione `aria-hidden`).

- [ ] **Step 1: Write the failing test** — crea `tests/components/ScannerSkeleton.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScannerSkeleton } from '@/app/scanner/ScannerSkeleton'

describe('ScannerSkeleton', () => {
  it('announces the loading to screen readers', () => {
    render(<ScannerSkeleton />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent('Carico lo scanner…')
  })

  it('hides the decorative bars and has nothing to click or read', () => {
    const { container } = render(<ScannerSkeleton />)
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('draws five placeholder rows like the real list', () => {
    const { container } = render(<ScannerSkeleton />)
    expect(container.querySelectorAll('li')).toHaveLength(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ScannerSkeleton.test.tsx`
Expected: FAIL (componente non esiste).

- [ ] **Step 3: Write minimal implementation**

`app/scanner/ScannerSkeleton.tsx`:

```tsx
import styles from './ScannerSkeleton.module.css'

const ROWS = 5

// Same shape as the loaded page: button, last-scan line, filter bar and the list of stocks.
export function ScannerSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>Carico lo scanner…</span>
      <div aria-hidden="true">
        <span className={`${styles.bar} ${styles.button}`} />
        <span className={`${styles.bar} ${styles.meta}`} />
        <div className={styles.filters}>
          <span className={`${styles.bar} ${styles.seg}`} />
          <span className={`${styles.bar} ${styles.seg}`} />
          <span className={`${styles.bar} ${styles.field}`} />
          <span className={`${styles.bar} ${styles.field}`} />
          <span className={`${styles.bar} ${styles.pill}`} />
          <span className={`${styles.bar} ${styles.pill}`} />
        </div>
        <ul className={styles.list}>
          {Array.from({ length: ROWS }, (_, r) => (
            <li key={r} className={styles.row}>
              <span className={styles.who}>
                <span className={`${styles.bar} ${styles.symbol}`} />
                <span className={`${styles.bar} ${styles.sub}`} />
              </span>
              <span className={styles.action}>
                <span className={`${styles.bar} ${styles.chip}`} />
                <span className={`${styles.bar} ${styles.line}`} />
                <span className={`${styles.bar} ${styles.lineShort}`} />
              </span>
              <span className={styles.plan}>
                <span className={`${styles.bar} ${styles.line}`} />
                <span className={`${styles.bar} ${styles.line}`} />
                <span className={`${styles.bar} ${styles.line}`} />
              </span>
              <span className={`${styles.bar} ${styles.rs}`} />
              <span className={`${styles.bar} ${styles.gauge}`} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

`app/scanner/ScannerSkeleton.module.css`:

```css
.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.bar {
  display: block;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 55%, var(--rule)) 50%, var(--surface) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.6s ease-in-out infinite;
}

@keyframes shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bar {
    animation: none;
  }
}

.button {
  width: 170px;
  height: 44px;
  margin-bottom: 28px;
  border-radius: 999px;
}

.meta {
  width: min(420px, 80%);
  height: 14px;
  margin-bottom: 20px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 18px;
}

.seg {
  width: 120px;
  height: 40px;
  border-radius: 999px;
}

.field {
  width: 130px;
  height: 34px;
  border-radius: 10px;
}

.pill {
  width: 96px;
  height: 34px;
  border-radius: 999px;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  overflow: hidden;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1.7fr) minmax(0, 1.25fr) 6rem minmax(9.5rem, 1fr);
  align-items: start;
  gap: 8px 20px;
  padding: 16px 20px;
}

.row + .row {
  border-top: 1px solid var(--rule);
}

.who,
.action,
.plan {
  display: grid;
  gap: 8px;
}

.symbol {
  width: 70px;
  height: 18px;
}

.sub {
  width: 110px;
  height: 12px;
}

.chip {
  width: 130px;
  height: 22px;
  border-radius: 999px;
}

.line {
  width: 100%;
  height: 12px;
}

.lineShort {
  width: 60%;
  height: 12px;
}

.rs {
  width: 60px;
  height: 22px;
}

.gauge {
  width: 100%;
  height: 20px;
}

@media (max-width: 820px) {
  .row {
    grid-template-columns: 6rem minmax(0, 1fr);
    padding: 16px;
  }

  .who,
  .action,
  .plan {
    grid-column: 1 / -1;
  }
}
```

- [ ] **Step 4: Use it as the Suspense fallback** — in `app/scanner/page.tsx` aggiungere l'import `import { ScannerSkeleton } from './ScannerSkeleton'` (dopo `import local from './page.module.css'`) e sostituire `<Suspense fallback={<p className={styles.empty}>Carico lo scanner…</p>}>` con `<Suspense fallback={<ScannerSkeleton />}>`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/ScannerSkeleton.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/scanner/ScannerSkeleton.tsx app/scanner/ScannerSkeleton.module.css app/scanner/page.tsx tests/components/ScannerSkeleton.test.tsx
git commit -m "feat: show a skeleton while the scanner loads"
```

---

### Task 9: Scansione serale automatica (workflow GitHub Actions)

**Files:**
- Create: `.github/workflows/scanner.yml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: route `POST /api/scanner` (risposte 200 `{ runId, cursor, total, status, resumed }` o 429) e `POST /api/scanner/step` con `{ runId }` (200 `{ cursor, total, status, advanced }` o 409).
- Produces: workflow `scanner` con `schedule: '0 22 * * 1-5'` e `workflow_dispatch`; usa solo il secret `APP_URL`.

Questo task non ha test vitest: la verifica è `bash -n` sullo script estratto e una prova contro un server finto in locale.

- [ ] **Step 1: Write the workflow** — crea `.github/workflows/scanner.yml` (le righe dello script hanno 10 spazi di indentazione, necessari per l'estrazione al passo 2):

```yaml
# Evening scan of the S&P 500, after the US close, so the email alerts fire without anyone opening the app.
# Needs the repository secret APP_URL, already used by price-alerts and insider-digest.
name: scanner

on:
  schedule:
    # 22:00 UTC, Mon-Fri: after the US close in both summer (20:00 UTC) and winter (21:00 UTC) time
    - cron: '0 22 * * 1-5'
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Start the scan and run it to the end
        env:
          APP_URL: ${{ secrets.APP_URL }}
        run: |
          set -u
          BODY="$(mktemp)"

          # POST to the app, retrying network errors and 5xx up to 3 times. Prints the HTTP status; the answer is left in $BODY.
          post() {
            local path="$1" data="${2:-}" status attempt
            for attempt in 1 2 3; do
              if [ -n "$data" ]; then
                status=$(curl --silent --show-error --max-time 90 --output "$BODY" --write-out '%{http_code}' -X POST -H 'Content-Type: application/json' --data "$data" "$APP_URL$path")
              else
                status=$(curl --silent --show-error --max-time 90 --output "$BODY" --write-out '%{http_code}' -X POST "$APP_URL$path")
              fi
              case "$status" in
                5*|000) echo "Attempt $attempt on $path failed ($status)" >&2; sleep "${RETRY_SLEEP:-5}" ;;
                *) break ;;
              esac
            done
            echo "$status"
          }

          status=$(post /api/scanner)
          case "$status" in
            200) ;;
            429) echo "The last scan is too recent: nothing to do."; exit 0 ;;
            *) echo "Could not start the scan ($status):"; cat "$BODY"; exit 1 ;;
          esac

          run_id=$(jq -r '.runId' "$BODY")
          state=$(jq -r '.status' "$BODY")
          steps=0
          while [ "$state" = "running" ]; do
            steps=$((steps + 1))
            if [ "$steps" -gt 40 ]; then
              echo "The scan did not finish in 40 steps."
              exit 1
            fi
            status=$(post /api/scanner/step "{\"runId\":\"$run_id\"}")
            case "$status" in
              200) state=$(jq -r '.status' "$BODY"); echo "Step $steps: $(jq -r '"\(.cursor)/\(.total)"' "$BODY")" ;;
              409) state=done ;;
              *) echo "Step $steps failed ($status):"; cat "$BODY"; exit 1 ;;
            esac
          done
          echo "Scan finished."
```

- [ ] **Step 2: Estrarre lo script e controllare la sintassi**

Run (dalla radice del repo; `$SCRATCH` è la scratchpad della sessione):
```bash
SCRATCH=/private/tmp/claude-501/-Volumes-Sites-any-stock/46c054f3-1394-435b-887c-4ece8545ff0a/scratchpad
mkdir -p "$SCRATCH" && awk '/^        run: \|$/{f=1;next} f' .github/workflows/scanner.yml | sed 's/^          //' > "$SCRATCH/run-scan.sh"
bash -n "$SCRATCH/run-scan.sh" && echo SYNTAX_OK; command -v jq curl node
```
Expected: `SYNTAX_OK` e i tre percorsi di `jq`, `curl` e `node`. Se manca `jq`: `brew install jq`.

- [ ] **Step 3: Server finto e tre prove** — crea `$SCRATCH/mock-server.mjs`:

```js
import http from 'node:http'

const mode = process.argv[2]
let steps = 0
let failedOnce = false

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/scanner') {
      if (mode === 'too-soon') {
        res.statusCode = 429
        return res.end('{"error":"too recent"}')
      }
      return res.end(JSON.stringify({ runId: 'r1', cursor: 0, total: 50, status: 'running', resumed: false }))
    }
    if (req.url === '/api/scanner/step') {
      if (mode === 'broken') {
        res.statusCode = 500
        return res.end('{"error":"boom"}')
      }
      if (mode === 'flaky' && !failedOnce) {
        failedOnce = true
        res.statusCode = 503
        return res.end('{}')
      }
      steps++
      return res.end(JSON.stringify({ cursor: steps * 25, total: 50, status: steps >= 2 ? 'done' : 'running', advanced: true }))
    }
    res.statusCode = 404
    res.end('{}')
  })
  .listen(8765)
```

Run, una prova per modalità (`ok`, `flaky`, `too-soon`, `broken`):
```bash
for mode in ok flaky too-soon broken; do
  node "$SCRATCH/mock-server.mjs" $mode & pid=$!
  sleep 1
  APP_URL=http://localhost:8765 RETRY_SLEEP=0 bash "$SCRATCH/run-scan.sh"; echo "mode=$mode exit=$?"
  kill $pid; wait $pid 2>/dev/null
done
```
Expected:
- `ok`: stampa `Step 1: 25/50`, `Step 2: 50/50`, `Scan finished.` e `exit=0`.
- `flaky`: segnala `Attempt 1 on /api/scanner/step failed (503)`, poi come `ok`, `exit=0`.
- `too-soon`: `The last scan is too recent: nothing to do.` e `exit=0`.
- `broken`: tre tentativi falliti, `Step 1 failed (500):` e `exit=1`.

Non lanciare lo script contro `APP_URL` reale o contro il DB remoto.

- [ ] **Step 4: Documentare `APP_URL`** — in `.env.example`, dopo il blocco degli avvisi email, aggiungere:

```
# URL pubblico dell'app: nelle email dello scanner diventa il link alla scheda del titolo (opzionale)
# APP_URL="https://your-app.vercel.app"
```

- [ ] **Step 5: Verifica finale e commit**

Run: `npm test > /tmp/suite.log 2>&1; grep -E "Test Files|Tests |FAIL" /tmp/suite.log | head -4; npx tsc --noEmit; npm run lint 2>&1 | grep -E "^/Volumes|problems"`
Expected: tutti i file di test verdi, `tsc` pulito, lint con soli i 7 errori già presenti in `app/scopri/page.tsx` e `components/CandidateCard.tsx`.

```bash
git add .github/workflows/scanner.yml .env.example
git commit -m "feat: run the scanner every evening"
```

---

## Self-Review

**Copertura della spec**
- Dati (`ScanAlert`, `ScannerAlertSettings`, `resetDb`) → Task 3. ✔
- Modulo condiviso del verdetto → Task 2. ✔
- `collectAlerts`, `buildScanEmail` (oggetto, blocchi, prezzi, mercato, volume parziale, escape, link, disclaimer, HTML a 600 px) → Task 4. ✔
- `notifyScanAlerts` (invio, segnatura solo a invio riuscito, `knownFull`, mai eccezioni, una email per scansione, doppia chiusura) e aggancio in `closeRun` → Task 5. ✔
- `sendEmail` con `html`, `emailConfigured`, `APP_URL` in `.env.example` → Task 1 e 9. ✔
- Route arma/disarma/impostazioni con 400/404 e snapshot all'attivazione → Task 6. ✔
- Busta fuori dal link, solo sulle righe 7 su 8, `aria-pressed` e `aria-label`, annullamento in caso di errore, interruttore con tooltip, disattivazione senza email → Task 7. ✔
- Workflow serale (22:00 UTC lun–ven, 429 senza errore, retry 5xx, massimo 40 passi, timeout 90 s, 409 come fine) → Task 9. ✔
- Skeleton → Task 8. ✔
- Gestione errori: invio fallito (T5), titolo armato non letto/uscito (resta armato: `collectAlerts` lo ignora, T4), nessuna riga 8 su 8 (T5 "stays silent"), nessuna impostazione (T5), clic rapidi (T7). ✔

**Tipi e nomi**
`ScanRow` (T2) è usato da `EmailItem` (T4), da `toScanRow` (T2, T5, T7) e da `ScannerRow` (alias). `planFor` restituisce `{ plan, note }`, spalmato in `EmailItem` in T4 (test) e T5. `getAlertState()` restituisce `{ armed, newEntrants }`, passato in T7 come `alerts={{ emailReady, ...alertState }}`. `EMAIL_NOT_READY` è esportato da `AlertBell` e riusato da `AlertSwitch`. I valori di `Verdict` e le etichette restano quelli di `lib/scanner.ts`.

**Punti da sapere**
- Il formato delle cifre dipende da `toLocaleString('it-IT')`: i test lo assumono, come già fanno quelli della tabella.
- Se un titolo armato esce dall'universo, la sua riga resta in `ScanAlert` fino al disarmo manuale: non produce email né errori.
- Un titolo che esce e rientra negli 8 su 8 non è "nuovo" per l'interruttore globale (resta in `knownFull`), come da spec.
