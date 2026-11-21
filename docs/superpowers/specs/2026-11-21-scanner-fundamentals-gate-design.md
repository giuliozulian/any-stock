# Scanner: fondamentali, AVWAP e volume 1,5× nel verdetto

## Obiettivo

Il verdetto dello scanner deve concordare con il notebook "Momentum breakout engine". Oggi `tradePlan` (`lib/scanner.ts`) dà "Si può comprare" con Trend Template 8/8, breakout e volume, senza guardare i fondamentali. Il notebook boccia lo stesso titolo (EG: ricavi -14%, EPS +0,49%).

Successo: un titolo con segnale tecnico `buy` ma fondamentali sotto soglia non esce come "Si può comprare" né genera l'email d'allerta.

## Decisioni già prese

- Soglie fondamentali come Finviz (`lib/finviz.ts`): EPS q/q > 25%, ricavi q/q > 25%, ROE > 15%.
- Nuovo verdetto per il caso "tecnico ok, fondamentali deboli".
- `BREAKOUT_VOLUME` da 1,4 a 1,5.
- Anchored VWAP ancorato al minimo della base, con effetto bloccante.

## Verdetto (`lib/scanner.ts`, `lib/scan-verdict.ts`)

- `PlanInput` guadagna `fundamentals?: { epsGrowthQoq: number | null; salesGrowthQoq: number | null; roe: number | null } | null` e `avwap?: number | null`.
- Nuovo `Verdict` `weak-fundamentals`. Etichetta "Tecnico ok, fondamentali deboli", tono `warn`, rank subito dopo `buy`. Mantiene zona d'acquisto, stop e obiettivi di `buy` (il segnale tecnico resta valido), ma il testo dice di non comprare finché gli utili non accelerano.
- Il gate si applica solo quando il verdetto sarebbe `buy`. Ordine: fondamentali, poi AVWAP.
- Fondamentali falliti = almeno una delle tre misure presente e sotto soglia. Misure `null` non pesano contro il titolo (stessa convenzione di `volumeDryUp`); se sono tutte `null` la frase dice "fondamentali non disponibili".
- AVWAP: se `price < avwap`, `buy` diventa `confirm` con nota `below-avwap` (nuovo `PlanNote`), come `session` e `weak-market` in `withContext`.
- `VERDICT`, `sentence` e `ScanRow`/`ResultLike`/`toScanRow` si estendono ai nuovi campi.
- Le email d'allerta (`lib/scan-alerts*.ts`) cercano `verdict === 'buy'`: nessuna modifica, smettono di scattare per `weak-fundamentals`.

## Dati fondamentali

- `FinnhubMetrics` (`lib/finnhub.ts`) guadagna `epsGrowthQuarterlyYoy` e `revenueGrowthQuarterlyYoy` (da `/stock/metric`); `roe` esiste già. I nomi esatti dei campi vanno verificati sul payload reale prima di scrivere il codice.
- Nuovo modulo `lib/scan-fundamentals.ts`: dato un elenco di simboli, li scarica con concorrenza limitata e un budget di tempo, restituisce una mappa `symbol -> { epsGrowthQoq, salesGrowthQoq, roe }`. Errore o timeout per un simbolo = `null`.
- Si scaricano solo i titoli con `passedCount >= 8` e `vcpStatus` `forming` o `breakout`.
- `ScanResult` guadagna colonne nullable `epsGrowthQoq`, `salesGrowthQoq`, `roe` (Float) e `avwap` (Float), con migrazione Prisma.
- Il pannello del singolo titolo (`MinerviniPanel`, `/api/minervini-ai/[symbol]`) legge i fondamentali in diretta da Finnhub.
- Il Finviz screen (`lib/finviz-screen.ts`) non cambia: la query contiene già i filtri EPS, ricavi e ROE.

### Rischio: budget di tempo

`closeRun` (`lib/scanner-run.ts`) gira nell'ultimo step della route, che ha 60 s. Le chiamate Finnhub (limite 60/min) possono non starci. Soluzione: il recupero fondamentali è un passo separato dopo la chiusura della scansione, con tempo massimo; allo scadere i dati restano `null`. Il piano deve fissare dove vive questo passo.

## Anchored VWAP (`lib/minervini.ts`)

- `anchoredVwap(bars, fromIndex)`: somma di prezzo tipico `(high + low + close) / 3` per volume, diviso la somma dei volumi, da `fromIndex` all'ultima barra. Verificare che `Bar` abbia high, low, close e volume.
- Ancora: indice del minimo (low più basso) all'interno della base VCP.
- `scanSymbol` lo calcola dalle barre già scaricate e lo salva in `avwap`. Nessuna chiamata di rete in più.

## Volume

`BREAKOUT_VOLUME = 1,5`. Si corregge il commento che attribuisce la soglia a Minervini: nel rulebook (E2) la soglia numerica è "non verificata".

## Test

- `tradePlan`: gate fondamentali (sotto soglia, sopra soglia, parziale, tutti `null`), AVWAP (sotto e sopra), ordine dei due gate, nessun effetto su verdetti diversi da `buy`.
- `anchoredVwap`: calcolo su barre di esempio, ancora al minimo.
- `scan-fundamentals`: mappatura, timeout e errore per simbolo con `fetch` iniettato.
- Aggiornare i test esistenti che assumono 1,4× (`tests/lib/scanner.test.ts`, `tests/lib/scan-verdict.test.ts`, `tests/lib/scan-alerts*.test.ts`, `tests/components/MinerviniPanel.test.tsx`, `tests/components/ScannerTable.test.tsx`).

## Documenti

Aggiornare `docs/minervini-rulebook.md`: F1/F2 (ora coperte, soglie CAN SLIM da report ChatGPT), E2 (1,5×), sezione 7 (AVWAP non più spento di default), tabella "Copertura nel codice".

## Fuori scope

AVWAP ancorato agli utili, distribution day di mercato (M2), linea RS contro SPY (RS1), stop al 7-8% (resta 8%).

## Nota

Le soglie CAN SLIM e l'AVWAP vengono dal report ChatGPT e da O'Neil/Shannon, non da Minervini (vedi rulebook). Allinearsi al notebook significa adottarle.
