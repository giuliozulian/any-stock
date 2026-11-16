# Discovery di nuovi titoli (USA + Italia) — Design

## Obiettivo

Una pagina `/scopri` dove, con un bottone "Scansiona ora", l'app propone
titoli NUOVI (non ancora in watchlist) interessanti da valutare, con un
punteggio trasparente 0-100 e il motivo in italiano. Secondo dei quattro
sotto-progetti decisi nel brainstorming di evoluzione dell'app (il primo,
confronto titoli, è già implementato — vedi
`2026-11-13-stock-comparison-design.md`). Gli altri due (discovery
settori/trend, alert su nuove opportunità) restano fuori scope.

## Non-goals

- Nessuna fonte dati nuova: solo funzioni già esistenti
  (`getRecentCongressBuys`, `getMarketBigMovers`, `getMetrics`,
  `getInsiderData`, `rankSignals`, `memberStats`, `getMemberProfiles`).
- Nessuno scraping nuovo o scansione dell'intero mercato: l'universo di
  candidati parte sempre da feed già bounded (movers giornalieri,
  acquisti congress recenti), mai da un giro su migliaia di ticker.
- Nessun machine learning, nessun backtest, nessuna previsione di
  prezzo: punteggio additivo a soglie fisse, stessa filosofia di
  `lib/evaluate.ts`/`lib/fair-value.ts`/`lib/solidity.ts`.
- Nessun cron automatico: lo scan parte solo a bottone (scelta
  esplicita, per controllo manuale sul consumo di chiamate Finnhub).
- Niente storico degli scan: ogni scan sovrascrive il precedente per
  simbolo (upsert), non si accumula una cronologia.
- Per l'Italia: nessun segnale insider/congress (Form 4 SEC e STOCK Act
  USA non esistono per titoli italiani) — il punteggio IT usa solo
  momentum + fondamentali, dichiarato esplicitamente nella nota.

## Data model

### Nuovo modello: `DiscoveredCandidate`

```prisma
model DiscoveredCandidate {
  id                String    @id @default(cuid())
  symbol            String    @unique
  name              String
  market            String    // "US" | "IT"
  score             Float     // 0-100, media dei sotto-punteggi disponibili
  momentumScore     Float     // 0-100
  fundamentalsScore Float     // 0-100
  insiderScore      Float     // 0-100 (sempre 0 per market = "IT")
  reason            String    // nota breve in italiano
  source            String    // "congress" | "yahoo-movers-us" | "yahoo-movers-it" (se più fonti, elenco separato da virgola)
  partial           Boolean   @default(false) // true se una chiamata di arricchimento è fallita per questo titolo
  scannedAt         DateTime  @default(now())
  dismissedAt       DateTime?

  @@index([score])
}
```

Upsert per `symbol` ad ogni scan: il risultato precedente per quel
simbolo viene sovrascritto. Un simbolo non più tra i candidati
dell'ultimo scan resta nella tabella con il suo `scannedAt` vecchio (la
pagina filtra per `scannedAt` dell'ultimo scan globale, non per `id`) —
vedi sezione UI per come la pagina decide cosa mostrare.

Per sapere "qual è l'ultimo scan", si usa il `MAX(scannedAt)` tra tutte
le righe; la pagina mostra solo le righe con quel `scannedAt` esatto
(tutte le righe di un singolo scan condividono lo stesso timestamp,
impostato una volta a inizio funzione, non per singola riga).

## Modulo `lib/discover.ts`

### Sourcing (nessuna nuova fonte dati)

```typescript
export interface CandidateSeed {
  symbol: string
  name: string
  market: 'US' | 'IT'
  source: string[]       // una o più: "congress", "yahoo-movers-us", "yahoo-movers-it"
  seedChangePct: number | null  // variazione dal mover, null se da congress senza movimento noto
}

export async function sourceCandidates(excludeSymbols: Set<string>): Promise<CandidateSeed[]>
```

Comportamento:

1. In parallelo, ciascuna in try/catch indipendente (una fonte che
   fallisce non blocca le altre, log e array vuoto in quel ramo):
   - `getRecentCongressBuys()` → raggruppa per ticker (stesso pattern
     di `app/politici/page.tsx`), filtrato a chi ha realmente comprato
     (non vendite).
   - `getMarketBigMovers(15, 'us')` → ogni riga è un candidato USA.
   - `getMarketBigMovers(15, 'it')` → ogni riga è un candidato IT.
2. Unisce per `symbol`, deduplicando (un simbolo può avere più fonti,
   es. comprato da un membro del Congresso e anche in top gainers lo
   stesso giorno — `source` diventa `["congress", "yahoo-movers-us"]`).
3. Esclude ogni simbolo già in `excludeSymbols` (i simboli già in
   watchlist — passato dal chiamante, letto da `prisma.stock.findMany`).
4. Ordina per priorità pre-arricchimento: `source.length` (più fonti
   concordano = priorità più alta) poi `Math.abs(seedChangePct ?? 0)`
   decrescente.
5. **Non arricchisce ancora nulla** — ritorna la lista ordinata intera,
   la selezione del cap avviene nel chiamante (vedi sotto), per
   mantenere `sourceCandidates` testabile senza mock di Finnhub.

### Selezione con cap e quota per mercato

```typescript
export function selectForEnrichment(seeds: CandidateSeed[], maxUS = 14, maxIT = 6): CandidateSeed[]
```

Prende fino a 14 USA e fino a 6 Italia (già ordinati per priorità da
`sourceCandidates`); se un mercato ha meno candidati della sua quota, i
posti liberi NON vanno all'altro mercato (quota fissa, non un cap
totale condiviso) — scelta esplicita per garantire che l'Italia non
resti sempre esclusa quando il mercato USA è molto mosso. Risultato:
massimo 20 candidati arricchiti per scan, ma l'Italia ha sempre il suo
spazio dedicato indipendentemente da quanto rumoroso è il mercato USA.

### Punteggio (`lib/discover.ts`, pure, no network)

```typescript
export interface ScoreInput {
  price: number
  week52High: number | null
  week52Low: number | null
  changePct: number
  pegRatio: number | null
  roe: number | null
  debtToEquity: number | null
  congressSignalScore: number | null  // BuySignal.score da rankSignals, null se non da congress
  insiderBuyerCount: number           // 0 se nessun dato/nessun acquisto insider
  market: 'US' | 'IT'
}

export interface CandidateScore {
  momentumScore: number
  fundamentalsScore: number
  insiderScore: number
  score: number
  reason: string
  partial: boolean
}

export function scoreCandidate(input: ScoreInput): CandidateScore
```

**Momentum** (0-100):
```
rangePoints = (week52High !== null && week52Low !== null && week52High > week52Low)
  ? clamp((price - week52Low) / (week52High - week52Low), 0, 1) * 100
  : null
movePoints = clamp(Math.abs(changePct) / 30 * 100, 0, 100)
momentumScore = rangePoints === null ? movePoints : round((rangePoints + movePoints) / 2)
```

**Fondamentali** (0-100, somma a punti, stesse soglie di
`evaluate.ts` long-term ma numeriche):
```
pegPoints = (pegRatio === null || pegRatio <= 0) ? 0 : pegRatio <= 1 ? 40 : pegRatio <= 2 ? 20 : 0
roePoints = (roe === null) ? 0 : roe > 15 ? 40 : roe > 0 ? 20 : 0
debtPoints = (debtToEquity === null) ? 0 : debtToEquity < 1 ? 20 : debtToEquity < 2 ? 10 : 0
fundamentalsScore = pegPoints + roePoints + debtPoints   // max 100
```

**Insider/Congress** (0-100, solo mercato US — sempre 0 per IT):
```
congressPoints = congressSignalScore === null ? 0 : clamp(congressSignalScore / 12 * 100, 0, 100)
insiderPoints = clamp(insiderBuyerCount * 25, 0, 100)
insiderScore = market === 'IT' ? 0 : Math.max(congressPoints, insiderPoints)
```
`congressSignalScore / 12`: normalizzazione arbitraria per riportare il
punteggio non limitato di `rankSignals` (tipicamente 0-15 per un
segnale forte) su scala 0-100 — scelta euristica dichiarata, non
backtestata, stessa onestà delle altre formule dell'app.

**Punteggio combinato**:
```
score = market === 'IT'
  ? round((momentumScore + fundamentalsScore) / 2)
  : round((momentumScore + fundamentalsScore + insiderScore) / 3)
```

**Nota (`reason`)**, generata in italiano a partire dai tre numeri,
esempi:
- `"Movimento forte (+18.3%) e vicino al massimo delle 52 settimane."` (solo momentum alto)
- `"Acquisto recente di 2 membri del Congresso, fondamentali solidi (PEG 0.8, ROE 22%)."`
- `"Mercato italiano: nessun segnale insider/congress disponibile per questo titolo — solo momentum e fondamentali."` (sempre presente per IT, anche quando il punteggio è alto, per trasparenza)

`partial: true` se una chiamata di arricchimento (`getMetrics` o
`getInsiderData`) per questo simbolo è falluta — il punteggio usa 0 per
il pilastro mancante ma il flag lo segnala in UI ("dati parziali").

## Enrichment e orchestrazione (`lib/discover.ts`)

```typescript
export async function runDiscoveryScan(): Promise<{ scannedAt: Date; candidates: number }>
```

1. Legge `prisma.stock.findMany({ select: { symbol: true } })` per
   l'esclusione.
2. `sourceCandidates(excludeSymbols)` → `selectForEnrichment(seeds)`.
3. Per ciascun selezionato, in parallelo con concorrenza limitata a 5
   (per non sommare troppe richieste simultanee a Finnhub):
   `getMetrics(symbol).catch(() => null)`,
   `getInsiderData(symbol).catch(() => null)` (solo per mercato US —
   skip per IT, Finnhub insider-transactions non è utile per `.MI`).
   Il prezzo/52w/changePct vengono già dal seed (`getMarketBigMovers`)
   quando disponibili; per i candidati solo-congress (senza dato di
   mercato dal seed) si fa anche `getQuote(symbol)` e
   `getMetrics(symbol)` già copre PE/52w via lo stesso payload.
4. Per i candidati con fonte `"congress"`, il punteggio congress usa
   l'output già calcolato da `rankSignals` sui dati di
   `getRecentCongressBuys()` presi al punto 2 — nessuna chiamata
   aggiuntiva.
5. `scoreCandidate(...)` per ciascuno, poi upsert in
   `DiscoveredCandidate` con lo stesso `scannedAt` (un `new Date()`
   calcolato una sola volta a inizio funzione) per tutte le righe di
   questo scan.
6. Se il passo 2 ritorna zero candidati totali (tutte le fonti hanno
   fallito), la funzione NON fa upsert e ritorna `candidates: 0` senza
   toccare le righe esistenti — lo scan precedente resta visibile.

## API: `POST /api/discover`

`app/api/discover/route.ts`, `export const maxDuration = 60` (Vercel
Hobby supporta fino a 60s; il default di 10s non basta per ~20
arricchimenti anche con concorrenza 5). Chiama `runDiscoveryScan()`,
ritorna `{ scannedAt, candidates }` o `{ error }` con status 500 se
lancia un'eccezione imprevista (ogni fallimento previsto è già gestito
dentro `runDiscoveryScan`, quindi un errore qui è sempre un bug, non un
caso atteso).

## UI: pagina `/scopri`

- `app/scopri/page.tsx` (server component): legge l'ultimo `scannedAt`
  (`prisma.discoveredCandidate.aggregate({ _max: { scannedAt: true } })`),
  poi tutte le righe con quel `scannedAt` e `dismissedAt: null`,
  ordinate per `score` decrescente.
- `ScanButton` (client component): bottone "Scansiona ora", POST a
  `/api/discover`, stato di caricamento con testo "Scansione in corso,
  può richiedere fino a un minuto…", poi `router.refresh()`.
- `CandidateCard` per riga: simbolo, nome, badge mercato (stesso stile
  tag settore della watchlist), punteggio in grande, nota, badge "Dati
  parziali" se `partial`, bottone "Aggiungi a watchlist" (POST
  `/api/stocks` con `{ symbol }`, stesso endpoint già usato da
  `AddStockForm` — su successo rimuove la card e fa `router.refresh()`),
  bottone "Scarta" (PATCH che imposta `dismissedAt`, nuova piccola
  route o estensione di una esistente — rimuove la card lato client
  senza refresh).
- Stato vuoto: se non esiste nessuna riga → "Nessuno scan ancora
  eseguito. Premi Scansiona ora per iniziare."; se esiste un
  `scannedAt` ma zero righe non scartate → "Nessun candidato trovato in
  questo scan (o li hai già scartati tutti)."
- Data dell'ultimo scan mostrata sempre, in italiano
  (`toLocaleDateString('it-IT', ...)` + ora, stesso formato già usato
  altrove nell'app).

## Error handling

- Ogni fonte di sourcing isolata in try/catch — una che fallisce non
  blocca le altre (sezione Sourcing, punto 1).
- Arricchimento fallito per un singolo candidato → quel pilastro vale
  0, candidato resta con `partial: true`, mai scartato per questo
  motivo. Eccezione: se per un candidato senza dato di mercato dal seed
  (fonte `"congress"` pura) falliscono SIA `getQuote` SIA `getMetrics`,
  non c'è alcun prezzo/momentum utilizzabile — quel candidato viene
  scartato dallo scan (non upsertato) invece di mostrare una card con
  `momentumScore` a zero che sembrerebbe un dato reale invece di un
  buco totale.
- Scan con zero fonti funzionanti → nessun upsert, risultati precedenti
  intatti, l'API ritorna `candidates: 0` e la UI mostra un avviso senza
  cancellare la lista esistente (il `GET` della pagina legge sempre
  l'ultimo `scannedAt` presente, che resta quello del tentativo
  riuscito precedente).
- Simbolo già in watchlist non può apparire come candidato (escluso a
  monte in `sourceCandidates`) — se viene aggiunto alla watchlist
  manualmente mentre è ancora visibile come candidato da uno scan
  vecchio (caso raro, finestra stretta), il bottone "Aggiungi" di
  `POST /api/stocks` ritorna 409 "already in watchlist": la card lo
  gestisce mostrando un messaggio invece di un errore generico.

## Testing

- `lib/discover.ts`:
  - `scoreCandidate`: un test per ogni soglia (PEG/ROE/debito ai
    confini delle bande, momentum con/senza dati 52w, mercato IT che
    azzera sempre `insiderScore`, `partial` quando un input è
    `null` per un pilastro arricchito).
  - `sourceCandidates`: fonti mockate, verifica deduplica multi-fonte,
    esclusione simboli in watchlist, una fonte che lancia non blocca le
    altre.
  - `selectForEnrichment`: quota 14/6 rispettata, mercato con pochi
    candidati non "ruba" spazio all'altro.
  - `runDiscoveryScan`: integrazione con DB di test — upsert corretto,
    stesso `scannedAt` per tutte le righe di uno scan, zero fonti
    funzionanti non tocca le righe esistenti.
- `app/api/discover/route.ts`: test di integrazione, risposta corretta
  su successo e su eccezione imprevista.
- `components/CandidateCard.test.tsx`: Aggiungi (successo e 409),
  Scarta, badge "Dati parziali".

## Review Focus

- Un candidato arricchito a metà (una chiamata Finnhub fallita) non
  deve mai sparire silenziosamente dal risultato né mostrare un
  punteggio che sembra completo senza il badge "Dati parziali".
- L'Italia non deve mai restare completamente fuori dai risultati solo
  perché il mercato USA quel giorno ha prodotto più candidati — la
  quota 14/6 è fissa, non un cap totale condiviso.
- Un simbolo già in watchlist non deve mai apparire come candidato.
- Uno scan che fallisce del tutto (tutte le fonti down) non deve
  cancellare i risultati dello scan precedente.
- Il bottone "Aggiungi a watchlist" su un simbolo appena aggiunto da
  un'altra scheda/sessione non deve mostrare un errore generico ma il
  messaggio "già in watchlist".
