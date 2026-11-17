# Avvisi email dello scanner Minervini — Design

## Obiettivo
Avvisare l'utente per email quando un titolo raggiunge tutti gli 8 criteri del Trend Template, con tutte le informazioni per decidere (verdetto, prezzi di acquisto, stop e profitto, forza relativa, pivot, volume, salute del mercato). L'utente può attivare l'avviso su un singolo titolo e può attivare un avviso generale sui nuovi 8 su 8. La scansione serale parte da sola, così l'avviso arriva anche se l'utente non apre l'app. In più: skeleton di caricamento della pagina `/scanner`.

Successo: l'utente clicca la busta su un titolo "Quasi, 7 su 8"; la sera dopo la chiusura USA, se quel titolo è arrivato a 8 su 8, riceve una sola email con un blocco leggibile da telefono; la busta si spegne da sola. Se ha attivato l'interruttore globale, la stessa email elenca anche i titoli entrati negli 8 su 8 da quando l'ha attivato.

## Decisioni prese
- **Ambito dell'icona**: entrambi. Busta per titolo e interruttore globale.
- **Scansione**: automatica ogni sera lun–ven alle 22:00 UTC (dopo la chiusura USA in ora legale e solare) e resta il click manuale. Gli avvisi si valutano quando una scansione si chiude, comunque sia partita.
- **Email**: HTML con testo semplice di riserva, una sola email per scansione con tutti i titoli che fanno scattare un avviso.
- **Destinatario**: l'indirizzo già configurato (`ALERT_EMAIL_TO`), invio con `sendEmail()` esistente. App a utente singolo, nessun account.
- **Condizione**: 8 criteri su 8. L'email riporta anche il verdetto (può essere "Nessun punto d'ingresso" o "Troppo tardi").
- **Busta solo sulle righe "Quasi, 7 su 8"**: i titoli già 8 su 8 hanno già raggiunto il traguardo.
- **Avviso una volta sola** per titolo: dopo l'invio la busta si spegne; per riarmarlo si clicca di nuovo.
- **Nessun avviso in caso di dubbio sui dati**: se l'invio fallisce niente viene segnato come inviato e si riprova alla scansione dopo.

## Dati
Migrazione nuova (la terza dello scanner: l'utente dovrà fare `prisma migrate deploy` sul DB remoto).

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
- Titolo armato = riga di `ScanAlert` con `notifiedAt` vuoto. Armarlo di nuovo azzera `notifiedAt` e aggiorna `armedAt`.
- `knownFull` è l'elenco dei simboli già 8 su 8 al momento dell'ultima email globale riuscita o dell'attivazione dell'interruttore. Così alla prima attivazione non arriva l'intera lista esistente.
- `resetDb()` dei test svuota entrambe le tabelle.

## Logica

### Modulo condiviso `lib/scan-verdict.ts`
Sposta da `components/ScannerTable.tsx` e rende puri e importabili anche lato server:
- `VERDICT` (etichetta, tono, ordine per verdetto);
- `sentence(row, plan, note)`;
- `planFor(row, ctx)`: `withContext(tradePlan(row), ctx)` in un punto solo.

La tabella e l'email usano così gli stessi testi e gli stessi prezzi.

### Modulo `lib/scan-alerts.ts`
- `collectAlerts({ full, armed, newEntrantsOn, knownFull })` (pura): `full` sono i simboli 8 su 8 della scansione. Restituisce `{ watched: string[], entrants: string[] }`. `watched` = simboli 8 su 8 armati. `entrants` = se l'interruttore è attivo, simboli 8 su 8 non presenti in `knownFull` e non già in `watched`.
- `buildScanEmail({ items, market, caution, finishedAt, appUrl })` (pura): restituisce `{ subject, text, html }`. Ogni `item` è `{ row, plan, note, reason: 'watched' | 'new' }`.
- `notifyScanAlerts(runId, deps?)`: legge la scansione chiusa, le righe, `ScanAlert` armati e le impostazioni; chiama `collectAlerts`; se non c'è nulla da dire non fa nulla; altrimenti costruisce l'email e la invia con `sendEmail`. **Solo se l'invio riesce**: imposta `notifiedAt` per i titoli `watched` e `knownFull` = tutti i simboli 8 su 8 della scansione. Non lancia mai eccezioni: errori solo nei log.
- Contesto dei prezzi: `caution` è `'session'` se la scansione è partita o finita durante la sessione USA (`isUsSession`), altrimenti nessuna; il mercato viene da `marketHealth` sui criteri di tutte le righe lette. Stesse regole della pagina.

### Aggancio
In `closeRun` (`lib/scanner-run.ts`), dopo il passaggio a `done` e la pulizia delle scansioni vecchie, **solo per chi ha vinto** la chiusura (`closed.count === 1`): `await notifyScanAlerts(runId)`. Una doppia chiusura concorrente non manda due email.

## Email
- Oggetto: `Scanner Minervini: N titoli hanno raggiunto 8 su 8 (AAA, BBB)` (un titolo: `AAA ha raggiunto 8 su 8`).
- In testa: riga con la salute del mercato (come in pagina) e, se la scansione è partita a mercato aperto, l'avviso sul volume parziale.
- Un blocco per titolo, in ordine di forza relativa:
  - simbolo, nome, settore, prezzo; motivo ("Lo seguivi" oppure "Nuovo negli 8 su 8");
  - verdetto in evidenza e la frase esplicativa;
  - righe separate **Compra**, **Vendi sotto** (con perdita massima circa 8%), **Profitto**; per i verdetti senza prezzi una riga che lo dice;
  - forza relativa, pivot con distanza dal prezzo, volume rispetto alla media;
  - link alla scheda del titolo se `APP_URL` è impostata.
- In fondo: "Indicazioni calcolate con le regole del metodo: non è consulenza finanziaria."
- HTML con stili in linea, larghezza massima 600 px, testo scuro su fondo chiaro; ogni stringa dinamica viene escapata. Il testo semplice ha lo stesso contenuto, in righe.
- `lib/notify.ts`: `sendEmail(subject, text, html?)`; SMTP e Resend inviano anche `html` quando c'è. Il comportamento senza `html` non cambia.
- Variabile opzionale `APP_URL` in `.env.example`.

## API
Tutte senza autenticazione, come il resto dell'app (vedi task 4 di `auditcalc.md`); rispondono JSON.
- `POST /api/scanner/alerts/[symbol]`: arma. 404 se il simbolo non è nell'ultima scansione completa. 200 `{ symbol, armed: true }`.
- `DELETE /api/scanner/alerts/[symbol]`: disarma (cancella la riga). 200 anche se non esisteva.
- `PUT /api/scanner/alerts/settings` con `{ newEntrants: boolean }`: 400 se il corpo non è valido. Attivando: `knownFull` = simboli 8 su 8 dell'ultima scansione completa (vuoto se non ce n'è). Disattivando: `knownFull` resta com'è.
- La pagina legge gli armati e le impostazioni direttamente dal DB.

## Interfaccia
- **Busta per titolo**: bottone con icona nella riga, **fuori** dal link della riga (un bottone dentro un link non è valido). Solo nel gruppo "Quasi, 7 su 8". Spenta: contorno; accesa: piena in verde. `aria-pressed` e `aria-label` ("Avvisami per email quando AAA arriva a 8 su 8" / "Avviso attivo per AAA, clicca per disattivarlo"). Aggiornamento ottimistico; se la chiamata fallisce torna allo stato precedente e un messaggio `role="status"` lo dice.
- **Interruttore globale** nella barra dei filtri: `role="switch"` con icona busta e testo "Avvisami dei nuovi 8 su 8"; tooltip: spiega che la scansione parte da sola ogni sera dopo la chiusura USA e che l'email contiene i titoli entrati dall'ultima volta.
- **Email non configurata** (né `ALERT_EMAIL_TO` con `SMTP_HOST` né con `RESEND_API_KEY`): la pagina lo sa lato server e passa `emailReady`; buste e interruttore sono disattivati con il motivo.
- Dopo la scansione, se un titolo armato non è stato avvisato perché l'invio è fallito, resta armato: nessun messaggio aggiuntivo.

## Scansione automatica
`.github/workflows/scanner.yml`: `schedule: '0 22 * * 1-5'` e `workflow_dispatch`. Passi: chiama `POST $APP_URL/api/scanner`; se 429 (scansione troppo recente) esce con successo; legge `runId`, poi chiama `POST /api/scanner/step` in ciclo finché `status` è `done` o il server risponde 409 (già chiusa); riprova fino a 3 volte sugli errori 5xx o di rete; massimo 40 passi; ogni passo con timeout di 90 secondi; esce con errore se non arriva a `done`. Usa solo il secret `APP_URL`, già presente per gli altri job: le route dello scanner non richiedono autenticazione. Verificato con `bash -n` e con una prova contro il server locale (non con vitest).

## Skeleton al caricamento
`app/scanner/ScannerSkeleton.tsx`, stesso modello di `app/WatchlistSkeleton.tsx`, come fallback di `Suspense` in `app/scanner/page.tsx` al posto di "Carico lo scanner…". Imita il layout reale: pulsante, riga di meta, barra dei filtri (gruppo, ricerca, menu, pillole) e 5 righe a griglia con le stesse colonne della lista. Shimmer con `@keyframes`, disattivato con `prefers-reduced-motion`. Il contenitore ha `role="status"`, `aria-busy="true"` e un'etichetta "Carico lo scanner" per gli screen reader.

## Gestione errori
- Email non configurata o invio fallito: log, nulla viene segnato come inviato, si riprova alla scansione dopo. La chiusura della scansione non ne risente.
- Titolo armato che esce dall'universo o non viene letto: resta armato, nessun avviso.
- Scansione chiusa senza righe 8 su 8: nessuna email, `knownFull` non cambia.
- Nessuna impostazione ancora salvata: si comporta come interruttore spento.
- Più clic rapidi sulla busta: l'ultima risposta del server decide lo stato mostrato.

## Test (vitest)
- `tests/lib/scan-verdict.test.ts` e la suite di `ScannerTable`: nessun cambio di comportamento dopo lo spostamento.
- `tests/lib/scan-alerts.test.ts`: `collectAlerts` (armati, nuovi, deduplica, interruttore spento); `buildScanEmail` (oggetto per uno e più titoli, un blocco per titolo, verdetti senza prezzi, avviso mercato debole e volume parziale, escape di `<`, `&` e virgolette nei nomi, link con e senza `APP_URL`).
- Con DB e invio simulato: invio riuscito (segna `notifiedAt`, aggiorna `knownFull`); invio fallito (non segna nulla); `sendEmail` che torna `false` per email non configurata; nessun titolo da avvisare (nessun invio); doppia chiusura concorrente (una sola email).
- `tests/api/scanner-alerts.test.ts`: arma, riarma dopo l'invio, disarma, simbolo sconosciuto (404), impostazioni (valide, 400), snapshot di `knownFull` all'attivazione.
- `tests/lib/notify.test.ts`: `html` inviato quando presente, assente quando non c'è.
- Componenti: busta (stati, annullamento dopo errore, assente sulle righe 8 su 8, disattivata senza email), interruttore, skeleton (`role="status"`, nessun testo di dato).
- `bash -n` sullo script del workflow.

## Fuori scope
- Più destinatari, account, accesso con autenticazione (task 4).
- Notifiche push o SMS.
- Avvisi quando un titolo esce dagli 8 su 8 o cambia verdetto.
- Avvisi basati sul prezzo (esistono già, in un'altra parte dell'app).
- Orari di silenzio, riepiloghi settimanali.
