# Valore equo e Lynch (C1) — Design

## Obiettivo
Rendere il valore equo onesto e coerente: un intervallo con la sua affidabilità al posto di una media senza significato, un solo Lynch al posto di due formule diverse, e un voto del verdetto che nasce dallo stesso calcolo mostrato in pagina. Chiude i task 8 e 9 di `auditcalc.md`. È il primo dei quattro sotto-progetti del blocco C (C2 solidità per settore, C3 consenso e notizie, C4 bilanci IFRS).

Successo:
- Con i dati veri di oggi (AAPL, MCD, JPM) la pagina non dice più "148% sopra il valore equo": mostra un intervallo e dice che i modelli discordano.
- Un titolo con modelli coerenti riceve un intervallo stretto, una posizione (sotto, dentro, sopra) e un voto del verdetto.
- Lynch esiste in un solo punto del codice, e il "prezzo obiettivo" non vota più.
- Ogni modello escluso dice perché.

## Decisioni prese
- **Presentazione**: intervallo con mediana ("tra 93 e 247, centro 150"), scala con i punti dei singoli modelli e il prezzo. Se i modelli discordano troppo: "stima poco affidabile" e nessun giudizio sopra/sotto.
- **Ruolo nel verdetto**: il valore equo vota ±1 solo quando la stima è affidabile e il prezzo sta fuori dall'intervallo (sotto: +1, sopra: −1). Dentro l'intervallo o stima non affidabile: 0.
- **Insieme dei modelli**: i quattro attuali, con input corretti e controlli di idoneità; la scelta del modello per settore è rimandata a C2.
- **Flusso di cassa**: free cash flow per azione, ricavato da Finnhub come `prezzo ÷ pfcfShareTTM` (campo già verificato su AAPL, MCD, JPM). Sostituisce `cashFlowPerShareTTM`, che non è free cash flow.
- **Un solo Lynch**: `P/E giusto = crescita + rendimento da dividendo`, limitato tra 5 e 25. Il "prezzo obiettivo" di `evaluate.ts` (tetto 40, senza dividendo) viene tolto.

## Configurazione: `lib/valuation-config.ts`
Costanti con commento sulla data di taratura, per non averle sparse nel codice:

| Costante | Valore | Significato |
|---|---|---|
| `AAA_YIELD` | 4.5 | rendimento obbligazioni societarie AAA, in %, usato da Graham con crescita |
| `DISCOUNT_RATE` | 0.09 | tasso di sconto dei flussi di cassa |
| `TERMINAL_GROWTH` | 0.025 | crescita oltre i 10 anni |
| `GRAHAM_GROWTH_MAX` | 15 | tetto della crescita in Graham, in % |
| `DCF_GROWTH_MAX` | 12 | tetto della crescita nei flussi, in % |
| `LYNCH_PE_MIN` / `LYNCH_PE_MAX` | 5 / 25 | limiti del P/E giusto di Lynch |
| `MIN_BOOK_TO_PRICE` | 0.10 | patrimonio per azione minimo, in quota del prezzo, per usare Graham number |
| `RELIABLE_MAX_SPREAD` | 2 | massimo rapporto `high ÷ low` per considerare affidabile la stima |
| `VALUATION_TUNED_ON` | `'2026-11-17'` | data dell'ultima taratura, mostrata nel dettaglio |

## Dati
- `lib/finnhub.ts`: `FinnhubMetrics` guadagna `priceToFcf?: number | null`, letto da `pfcfShareTTM` in `getMetrics`. `cashFlowPerShare` resta nel tipo ma non è più usato dal valore equo (si può togliere in un secondo momento).
- Nessuna colonna nuova nel DB: il rapporto prezzo/free cash flow si usa al volo, come gli altri dati di Finnhub. `PriceSnapshot` non cambia.

## `lib/fair-value.ts`
```ts
export interface FairValueInput {
  price: number
  epsTTM: number | null
  bookValuePerShare: number | null
  epsGrowth5Y: number | null
  dividendYield: number | null
  priceToFcf: number | null
}

export type FairValueKey = 'graham-number' | 'graham-growth' | 'lynch' | 'cash-flow'
export interface FairValueModel { key: FairValueKey; label: string; value: number }
export interface ExcludedModel { key: FairValueKey; label: string; reason: string }
export type FairValuePosition = 'below' | 'inside' | 'above' | 'unclear'

export interface FairValueResult {
  models: FairValueModel[]
  excluded: ExcludedModel[]
  low: number
  high: number
  median: number
  spread: number            // high / low
  reliable: boolean         // spread <= RELIABLE_MAX_SPREAD
  position: FairValuePosition
  premiumPct: number | null // (price - median) / median * 100, solo se affidabile
}

export function lynchValue(eps: number, growthPct: number, dividendYieldPct: number): number
export function buildFairValueInput(price: number, metrics: { epsTTM: number | null; bookValuePerShare?: number | null; epsGrowth5Y: number | null; dividendYield: number | null; priceToFcf?: number | null }): FairValueInput
export function fairValue(input: FairValueInput): FairValueResult | null
```

### Idoneità dei modelli
Il free cash flow per azione è `price ÷ priceToFcf` quando `priceToFcf > 0`, altrimenti assente.

| Modello | Formula | Condizione | Motivo se escluso |
|---|---|---|---|
| Numero di Graham | `√(22,5 × utile × patrimonio per azione)` | utile > 0, patrimonio > 0 e `patrimonio ≥ MIN_BOOK_TO_PRICE × prezzo` | "Mancano utile o patrimonio per azione positivi." oppure "Patrimonio per azione troppo piccolo rispetto al prezzo: il metodo non vale per aziende con pochi attivi." |
| Graham con crescita | `utile × (8,5 + 2g) × 4,4 ÷ AAA_YIELD`, `g = clamp(crescita, 0, GRAHAM_GROWTH_MAX)` | utile > 0 e crescita nota | "Utile per azione negativo o assente." oppure "Crescita degli utili non disponibile." |
| Lynch | `utile × clamp(crescita + dividendo, LYNCH_PE_MIN, LYNCH_PE_MAX)` | utile > 0 e crescita nota e > 0 | "Utile per azione negativo o assente." oppure "Crescita degli utili non disponibile o non positiva." |
| Flussi di cassa scontati | 10 anni al tasso `g = clamp(crescita, 0, DCF_GROWTH_MAX)`, sconto `DISCOUNT_RATE`, valore finale con `TERMINAL_GROWTH` | free cash flow per azione > 0 e crescita nota | "Flusso di cassa libero non disponibile o negativo." oppure "Crescita degli utili non disponibile." |

Una crescita mancante non diventa più 0 in silenzio, e il pavimento del 3% sparisce.

### Aggregazione
- Servono almeno due modelli e `price > 0`, altrimenti `null`.
- `low` e `high` sono minimo e massimo dei modelli; `median` è la mediana (media dei due centrali se i modelli sono pari); `spread = high ÷ low`.
- `reliable = spread ≤ RELIABLE_MAX_SPREAD`.
- `position`: non affidabile → `unclear`; affidabile → `below` se `price < low`, `above` se `price > high`, altrimenti `inside`.
- `premiumPct` solo se affidabile.

### Esempi di riferimento (dati Finnhub del 17 novembre 2026, calcolati a mano nei test)
- AAPL: Graham number escluso (patrimonio 7,7 su un prezzo di circa 350, cioè sotto il 10%); Graham con crescita circa 247, Lynch circa 91, flussi di cassa tra i due. Spread oltre 2: **non affidabile**.
- MCD: Graham number escluso; Graham con crescita circa 442, Lynch circa 207. Spread oltre 2: **non affidabile**.
- JPM: i modelli basati su utili e flusso di cassa danno valori molto diversi tra loro e lontani dal prezzo: **non affidabile**. Il caso serve da promemoria per C2: per le banche il free cash flow non ha senso.

## Verdetto (`lib/evaluate.ts`, `components/EvaluationPanel.tsx`, `lib/verdict-note.ts`)
- `EvaluateInput` guadagna `fairValue: FairValueResult | null`: lo calcola chi chiama `evaluateStock` con `fairValue(buildFairValueInput(...))`.
- `Evaluation.targetPrice` viene sostituito da:
  ```ts
  fairValue: { position: FairValuePosition | null; reliable: boolean; low: number | null; high: number | null; median: number | null; note: string }
  ```
  `position` è `null` quando il valore equo non è calcolabile.
- Note (italiano, una frase):
  - non calcolabile: "Valore equo non disponibile: servono almeno due modelli con dati adatti.";
  - non affidabile: "I modelli discordano (da {low} a {high}): stima poco affidabile, non pesa nel giudizio.";
  - affidabile: "Il prezzo è {sotto|dentro|sopra} l'intervallo di valore equo ({low}–{high}).".
- `evaluateTargetPrice` e le costanti collegate spariscono.
- `EvaluationPanel.overallTone(tones, position, newsAdjustment)`: `below` +1, `above` −1, altro 0 (sostituisce la soglia ±15% sul potenziale).
- `verdict-note.ts`: la riga "Prezzo obiettivo" diventa "Valore equo", e `PROMPT_VERSION` sale di uno così le note generate si rigenerano da sole (meccanismo già esistente con `inputHash`).
- `lib/compare.ts` e `app/stock/[symbol]/page.tsx` costruiscono l'input con `buildFairValueInput` (oggi lo compongono a mano in tre punti) e passano il risultato sia alla card sia a `evaluateStock`.

## Interfaccia (`components/FairValueCard.tsx`)
- **Tile "Valore equo"**: l'intervallo ("93–247") e sotto "centro 150". Se affidabile: la frase "Il prezzo attuale X è N% sopra/sotto il centro" resta, calcolata su `premiumPct`. Se non affidabile: etichetta "Stima poco affidabile: i modelli discordano" e nessuna frase sopra/sotto.
- **Scala** (`FairValueScale`, nuovo componente): asse orizzontale da `min(modelli, prezzo) × 0,9` a `max × 1,1`; un punto per modello con la sua etichetta, una banda per l'intervallo, un marcatore per il prezzo. `role="img"` con `aria-label` che elenca modelli e prezzo. La banda è verde se affidabile, neutra altrimenti.
- **Dettaglio** ("Come si arriva a questa stima"): i modelli calcolati con il loro valore, poi i modelli esclusi con il motivo, e in fondo "Parametri tarati il {VALUATION_TUNED_ON}: sconto 9%, rendimento AAA 4,5%".
- **Tooltip** aggiornato: formula di ciascun modello e perché la stima può essere poco affidabile.
- Se `fairValue` è `null` e non c'è Altman, la card non compare, come oggi.

## Gestione errori e casi limite
- Nessun modello utilizzabile o uno solo: `null`, la card mostra solo Altman se c'è.
- `priceToFcf` assente, zero o negativo: flusso di cassa escluso con motivo.
- `price` non positivo: `null`.
- Valori non finiti (NaN, infinito) in ingresso: il modello è escluso, mai un valore NaN in pagina.
- Modelli con valore ≤ 0 (non dovrebbero esistere con input positivi): esclusi.
- Un solo spread esattamente 2: affidabile (soglia inclusiva).

## Test (vitest)
- `tests/lib/valuation-config.test.ts`: le costanti hanno i valori attesi.
- `tests/lib/fair-value.test.ts` (riscritto): ogni modello su valori calcolati a mano (inclusa la sostituzione di `cashFlowPerShare` con il free cash flow); idoneità e motivi per ogni condizione; crescita mancante, negativa e zero; free cash flow assente; mediana con modelli pari e dispari; spread al limite (2 affidabile, 2,01 no); `position` per i quattro casi; `premiumPct` solo se affidabile; i tre casi di riferimento AAPL, MCD, JPM; `lynchValue` con i limiti 5 e 25 e con dividendo; `buildFairValueInput` (gestione dei `null` e di `priceToFcf`); input non finiti.
- `tests/lib/evaluate.test.ts`: tolti i test di `targetPrice`; nuovi test su `fairValue.position`, le tre note e il caso `null`.
- `tests/components/EvaluationPanel.test.tsx`: `overallTone` con `below`, `above`, `inside`, `unclear`, `null`.
- `tests/components/FairValueCard.test.tsx` (nuovo): intervallo e centro, etichetta "stima poco affidabile", frase sopra/sotto solo se affidabile, dettaglio con modelli esclusi e motivo, scala accessibile.
- `tests/lib/finnhub.test.ts`: `priceToFcf` letto da `pfcfShareTTM`, `null` se manca.
- `tests/lib/compare.test.ts`, `tests/lib/verdict-note.test.ts`: aggiornati ai nuovi campi.

## Fuori scope
- Formule per settore (banche, assicurazioni, immobiliari) e scelta del modello per tipo di azienda: C2.
- Altman, Piotroski, soglia debito/capitale: C2.
- Consenso analisti e impatto notizie: C3.
- Bilanci IFRS e free cash flow da SEC: C4.
- Modelli nuovi (multipli di settore, DDM per i dividendi).

## Da fare da parte dell'utente dopo l'implementazione
Nessuna migrazione. Le note LLM del verdetto si rigenerano da sole al prossimo refresh (cambia `PROMPT_VERSION`).
