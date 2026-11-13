# Confronto titoli — Design

## Obiettivo

Permettere di confrontare affiancati 2-4 titoli già presenti in watchlist:
prezzo, Evaluation (momentum/consenso analisti/fondamentali/target price),
Fair Value, Solidità (Altman Z-score/Piotroski F-score), Insight LLM.
Nessuna nuova fonte dati, nessuna nuova formula — riuso di quanto già
calcolato e renderizzato nella pagina `app/stock/[symbol]`.

Questo è il primo di quattro sotto-progetti decisi durante il
brainstorming per evolvere l'app verso discovery di titoli nuovi,
discovery/analisi di settori e trend, e alert su nuove opportunità. Gli
altri tre restano fuori scope di questo documento e avranno ciascuno il
proprio spec.

## Non-goals

- Nessun titolo fuori watchlist (no preview mode): se un simbolo in
  query non è tracciato, viene scartato in silenzio. Il confronto con
  titoli non ancora seguiti è compito del sotto-progetto "discovery",
  non di questo.
- Nessuna nuova formula o fonte dati: riuso di `evaluateStock`,
  `altmanZ`, `getAnnualFinancials`, `getMetrics`, e dei componenti
  `VerdictCard`/`ReasonsSection`, `FairValueCard`, `FinancialAnalysis`,
  `InsightPanel` già esistenti.
- Nessuna sezione News/Insider/Video/AnalystTrendChart nel confronto
  (scelta esplicita per tenere la pagina leggibile con 4 colonne).
- Nessuna persistenza della selezione oltre la sessione client (si
  perde al reload della watchlist — accettabile, è solo un passaggio
  verso `/confronta`).
- Nessun refresh forzato dei dati: la pagina legge solo quanto già in
  DB/cache, stesso pattern delle altre pagine (nessuna nuova chiamata
  di rete fallibile introdotta).

## Selezione e navigazione (`components/CompareSelection.tsx`)

Nuovo componente client con Context + hook:

```typescript
export function CompareSelectionProvider({ children }: { children: React.ReactNode })
export function CompareCheckbox({ symbol }: { symbol: string })
export function CompareBar({ maxCount }: { maxCount: number }) // maxCount = 4
```

- `CompareSelectionProvider` wrappa la `<ul className={styles.list}>`
  della watchlist (`app/page.tsx`); mantiene in stato locale un
  `Set<string>` di simboli selezionati.
- `CompareCheckbox` va in ogni `<li>` di riga; disabilitato (con
  `title="Massimo 4 titoli"`) quando il Set ha già 4 elementi e il
  proprio simbolo non ne fa parte.
- `CompareBar` è una barra sticky in fondo alla pagina (visibile solo
  quando il Set non è vuoto): mostra "{N} selezionati" e un bottone
  "Confronta", disabilitato se `N < 2`. Al click:
  `router.push('/confronta?symbols=' + [...set].join(','))`.

Nessuno stato server, nessuna persistenza oltre la sessione client.

## Route e data loading

### `lib/compare.ts` — nuovo modulo

```typescript
export interface ComparisonStock {
  stock: Stock
  latest: PriceSnapshot | null
  evaluation: Evaluation | null
  fairValueInput: FairValueInput | null
  altman: AltmanResult | null
  financials: AnnualFinancial[]
  insight: StockInsight | null
}

export async function loadComparisonStock(symbol: string): Promise<ComparisonStock | null>
```

Comportamento:

1. `prisma.stock.findUnique({ where: { symbol }, include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 2 }, insight: true } })`.
   Se non trovato → ritorna `null` (simbolo non in watchlist).
2. In parallelo (`Promise.all`): `getAnnualFinancials(symbol)`,
   `getMetrics(symbol).catch(() => null)` — stesso pattern try/catch
   già usato in `app/stock/[symbol]/page.tsx`.
3. Costruisce `evaluation` chiamando `evaluateStock(...)` con gli stessi
   campi passati oggi dalla pagina detail (incluso
   `earliestSnapshot` quando esistono 2 snapshot).
4. Costruisce `altman` chiamando `altmanZ(...)` con l'ultimo anno
   finanziario disponibile e il market cap corrente, stessa logica
   della pagina detail.
5. Nessuna chiamata LLM, nessun `refreshStockIfStale`: i dati sono
   quelli già aggiornati dal cron/refresh manuale esistente.

### `app/confronta/page.tsx` — nuova pagina (server component)

1. Legge `searchParams.symbols` (stringa CSV), fa `split(',')`,
   `toUpperCase()`, dedup, e clamp ai primi 4 valori.
2. Se dopo il parsing restano meno di 2 simboli → render di un
   messaggio: "Seleziona almeno 2 titoli dalla watchlist." con link a
   `/`.
3. `Promise.all(symbols.map(loadComparisonStock))`, filtra i `null`
   (simbolo non trovato/rimosso).
4. Se restano meno di 2 risultati validi → stesso messaggio del punto 2.
5. Altrimenti renderizza la griglia (vedi sezione successiva).

## Layout (`app/confronta/page.module.css`)

CSS Grid, `grid-template-columns: repeat(N, 1fr)` dove N = numero di
titoli validi (2-4). Righe = sezioni, in quest'ordine, ciascuna con
`overflow-x: auto` per schermi stretti:

1. **Header**: symbol, nome, prezzo, variazione — una colonna per
   titolo, stile ripreso da `app/page.module.css` (`.titleCell`,
   `.price`, `.change`).
2. **Evaluation**: `<VerdictCard evaluation={...} />` +
   `<ReasonsSection evaluation={...} />` per colonna.
3. **Fair Value**: `<FairValueCard embedded input={...} altman={...} />`
   per colonna — la prop `embedded` esiste già apposta per
   l'inserimento in contesti diversi dalla pagina detail.
4. **Solidità**: `<FinancialAnalysis years={financials}
   marketCapMillions={...} />` per colonna.
5. **Insight LLM**: `{insight && <InsightPanel insight={insight} />}`
   per colonna — vuota (nessun box) se l'insight non è stato ancora
   generato per quel titolo.

Nessun nuovo design token: stesse variabili CSS (`--rule`, `--brass`,
Geist sans/mono) già in uso in tutta l'app.

## Error handling

- Simbolo in query non in watchlist o rimosso dopo la selezione →
  scartato in silenzio da `loadComparisonStock` (ritorna `null`),
  nessun errore visibile.
- Meno di 2 simboli validi (prima o dopo il filtro) → messaggio guida,
  mai pagina vuota o rotta.
- Più di 4 simboli in query (solo se l'URL viene modificato a mano,
  dato che `CompareBar` impedisce di arrivare a 5 dalla UI) → clamp
  silenzioso ai primi 4.
- Titolo con dati parziali (appena aggiunto, nessun insight, nessun
  dato finanziario annuale) → ogni pannello riusato gestisce già i
  suoi casi "non disponibile" esattamente come nella pagina detail;
  nessuna logica di null-handling nuova da scrivere.
- Nessuna nuova chiamata di rete fallibile introdotta: `loadComparisonStock`
  usa le stesse funzioni (`getAnnualFinancials`, `getMetrics`) con lo
  stesso pattern try/catch già testato altrove.

## Testing

- `lib/compare.ts`: unit test di `loadComparisonStock` (prisma e
  finnhub mockati) — titolo trovato con dati completi, titolo trovato
  con dati parziali (nessun insight/financials), titolo non trovato →
  `null`.
- `app/confronta/page.tsx`: test di parsing/clamping dei
  `searchParams` — 0 o 1 simboli → messaggio; 2-4 simboli validi →
  render della griglia; 5 simboli → clamp a 4; simbolo sconosciuto tra
  quelli validi → scartato senza rompere il render degli altri.
- `components/CompareSelection.tsx`: test di selezione/deselezione,
  blocco del 5° checkbox, bottone "Confronta" disabilitato sotto 2
  selezionati, costruzione corretta della query string al click.

## Review Focus

- Un titolo con un solo snapshot (appena aggiunto) nel confronto non
  deve mai mostrare un `since-watching` o un target price inventato —
  stessa garanzia già verificata per la pagina detail, qui va solo
  confermato che `loadComparisonStock` passa gli stessi input a
  `evaluateStock`.
- La selezione checkbox non deve permettere di superare 4 titoli né di
  cliccare "Confronta" sotto i 2.
- Rimuovere un titolo dalla watchlist mentre un link `/confronta?symbols=...`
  che lo includeva è ancora in giro (es. salvato nei preferiti del
  browser) non deve rompere la pagina — va solo scartato.
