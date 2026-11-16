# Scheda titolo: storico lungo, performance e drawdown — Design

## Contesto

Sotto-progetto 1 di 4 nati dall'analisi delle funzionalità della scheda
strumento di Forecaster terminal. I quattro sotto-progetti, in ordine:

1. **Questo spec**: storico prezzi completo, performance per periodo,
   rendimento anno per anno, drawdown.
2. Stagionalità (curva media, tabella per anno, medie per mese e per
   giorno della settimana, anni elettorali). Riusa lo storico di questo
   spec.
3. Fondamentali extra (Beneish M-Score, dividendi, ricavi per segmento,
   overlay dei fondamentali sul grafico prezzo). Solo titoli USA.
4. Tecnici (ipercomprato/ipervenduto, pattern storici simili), con
   formule nostre. Riusa lo storico di questo spec.

Questo spec riguarda solo il punto 1.

## Obiettivo

L'app serve a decidere se e quando entrare su un titolo in watchlist.
Oggi la scheda titolo mostra al massimo un anno di prezzi
(`getPriceHistory` in `lib/history.ts`), quindi non risponde a tre
domande: quanto ha reso il titolo sugli orizzonti lunghi, quanto è
irregolare da un anno all'altro, quanto è sotto i massimi adesso
rispetto ai suoi crolli passati.

Obiettivo: una nuova tab "Andamento" nella scheda titolo che risponde a
queste tre domande, più i range lunghi sul grafico prezzo esistente.
Vale per titoli USA e italiani: servono solo i prezzi.

## Decisioni prese

- **Posizione**: nuova tab "Andamento" accanto a Valutazione, Bilanci,
  Insider e politici, Notizie e video.
- **Prezzo di riferimento**: chiusura corretta per gli split, senza
  dividendi. I numeri restano confrontabili con il grafico e con gli
  altri siti. I dividendi sono materia del sotto-progetto 3.
- **Dati**: scaricati al volo da Yahoo, cache in memoria, nessuna
  tabella nuova e nessuna migrazione.
- **Grafici**: SVG scritti a mano come il resto dell'app, nessuna
  libreria nuova.

## Dati

Nuova funzione `getFullPriceHistory(symbol)` in `lib/history.ts`:

- Chiama l'endpoint Yahoo `v8/finance/chart` già usato, con
  `interval=1d` e date esplicite `period1=0` e `period2=<adesso>`.
- Restituisce `FullHistory { points, sparseBefore }`: `points` è un
  `PricePoint[]` (`t` in millisecondi, `close`) in ordine cronologico;
  `sparseBefore` è la data prima della quale i dati sono più radi del
  giornaliero, oppure `null` se tutta la serie è giornaliera. Scarta i
  giorni senza chiusura numerica o con chiusura non positiva. Usa il campo
  `close` della risposta, che Yahoo fornisce già corretto per gli
  split; non usa `adjclose`, che include i dividendi.
- Cache in memoria per simbolo, durata 6 ore. In caso di errore o
  risposta non valida restituisce l'ultima serie in cache, altrimenti
  lista vuota. Non lancia eccezioni.
- `getPriceHistory` (1 anno) e `getIntradayHistory` restano invariate.

Punto da verificare come primo passo dell'implementazione: una prova
manuale con `range=max&interval=1d` ha restituito dati mensili (335
punti in 27 anni per NVDA). La richiesta con date esplicite non è
ancora stata provata. Se Yahoo non restituisce il giornaliero su tutto
lo storico, la funzione unisce due richieste: giornaliero sugli ultimi
10 anni (`range=10y`) e la serie più rada per il periodo precedente. I
calcoli sotto funzionano su serie a passo irregolare, quindi non
cambiano.

## Calcoli

Nuovo file `lib/performance.ts`. Solo funzioni pure: ricevono
`PricePoint[]` e, dove serve, la data di riferimento; non fanno rete e
non leggono l'orologio.

### Performance per periodo

`periodReturns(points, now)` restituisce una voce per ciascun periodo:
1 mese, 6 mesi, da inizio anno, 1 anno, 3 anni, 5 anni, 10 anni,
20 anni, tutto lo storico.

- Rendimento = ultima chiusura / chiusura di riferimento − 1.
- Chiusura di riferimento: l'ultimo punto con data minore o uguale alla
  data di partenza del periodo (stessa data di calendario N mesi o anni
  prima di `now`).
- Da inizio anno: riferimento è l'ultima chiusura dell'anno solare
  precedente.
- Tutto lo storico: riferimento è il primo punto della serie.
- Se la serie inizia dopo la data di partenza del periodo, il periodo
  viene omesso dal risultato. "Tutto lo storico" è sempre presente se
  ci sono almeno due punti.

### Rendimento per anno solare

`yearlyReturns(points, now)` restituisce una voce per ogni anno coperto
dalla serie: `{ year, returnPct, partial }`.

- Rendimento = ultima chiusura dell'anno / ultima chiusura dell'anno
  precedente − 1.
- Primo anno della serie: il riferimento è la prima chiusura
  disponibile, e la voce è `partial: true`.
- Anno in corso (anno di `now`): `partial: true`.

### Drawdown

`drawdownSeries(points)` restituisce per ogni punto
`{ t, drawdownPct }`, dove drawdown = chiusura / massimo raggiunto fino
a quel punto − 1 (zero o negativo).

`drawdownSummary(points, now)` restituisce:

- drawdown attuale e data del massimo da cui si misura;
- giorni di calendario trascorsi da quel massimo;
- drawdown massimo storico, con data del picco e data del minimo.

Restituisce `null` con meno di due punti.

### Riduzione della serie

`downsample(points, now)` produce la serie da inviare al browser:
tutti i punti degli ultimi 5 anni, e un punto per settimana (l'ultima
chiusura della settimana) per il periodo precedente. Performance,
rendimenti annuali e riepilogo drawdown sono calcolati sul server
sulla serie completa, non su quella ridotta.

## Interfaccia

### Grafico prezzo esistente

`components/PriceHistoryChart.tsx` guadagna i range `5A`, `10A` e
`Max` dopo `1A`. Riceve una nuova prop opzionale con la serie lunga
ridotta; i range fino a `1A` continuano a usare i dati di oggi. Se la
serie lunga è vuota o più corta del range, il bottone di quel range non
compare (stesso criterio già usato per `1G`). Le due pagine che usano
il componente (`app/stock/[symbol]/page.tsx`, due punti) passano la
nuova prop.

### Tab "Andamento"

Nuova voce in `StockTabs` nella scheda titolo, dopo "Valutazione". Tre
blocchi, ciascuno un componente:

1. **Performance per periodo** (`PerformanceTiles`): un riquadro per
   periodo con etichetta e percentuale, verde se positiva, rossa se
   negativa. I periodi omessi dal calcolo non compaiono.
2. **Anno per anno** (`YearlyReturnsChart`): barre verticali, una per
   anno, verdi o rosse, con linea dello zero. Le barre parziali hanno
   stile attenuato e la dicitura "parziale" nell'etichetta accessibile
   e nel tooltip.
3. **Drawdown** (`DrawdownChart`): grafico ad area sotto lo zero su
   tutto lo storico, preceduto da una frase di riepilogo. Esempio:
   "Ora a −25% dal massimo del 3 ottobre 2026 (43 giorni fa). Crollo
   peggiore: −66%, da novembre 2021 a ottobre 2022." Se il titolo è sui
   massimi: "Sui massimi storici."

Sotto i tre blocchi, una nota: prezzi corretti per gli split, dividendi
esclusi, fonte Yahoo Finance. Se `sparseBefore` non è `null`, la nota
avvisa che prima di quella data i dati sono meno fitti dei giornalieri
e che i crolli di quel periodo possono risultare meno profondi.

Testi in italiano, date e numeri formattati `it-IT` come nel resto
dell'app. Ogni grafico ha un `aria-label` che ne riassume il contenuto.
Layout leggibile a larghezza telefono, senza scorrimento orizzontale
della pagina.

## Casi limite

- **Yahoo non risponde e cache vuota**: la tab mostra "Storico non
  disponibile al momento." Il resto della scheda funziona; i range
  lunghi del grafico in alto non compaiono.
- **Titolo quotato da poco**: i periodi più lunghi dello storico sono
  omessi. Con meno di due punti la tab mostra il messaggio di storico
  non disponibile.
- **Anno di quotazione e anno in corso**: barre segnate come parziali.
- **Giorni senza chiusura** (valori nulli nella risposta Yahoo):
  scartati in fase di parsing.
- **Storico a passo misto** (giornaliero recente, più rado prima): i
  calcoli usano le date dei punti, non il loro indice.

## Test

Vitest, scritti prima del codice.

- `lib/performance.ts`: serie costruite a mano per salita costante,
  crollo e recupero, titolo sui massimi, storico più corto di un
  periodo, anno parziale iniziale e in corso, serie a passo misto,
  serie vuota e con un solo punto.
- `getFullPriceHistory`: risposta Yahoo simulata (parsing, scarto dei
  nulli, ordine), errore HTTP con e senza cache, risposta malformata.
- Componenti: i tre blocchi della tab rendono i valori attesi, omettono
  i periodi mancanti e mostrano il messaggio di storico non
  disponibile; `PriceHistoryChart` mostra i range lunghi solo quando la
  serie lunga li copre.

## Fuori da questo spec

- Stagionalità, dividendi e rendimento totale, overlay dei
  fondamentali, indicatori tecnici (sotto-progetti 2, 3, 4).
- Salvataggio dello storico nel database.
- Confronto con un indice di riferimento.
