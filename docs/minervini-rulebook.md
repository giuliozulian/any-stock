# Rulebook Minervini per l'analisi AI

Bozza 1, verificata contro i libri. Serve come base per le funzioni di calcolo in `lib/` e per il prompt dell'analisi AI. Non contiene testo dei libri, solo regole riassunte con riferimento.

## Come leggerlo

**Tipo**
- `calcolo`: il codice lo misura dai dati di prezzo e volume.
- `giudizio`: serve interpretazione, tocca all'AI con i numeri del codice come appoggio.
- `esterno`: dato che non abbiamo dallo storico prezzi, per esempio il rating RS di IBD o gli utili.

**Stato**
- `confermata`: trovata nel libro indicato.
- `diversa`: il libro dice una cosa diversa dal riassunto AI (il report ChatGPT). Vale il libro.
- `non verificata`: presente solo nei riassunti AI o nelle regole "house", non trovata nei libri primari.
- `fuori fonte`: viene da un autore diverso (O'Neil, Shannon). Utile ma non è Minervini.

**Fonti**
- **W** = *Trade Like a Stock Market Wizard* (2013).
- **C** = *Think & Trade Like a Champion* (2017). Non ancora spogliato per questa bozza.
- **O** = O'Neil, *How to Make Money in Stocks* (4a ed.).
- **R** = report ChatGPT "2026 High-Potential Stock Hunting" e i riassunti derivati.
- I numeri di pagina vengono dai marcatori dell'export e possono sbagliare di qualche pagina.

## 1. Trend Template (qualificatore, tutte e 8 le condizioni)

Fonte: W cap. 5, pp. 79-80. Minervini: un titolo che non le rispetta tutte non è candidato, anche con fondamentali ottimi.

| Id | Regola | Soglia | Tipo | Stato |
|----|--------|--------|------|-------|
| TT1 | Prezzo sopra le medie a 150 e 200 giorni | prezzo > SMA150 e SMA200 | calcolo | confermata |
| TT2 | Media 150 sopra la 200 | SMA150 > SMA200 | calcolo | confermata |
| TT3 | Media 200 in salita | almeno 1 mese, meglio 4-5 mesi | calcolo | confermata |
| TT4 | Media 50 sopra 150 e 200 | SMA50 > SMA150 e SMA200 | calcolo | confermata |
| TT5 | Prezzo sopra la media 50 | prezzo > SMA50 | calcolo | confermata |
| TT6 | Distanza dal minimo a 52 settimane | almeno +30% (spesso molto di più) | calcolo | confermata |
| TT7 | Distanza dal massimo a 52 settimane | entro il 25%, meglio vicino | calcolo | confermata |
| TT8 | Forza relativa | rating RS ≥ 70, meglio 80-90. **Decisione:** proxy = percentile del rendimento pesato (ultimo trimestre doppio) rispetto al resto dell'universo S&P 500 | calcolo (proxy) | confermata; proxy già in `lib/minervini.ts` e `lib/scanner.ts` |

Note
- R omette TT8. Decisione presa: percentile sull'S&P 500 al posto del rating IBD, che non abbiamo. Il rendimento pesato è lo stesso schema usato da IBD, ma il numero non coincide con il loro.
- R aggiunge che la linea RS deve fare nuovi massimi dentro la base. Viene da IBD, non da Minervini (vedi RS1).

## 2. Base e VCP

| Id | Regola | Soglia | Tipo | Stato |
|----|--------|--------|------|-------|
| B1 | Durata della base nello stage 2 | di solito 5-26 settimane (W p. 80); coppa con manico 7-25 sett. (W p. 245) | calcolo | confermata |
| B2 | Profondità massima della correzione | di norma 15-20% fino a 35-40%, anche 50% in mercati volatili; oltre il 60% è troppo profonda (W p. 245) | calcolo | confermata |
| B3 | Base piatta (flat) | correzione non oltre 10-15% (W p. 229) | calcolo | confermata |
| B4 | O'Neil: durata minima di una base valida | 7-8 settimane (O) | calcolo | fuori fonte |
| V1 | Numero di contrazioni | da 2 a 6, tipicamente 2-4 (W pp. 197, 201) | calcolo | **diversa**: R dice "minimo 3" |
| V2 | Ogni contrazione più stretta della precedente | circa la metà della precedente, con tolleranza (W p. 199) | calcolo | confermata |
| V3 | Esempi di sequenza | 22/8/2% (W p. 227), 32/14/7/3% (W p. 233), 31/17/…% (W p. 201) | giudizio | confermata, solo orientativa |
| V4 | Volume nell'ultima contrazione | sotto la media a 50 giorni, con 1-2 giorni a volume molto basso, spesso il più basso della base (W p. 225) | calcolo | confermata |
| V5 | Ultima contrazione stretta in prezzo | "molto stretta": esempi 2% e 5% (W pp. 197, 227). R dice range ≤6% negli ultimi 5 giorni | calcolo | **non verificata**: la soglia ≤6% in 5 giorni non è nei libri |
| V6 | Pivot netto | punto di minima offerta dopo l'ultima contrazione; nelle basi piatte il massimo della base (W p. 229) | calcolo | confermata |
| V7 | Cup completion cheat e pivot dentro il manico | punti d'ingresso alternativi (W p. 229) | giudizio | confermata, da modellare dopo |
| V8 | Il titolo non è già "in fuga" | prezzo vicino al pivot, lontano dall'essere esteso | calcolo | confermata a livello qualitativo |

## 3. Ingresso

| Id | Regola | Soglia | Tipo | Stato |
|----|--------|--------|------|-------|
| E1 | Trigger | comprare quando il prezzo rompe il pivot su volume in aumento (W pp. 227-229) | calcolo | confermata |
| E2 | Volume al breakout | "più forte del solito", esempio a metà del volume medio già a metà giornata (W p. 229); C chiede follow-through e breakout non a basso volume. Nessun numero. Il codice usa 1,5× (soglia del report ChatGPT/notebook) | calcolo | confermata, soglia numerica **non verificata** (40-50% è di O'Neil) |
| E3 | Zona d'acquisto sopra il pivot | R dice 0-5%, preferibile 0-2%. Il codice usa 5% (`MAX_CHASE`). C: comprare vicino al punto di stop ("danger point"), lo stop fa parte della selezione | calcolo | **non verificata** come numero; il principio è confermato (C) |
| E4 | Titolo esteso | C: "esteso" = oltre il 10% sopra l'ultimo consolidamento (definizione di David Ryan citata da Minervini); non comprare, aspettare pullback o nuova base | calcolo | **diversa** da R (10% sopra la media 50) e dal codice (5% sopra il pivot) |
| E6 | Dopo il breakout | più giorni di follow-through, più giorni e settimane in rialzo che in calo, volume forte nei giorni in rialzo, chiusure vicine al massimo (C) | giudizio | confermata |
| E7 | Ritorno al livello di breakout | succede nel 40-50% dei casi, è normale se il titolo recupera in pochi giorni o 1-2 settimane (C) | giudizio | confermata |
| E5 | Titolo con volume secco prima del breakout | "tennis ball": ritorno al livello e ripartenza (W p. 237) | giudizio | confermata |

## 4. Rischio, stop e uscite

| Id | Regola | Soglia | Tipo | Stato |
|----|--------|--------|------|-------|
| S1 | Stop deciso prima dell'ingresso | sì, vendita senza esitazione quando scatta (W p. 295) | calcolo | confermata |
| S2 | Perdita massima assoluta | **10%** (W pp. 275, 301); perdita media 6-7% | calcolo | **diversa**: R dice 7-8% (è la regola di O'Neil) |
| S3 | O'Neil: stop 7-8% sotto il prezzo d'acquisto, regola ripetuta più volte nel libro | O, capitoli su vendita e gestione del rischio | calcolo | fuori fonte |
| S4 | Rapporto guadagno/perdita | almeno 2:1, obiettivo 3:1 (W p. 301) | calcolo | confermata |
| S5 | Proteggere il guadagno | quando il guadagno è 3 volte il rischio, stop almeno a pareggio (W pp. 295, 307) | calcolo | confermata |
| S6 | Costruire la posizione a scaglioni | i professionisti scalano in, non fanno la media al ribasso (W p. 307) | giudizio | confermata |
| X1 | Vendere in forza | vendere quando il titolo corre in modo esaurito o ai primi segni di debolezza (W p. 295) | giudizio | confermata |
| X2 | Prendere profitto parziale a +20/25% | O: con stop 7-8%, rapporto 3:1 | calcolo | fuori fonte |
| X3 | Regola delle 8 settimane | se +20% in 3 settimane, tenere 8 settimane (O) | calcolo | fuori fonte |
| X4 | Segnali di distribuzione | calo più forte dall'inizio dello stage 2, gap di esaurimento (W p. 73, O) | giudizio | confermata a livello qualitativo |
| X5 | Segnali di breakout in difficoltà | breakout a basso volume senza follow-through, tre minimi decrescenti su volume in aumento, chiusura sotto la media a 20 giorni su volume alto: insieme, probabilità di successo scarse (C). Se scatta lo stop si vende subito | calcolo | confermata (C); sostituisce il "fast failure" di R, che è **non verificata** |
| S7 | Mercato difficile | stringere gli stop, per esempio da 7-8% a 5-6% (C) | calcolo | confermata |
| S8 | Stop e punto d'ingresso | si controlla il rischio quando si compra, non quando si vende; ingresso il più vicino possibile allo stop (C) | giudizio | confermata |

## 5. Forza relativa e mercato

| Id | Regola | Soglia | Tipo | Stato |
|----|--------|--------|------|-------|
| RS1 | Linea RS in salita, meglio nuovi massimi dentro la base | rapporto titolo/SPY | calcolo | **non verificata** come regola Minervini (viene da IBD, R) |
| RS2 | Tenuta della RS nei cali di mercato | la RS dei titoli forti migliora mentre il mercato scende (W p. 167) | giudizio | confermata |
| M1 | Il mercato deve assecondare | senza trend di mercato a favore si perdono molte opportunità (W p. 165) | giudizio | confermata a livello qualitativo |
| M2 | Tre stati e distribution day | R: uptrend confermato, sotto pressione, correzione; ≥5 distribution day in 25 sedute | calcolo | **non verificata** (IBD) |

## 6. Fondamentali

| Id | Regola | Soglia | Tipo | Stato |
|----|--------|--------|------|-------|
| F1 | Accelerazione di utili e ricavi | esempio W p. 101: ricavi 11→16→19%, utili 36→38→58% | esterno | confermata come criterio, **senza soglia minima fissa** |
| F2 | EPS q/q ≥ 25%, ricavi q/q ≥ 25%, ROE ≥ 17% | CAN SLIM (R) | esterno | fuori fonte / **non verificata** per Minervini |
| F3 | Filtri liquidità: prezzo ≥ 10 $, volume ≥ 500k, controvalore ≥ 20 M$ | R li dichiara "house rules" | calcolo | **non verificata**, scelta nostra |

## 7. Moduli fuori dal metodo Minervini

- **Anchored VWAP** (Shannon): R lo integra come filtro di conferma. Nessun libro Minervini lo usa. **Decisione:** modulo opzionale, spento di default, separato dal punteggio Minervini. L'AI lo menziona solo se attivato.
- **Ciclo di vita IPO** (*Lifecycle Trade*): non spogliato.
- **Darvas, Oliver Kell, Mindset**: nel notebook ci sono solo riassunti AI, non i libri.

## Copertura nel codice oggi (`lib/minervini.ts`)

| Regola | Stato nel codice |
|--------|------------------|
| TT1-TT8 | Coperte. TT8 con percentile sui pari (`weightedReturn`, `percentileRank`, soglia 70) |
| V1 | Coperta: almeno 2 contrazioni sempre più strette, come nel libro (2-6) |
| V2 | Coperta come misura: `describeBase` calcola i rapporti tra contrazioni e `halves` (ogni rapporto ≤ 0,75, tolleranza nostra su "circa la metà"). Non blocca il VCP, va all'AI |
| V4 | Parziale: ultime 10 sedute sotto la media a 50 giorni e al massimo 2 giorni di distribuzione. Non cerca il giorno di volume minimo |
| V5 | `MAX_LAST_CONTRACTION = 7%` (era 10%). I libri portano esempi di 2-5%, ma gli swing sono confermati a 5%, quindi contrazioni più strette non si vedono. `base.tightness` misura ora il range delle ultime 5 chiusure prima di oggi, senza soglia perché i libri non ne danno una |
| V6 | Coperta: pivot = massimo prima dell'ultimo pullback, corretto dai tentativi falliti |
| B1, B2 | Coperte come misura: `base.weeks` (5-26 sett.) e `base.depth` (tetto 50%), con `weeksOk` e `depthOk`. Non bloccano il VCP, vanno all'AI |
| B3 | Non coperta: la base piatta (≤10-15%) non è distinta dal VCP |
| E2 | `BREAKOUT_VOLUME = 1,5`: soglia del report ChatGPT/notebook, non dei libri di Minervini |
| E3, E4 | `MAX_CHASE = 5%`, scelta nostra tenuta: zona d'acquisto 0-5% e "Troppo tardi" oltre. Più prudente del libro, dove "esteso" è oltre il 10% |
| S2 | `STOP_BELOW_PIVOT = 8%`, scelta nostra tenuta: coerente con R e O'Neil, più prudente del massimo 10% di Minervini |
| S4 | Parziale: `riskReward(entry, stop, target)` calcola il rapporto, ma non è ancora collegata a un obiettivo di prezzo |
| S5, X1-X5, S6-S8 | Non coperte |
| RS1, M1, M2, F1-F3 | Non coperte |

## Cosa resta da fare prima di usarlo

1. ~~Rivedere le tre soglie che divergono dai libri.~~ Fatto: ultima contrazione portata a 7%; zona d'acquisto 5% e stop 8% tenuti perché più prudenti del libro.
2. ~~Aggiungere le misure di base, rapporto tra contrazioni, tenuta finale e rapporto rischio/rendimento.~~ Fatto in `lib/minervini.ts` (`describeBase`, `riskReward`, campo `Vcp.base`). Restano B3, S5 e le uscite.
3. Il sottoinsieme `giudizio` (V3, V7, E5-E7, X1, X4, S6, S8) va all'AI con i numeri del codice e il rulebook come riferimento.
4. Spogliare ancora **W** per i capitoli su vendita e tempismo, e **C** per le sezioni su sizing e uscite.

## Differenze principali con il report ChatGPT

Il report è fedele sul Trend Template, ma altrove attribuisce a Minervini soglie che non sono sue:

| Punto | Report | Libri |
|-------|--------|-------|
| Contrazioni | minimo 3 | da 2 a 6, di solito 2-4 |
| Stop | 7-8% | massimo 10%, media 6-7% (7-8% è di O'Neil) |
| Range ultimi 5 giorni | ≤ 6% | non presente |
| Zona d'acquisto | 0-5% sopra il pivot | non trovata; "esteso" = oltre 10% sopra il consolidamento (C) |
| RS | linea RS ai massimi | solo rating ≥70 nel Trend Template |
