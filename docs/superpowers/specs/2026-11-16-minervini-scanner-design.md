# Scanner Minervini — Design

## Obiettivo
Trovare, fuori dalla watchlist, i titoli che soddisfano il Trend Template di Minervini, per decidere cosa guardare e cosa aggiungere. La scansione copre l'S&P 500, parte con un click dalla pagina `/scanner` e salva i risultati nel DB. Corrisponde al task 33 di `auditcalc.md`.

Successo: dopo un click e 2–3 minuti la pagina elenca i titoli che superano 8 criteri su 8, ordinati per forza relativa, con stato VCP e distanza dal pivot; l'utente legge in pagina che cosa lo scanner controlla e con quali limiti.

## Decisioni prese
- **Universo**: S&P 500 (circa 500 titoli). L'elenco sta in un file del repo, quindi passare a un universo più ampio significa solo caricare un'altra lista.
- **Avvio**: click sul pulsante. Nessun job automatico.
- **Esecuzione**: a blocchi guidati dalla pagina; lo stato sta nel DB e la scansione è riprendibile.
- **Contenuto**: Trend Template, forza relativa (RS) e VCP. Niente fondamentali.
- **Formule**: nessuna nuova. Si riusano `weightedReturn`, `percentileRank`, `evaluateTrendTemplate` e `detectVcp` di `lib/minervini.ts`.

## Dati

### Universo
- `data/sp500.json`: array di `{ symbol, name, sector }`.
- `scripts/update-universe.ts`: rigenera il file da un dataset pubblico dei componenti dell'indice. Si lancia a mano quando l'indice cambia.
- `lib/universe.ts`: legge il file e converte il simbolo per Yahoo (`BRK.B` diventa `BRK-B`). In pagina resta il simbolo originale.

### Schema Prisma
```prisma
model ScanRun {
  id          String       @id @default(cuid())
  status      String       // 'running' | 'done'
  total       Int
  cursor      Int          @default(0)
  unreadCount Int          @default(0)
  startedAt   DateTime     @default(now())
  finishedAt  DateTime?
  results     ScanResult[]
}

model ScanResult {
  id               String   @id @default(cuid())
  runId            String
  run              ScanRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  symbol           String
  name             String
  sector           String?
  status           String   // 'ok' | 'unread'
  price            Float?
  barDate          DateTime?
  weightedReturn   Float?
  criteria         Json?    // i 7 criteri che non dipendono da RS: { id, label, ok, value }
  rs               Float?   // scritto dal passo finale
  passedCount      Int?     // su 8, scritto dal passo finale
  vcpStatus        String?
  pivot            Float?
  pivotDistancePct Float?
  contractions     Json?
  volumeDryUp      Boolean?

  @@unique([runId, symbol])
  @@index([runId, passedCount])
}
```
Si conservano le ultime 2 scansioni complete. Il passo finale cancella le più vecchie.

## Logica: `lib/scanner.ts`
Funzioni pure, senza I/O:
- `scanSymbol(bars)`: restituisce `null` se lo storico non basta (meno di 253 barre, il minimo per `weightedReturn`). Altrimenti restituisce prezzo, data dell'ultima barra, `weightedReturn`, i primi 7 criteri di `evaluateTrendTemplate(bars, null)` e l'esito di `detectVcp` con la distanza percentuale del prezzo dal pivot.
- `finalize(rows)`: per ogni riga letta calcola `rs = percentileRank(rendimento, rendimenti di tutte le righe lette)` e `passedCount = criteri superati tra i 7 + (rs >= RS_MIN ? 1 : 0)`. Le righe `unread` restano fuori dal calcolo.

`RS_MIN = 70` diventa una costante esportata da `lib/minervini.ts`, usata sia da `evaluateTrendTemplate` sia da `finalize`.

Accesso al DB e a Yahoo, in `lib/scanner-run.ts`:
- `startRun()`: crea o riprende la scansione.
- `stepRun(runId)`: elabora un blocco e, all'ultimo, chiude la scansione.
- `latestCompleteRun()`: dati per la pagina.

## Route
- `POST /api/scanner`
  - Esiste una scansione `running`: la restituisce (ripresa).
  - L'ultima scansione `done` è finita da meno di 1 ora: risponde 429 con l'ora in cui si potrà rilanciare.
  - Altrimenti crea `ScanRun` con `total` pari alla lunghezza dell'universo.
  - Risposta: `{ runId, cursor, total, status }`.
- `POST /api/scanner/step` con `{ runId }`
  - Prende 25 titoli dal cursore e chiama `getDailyBars` con 5 richieste in parallelo. Un titolo senza barre viene ritentato una volta.
  - Scrive le righe `ScanResult` (`ok` oppure `unread`) con `createMany` e `skipDuplicates`.
  - Avanza il cursore con `updateMany` condizionato al valore letto: se un'altra scheda ha già elaborato il blocco, l'aggiornamento non tocca righe e la route restituisce lo stato corrente senza scrivere altro.
  - Quando il cursore raggiunge `total`: esegue `finalize`, aggiorna le righe, imposta `status = 'done'`, `finishedAt` e `unreadCount`, cancella le scansioni vecchie.
  - `maxDuration = 60`. Risposta: `{ cursor, total, status }`.

Stima: 20 blocchi, 2–3 minuti in totale.

Le route non hanno autenticazione, come il resto dell'app (task 4 di `auditcalc.md`). Il blocco "una scansione alla volta" e l'attesa di 1 ora limitano l'abuso.

## Pagina `/scanner`
Voce "Scanner" in `SiteNav`. La pagina è un server component che legge l'ultima scansione completa; il pulsante è un client component.

### Testata
- Data e ora dell'ultima scansione, titoli letti e non letti.
- `ScanButton`: "Avvia scansione". Al click chiama `POST /api/scanner`, poi `POST /api/scanner/step` in sequenza finché lo stato è `done`, mostrando una barra di avanzamento ("175 di 503"). Alla fine esegue `router.refresh()`.
- Se al caricamento esiste una scansione `running`, il pulsante dice "Riprendi scansione".
- Durante una scansione la tabella continua a mostrare l'ultima completa.

### Cosa comprende lo scanner
Riquadro sempre visibile sotto la testata, in linguaggio semplice:
- **Dove cerca**: i circa 500 titoli dell'S&P 500, le maggiori società quotate negli Stati Uniti. Titoli più piccoli e mercati non USA restano fuori.
- **Cosa controlla**: gli 8 criteri del Trend Template, elencati uno per uno con le stesse etichette usate nella scheda titolo (prezzo sopra le medie a 150 e 200 giorni; media a 150 sopra quella a 200; media a 200 in salita da almeno un mese; media a 50 sopra le altre due; prezzo sopra la media a 50; almeno 30% sopra il minimo dell'anno; al massimo 25% sotto il massimo dell'anno; forza relativa almeno 70).
- **Forza relativa**: posizione del titolo da 0 a 100 rispetto a tutti gli altri titoli scansionati, sul rendimento degli ultimi 12 mesi con peso doppio all'ultimo trimestre. È un'approssimazione del rating IBD, non lo stesso numero.
- **VCP**: ricerca automatica di contrazioni di prezzo sempre più strette, con livello di pivot. Indica candidati da verificare sul grafico, non segnali di acquisto.
- **Cosa non controlla**: utili, ricavi e altri fondamentali; notizie; liquidità. Si trovano nella scheda del titolo.
- **Dati**: prezzi giornalieri degli ultimi 2 anni da Yahoo Finance. Una scansione a mercato aperto usa la barra di oggi ancora incompleta.
- Avviso "non è consulenza finanziaria", come nel resto dell'app.

Le etichette dei criteri arrivano da `lib/minervini.ts`, non sono riscritte nella pagina.

### Risultati
- **Trend Template 8/8**, ordinati per RS decrescente. Colonne: simbolo, nome, settore, prezzo, RS, stato VCP, pivot, distanza dal pivot. La riga porta a `/stock/[symbol]`, dove l'anteprima permette già di aggiungere il titolo alla watchlist.
- **Quasi (7/8)**: stesse colonne più il criterio mancante.
- Filtro "solo VCP in formazione o breakout", lato client.
- Nessuna scansione ancora eseguita: stato vuoto con invito al click.

## Gestione errori
- Yahoo fallisce su un titolo anche al secondo tentativo, oppure lo storico è troppo corto: riga `unread`, la scansione continua.
- Non letti oltre il 10%: la scansione chiude comunque e la pagina mostra "dati parziali: forza relativa meno affidabile".
- Scheda chiusa a metà: la scansione resta `running` e un nuovo click la riprende dal cursore.
- Errore di una chiamata `step`: il pulsante mostra l'errore e "Riprendi"; nessun dato va perso perché il cursore avanza solo dopo la scrittura.

## Test (vitest)
- `lib/scanner.test.ts`: `scanSymbol` su serie sintetiche (trend rialzista, ribassista, storico corto); `finalize` (percentile, soglia 70, righe `unread` escluse, conteggio su 8).
- `lib/universe.test.ts`: conversione dei simboli, file senza duplicati.
- Route sul DB di test con `getDailyBars` simulato: avvio, ripresa di una scansione in corso, attesa minima (429), blocco doppio da due schede, chiusura con `finalize`, pulizia delle scansioni vecchie.

## Fuori scope
- Fondamentali Minervini (crescita di utili e ricavi trimestrali).
- Autenticazione delle route (task 4).
- Correzioni al rilevamento VCP (task 17): lo scanner eredita i limiti attuali.
- RS della scheda titolo calcolato sull'universo dello scanner (task 16): passo successivo.
- Avvio automatico da cron, universi diversi dall'S&P 500, alert.
