# Scheda titolo: dividendi — Design

## Contesto

Sotto-progetto 3 di 4 nati dall'analisi della scheda strumento di
Forecaster terminal. Il sotto-progetto 3 originale (fondamentali extra
solo USA) è stato scomposto in quattro parti:

- **3a, questo spec**: dividendi.
- 3b Beneish M-Score, 3c overlay dei fondamentali sul grafico prezzo,
  3d ricavi per segmento: spec separati, non ancora iniziati. 3d
  richiede prima uno spike di fattibilità, perché l'API SEC
  `companyfacts` non include i dati per segmento.

Oggi i dividendi compaiono solo come rendimento e payout nello snapshot
(`dividendYield`, `payoutRatio`, mostrati in `FundamentalsGrid`). Manca
lo storico dei pagamenti.

## Obiettivo

L'app serve a decidere se e quando entrare su un titolo in watchlist.
Per chi cerca reddito, due domande restano senza risposta: il titolo
paga con regolarità e da quanto, e il dividendo cresce o è stato
tagliato.

Obiettivo: una nuova tab "Dividendi" che lo dice in una frase e in due
blocchi. Vale per tutti i titoli in watchlist, USA e italiani: la fonte
è Yahoo, non SEC.

## Decisioni prese

- **Posizione**: nuova tab "Dividendi" subito dopo "Stagionalità".
- **Blocchi**: riepilogo con storico per anno; crescita. Fuori da questo
  spec: copertura del payout su utile e cassa, rendimento totale con
  dividendi reinvestiti (vedi "Fuori da questo spec").
- **Titoli**: tutti. Gli importi sono nella valuta del titolo come la
  riporta Yahoo.
- **Dati**: scaricati al volo da Yahoo, cache in memoria, nessuna
  tabella nuova e nessuna migrazione.
- **Funzione separata**: `getDividendHistory` fa una richiesta propria.
  Non si tocca `getFullPriceHistory` né la sua cache, già usati dalle
  tab Andamento e Stagionalità.
- **Grafici**: SVG scritti a mano, nessuna libreria nuova.

## Dati

Nuova funzione `getDividendHistory(symbol)` in `lib/dividends.ts`:

- Chiama `v8/finance/chart` con `range=max&interval=1mo&events=div`,
  con gli stessi header delle altre chiamate Yahoo di `lib/history.ts`.
- Legge `chart.result[0].events.dividends` (oggetto con chiave il
  timestamp; ogni voce ha `amount` e `date` in secondi) e
  `chart.result[0].meta.currency`.
- Restituisce `DividendHistory { payments, currency }`: `payments` è un
  `DividendPayment[]` (`t` in millisecondi, `amount`) in ordine
  cronologico; `currency` è il codice valuta oppure `null`. Scarta
  importi non numerici o non positivi; due pagamenti con la stessa data
  restano uno, l'ultimo.
- Se Yahoo risponde ma non c'è `events.dividends`, restituisce
  `payments` vuoto: il titolo non distribuisce dividendi.
- Cache in memoria per simbolo, 6 ore. In caso di errore o risposta non
  valida restituisce l'ultima copia in cache, altrimenti `null`. Non
  lancia eccezioni. `null` significa "dati non disponibili", `payments`
  vuoto significa "nessun dividendo": la tab li distingue.

Punti da verificare come primo passo dell'implementazione, con una
richiesta reale (per esempio KO, e un titolo `.MI`):

1. Yahoo restituisce `events.dividends` con `interval=1mo` e
   `range=max`, su tutto lo storico.
2. Gli importi sono già rettificati per gli split. Se non lo sono, si
   aggiunge `events=div,split` e si rettificano gli importi con i
   rapporti di split letti dalla stessa risposta.
3. La valuta in `meta.currency` per i titoli `.MI` è `EUR`.

Se il punto 1 fallisce, il design va rivisto prima del piano.

## Calcoli

Stesso file `lib/dividends.ts`. Funzioni pure: ricevono i pagamenti,
la data di riferimento `now` e il prezzo; non fanno rete e non leggono
l'orologio. Date in UTC.

`dividendSummary(payments, now, price)` restituisce `null` senza
pagamenti, altrimenti:

### Anni

Un anno è **completo** se è dopo l'anno del primo pagamento e prima
dell'anno di `now`. L'anno del primo pagamento e l'anno in corso sono
**parziali**.

`years`: una voce per ogni anno dal primo pagamento all'anno di `now`,
in ordine crescente: `{ year, total, count, partial }`, dove `total` è
la somma degli importi dell'anno e `count` il numero di pagamenti. Gli
anni senza pagamenti compresi nell'intervallo hanno `total` 0 e `count`
0.

### Ultimo pagamento e rendimento

- `lastPayment`: `{ t, amount }` dell'ultimo pagamento con data
  minore o uguale a `now`.
- `ttmTotal`: somma dei pagamenti con data nei 365 giorni che finiscono
  a `now`.
- `yieldPct`: `ttmTotal` / `price` in percentuale; `null` se `price` è
  nullo o non positivo.

### Frequenza

Mediana del numero di pagamenti per anno sugli ultimi 3 anni completi
(meno se non ce ne sono 3). Mediana 10 o più: mensile; da 3 a 5:
trimestrale; 2: semestrale; 1: annuale; ogni altro valore, compresi 0 e
da 6 a 9: irregolare. Senza anni completi la frequenza è `null`.

### Sospeso

`suspended` è vero se i giorni tra l'ultimo pagamento e `now` superano
1,5 volte l'intervallo tipico: 365 / 12, 365 / 4, 365 / 2, 365 giorni
per mensile, trimestrale, semestrale, annuale; 400 giorni come soglia
fissa per irregolare e per frequenza `null`.

### Crescita

Calcolata solo sugli anni completi, sui totali annuali:

- `consecutiveIncreases`: da ultimo anno completo all'indietro, quanti
  anni di fila il totale supera quello dell'anno completo precedente.
- `cagr5Pct`, `cagr10Pct`: crescita annua media composta tra il totale
  dell'ultimo anno completo e quello di 5 (o 10) anni prima, in
  percentuale. Esiste solo se entrambi gli anni sono completi e hanno
  totale positivo; altrimenti `null`.
- `cutYears`: anni completi il cui totale è sotto il 95% di quello
  dell'anno completo precedente, in ordine crescente. La soglia evita
  che un cambio di arrotondamento o di cambio valuta conti come taglio.
- `completeYears`: numero di anni completi, per decidere se mostrare il
  blocco.

Il totale annuale include i dividendi straordinari: Yahoo non li
distingue dagli ordinari. Un anno con un pagamento speciale può
risultare un aumento seguito da un taglio. La nota in fondo lo dice.

## Interfaccia

Nuova voce in `StockTabs` in `app/stock/[symbol]/page.tsx`, dopo
"Stagionalità", con contenuto `DividendsPanel`. La pagina chiama
`getDividendHistory(symbol)` insieme agli altri caricamenti e passa il
risultato, il prezzo dell'ultimo snapshot (o `null`) e `now`, già
disponibile.

`DividendsPanel` è un componente server: chiama `dividendSummary` e
compone i blocchi. Dall'alto:

1. **Frase di riepilogo**. Esempi:
   "Paga ogni trimestre. Ultimo dividendo 0,51 $ il 14 novembre 2026,
   rendimento 3,1% sugli ultimi 12 mesi." Se `suspended`: "Dividendo
   sospeso: l'ultimo pagamento è stato di 0,20 $ il 3 marzo 2023." Senza
   frequenza (nessun anno completo) la prima frase è omessa; senza
   rendimento la sua parte è omessa. Frequenze: mensile "ogni mese",
   trimestrale "ogni trimestre", semestrale "due volte l'anno", annuale
   "una volta l'anno", irregolare "senza cadenza regolare".
2. **Storico per anno** (`DividendYearsChart`): barre verticali del
   totale per azione per anno, ultimi 15 anni; anni parziali attenuati
   e con la dicitura "parziale" nel tooltip e nell'etichetta
   accessibile; un anno senza pagamenti non ha barra. Il tooltip mostra
   anno, totale e numero di pagamenti.
3. **Crescita**: riquadri "Anni consecutivi di aumento", "Crescita
   annua media 5 anni", "Crescita annua media 10 anni"; sotto, i tagli:
   "Tagli: 2009, 2020" oppure "Nessun taglio dal 2012" (primo anno
   completo). I riquadri senza valore non compaiono. Il blocco è
   nascosto con meno di 2 anni completi.

Importi formattati con `toLocaleString('it-IT', { style: 'currency',
currency, currencyDisplay: 'narrowSymbol' })`, da 2 a 4 decimali; senza
valuta, numero semplice. La crescita annua usa `formatPct` di
`lib/performance.ts` (con segno). Il rendimento è un numero senza segno
con un decimale, formato `it-IT` (per esempio "3,1%"). Date `it-IT`.

In fondo, una nota: importi per azione nella valuta del titolo,
dividendi straordinari inclusi, fonte Yahoo Finance; i dividendi
passati non garantiscono quelli futuri.

Ogni grafico ha un `aria-label` che ne riassume il contenuto. Layout
leggibile a larghezza telefono, senza scorrimento orizzontale della
pagina. Colori solo dai token di `app/globals.css`.

## Casi limite

- **Nessun dividendo** (`payments` vuoto): la tab mostra "Questo titolo
  non distribuisce dividendi."
- **Yahoo non risponde e cache vuota** (`null`): la tab mostra "Dati sui
  dividendi non disponibili al momento." Il resto della scheda funziona.
- **Un solo pagamento, o primo anno in corso**: nessun anno completo;
  frase senza frequenza, grafico con le barre parziali, blocco crescita
  nascosto.
- **Dividendo sospeso**: la frase lo dice e non mostra il rendimento.
- **Anni senza pagamenti nel mezzo**: barra assente. Un anno a zero
  dopo un anno con pagamenti conta come taglio; l'anno a zero che segue
  un altro anno a zero no, e il primo anno con pagamenti dopo la pausa
  conta come aumento.
- **Prezzo mancante**: la frase omette il rendimento.
- **Dividendo straordinario**: incluso nei totali, avvertito nella nota.
- **Valuta mancante**: importi senza simbolo.
- **Valuta in pence** (`GBp`, titoli di Londra): l'importo è mostrato
  come numero seguito da "p", mai come sterline.
- **Più pagamenti nella stessa data**: contati una volta, l'ultimo.

## Test

Vitest, scritti prima del codice.

- `lib/dividends.ts`, su pagamenti costruiti a mano: parsing della
  risposta Yahoo simulata (importi non positivi e non numerici scartati,
  ordine, stessa data, valuta, `events` assente, errore HTTP con e senza
  cache, risposta malformata); anni completi e parziali; anni vuoti
  nel mezzo; rendimento sugli ultimi 12 mesi e prezzo nullo; frequenza
  mensile, trimestrale, semestrale, annuale e irregolare; sospeso con
  soglia al limite; anni consecutivi di aumento e interruzione; crescita
  composta a 5 e 10 anni e mancanza degli anni; taglio sotto soglia e
  variazione del 4% che non conta; un solo pagamento; serie vuota.
- Componenti: frase attesa per titolo trimestrale, sospeso, senza
  rendimento e senza frequenza; barre per anno con anno parziale e anno
  vuoto; riquadri di crescita presenti o assenti; i tre messaggi
  (nessun dividendo, dati non disponibili) e la nota.

## Fuori da questo spec

- Copertura del dividendo (payout su utile e cassa dai bilanci).
- Rendimento totale con dividendi reinvestiti e confronto con il solo
  prezzo.
- Calendario di stacco e data del prossimo pagamento.
- Distinzione automatica dei dividendi straordinari.
- Ritenute fiscali e dividendi in valuta diversa da quella di quotazione.
- Beneish M-Score, overlay dei fondamentali sul grafico, ricavi per
  segmento (3b, 3c, 3d); indicatori tecnici (sotto-progetto 4).
