# Analisi AI del setup Minervini: design

Data: 2026-11-18. Stato: bozza da rivedere.

## Obiettivo

Dare a chi guarda un titolo una seconda valutazione del setup, basata solo sul metodo di Minervini e non sull'umore del momento. L'AI non decide: applica le regole del rulebook ai numeri che l'app ha già calcolato e dice cosa è soddisfatto, cosa manca e cosa non può valutare.

Successo:
- Ogni giudizio cita gli id delle regole del rulebook. Nessuna regola inventata.
- Lo stesso input dà lo stesso giudizio (si ripete, si può mettere in cache).
- Su un set di casi noti, il giudizio concorda con l'esito in una misura che abbiamo scelto prima di fidarci (vedi Test di competenza).

Non obiettivi della prima versione: consigli di acquisto o vendita, previsioni di prezzo, analisi in batch su tutto lo scanner, lettura di immagini, AVWAP, ricerca nel testo dei libri.

## Contesto nel repo

- `lib/minervini.ts`: Trend Template (8 criteri), `detectVcp`, `describeBase`, `riskReward`. `Vcp.base` porta durata, profondità, rapporti tra contrazioni e tenuta finale.
- `lib/minervini-data.ts`: `getMinerviniAnalysis(symbol)` restituisce `MinerviniAnalysis` (`template`, `vcp`, `peerCount`).
- `lib/llm-news.ts`: client Gemini (endpoint compatibile OpenAI) con timeout e tentativi ripetuti. `requestLlmJson(system, user)` e `isLlmConfigured()` sono già esportati.
- Esempio da seguire: `lib/bull-bear-note.ts` (prompt di sistema, `PROMPT_VERSION`, hash dell'input, validazione dell'output, cache in DB).
- `lib/rate-limit.ts`: bucket `heavy` per le chiamate che arrivano a un LLM.
- `docs/minervini-rulebook.md`: regole con id, soglie, tipo (`calcolo`, `giudizio`, `esterno`), fonte e stato di verifica.

Nota sul punto 8 del Trend Template: lo scanner calcola il percentile RS su tutto l'universo scansionato, mentre `getMinerviniAnalysis` lo calcola sui titoli di watchlist e scoperte (massimo 40). Il prompt riceve quindi anche `peerCount` e deve dire quando il campione è piccolo.

## Principi

- I numeri restano deterministici: li calcola il codice. L'AI li interpreta e non ne introduce di nuovi.
- Il rulebook è l'unica fonte di criteri. Il prompt lo contiene per intero. Niente testo dei libri nel repo né sul deploy.
- Ciò che non abbiamo come dato (fondamentali, regime di mercato, linea RS) l'AI lo segna `non valutabile`, non lo indovina.
- Il risultato è una valutazione del setup secondo il metodo, con l'avviso "non è consulenza finanziaria".

## Architettura

### 1. `lib/minervini-rulebook.ts`

Costante tipizzata con le regole usate dall'AI. Ogni voce ha `id`, `rule` (testo breve in italiano), `kind` (`calcolo`, `giudizio`, `esterno`), `source` (libro e pagina, o "scelta nostra") e `status` (`confermata`, `non verificata`, ecc.). Il prompt di sistema si costruisce da qui.

Il file è la copia leggibile dalla macchina di `docs/minervini-rulebook.md`. Un test controlla che gli id delle due fonti coincidano, così non divergono in silenzio.

Escluse dal prompt: le regole `fuori fonte` che non fanno parte della scelta fatta (AVWAP, soglie CAN SLIM). Le regole `non verificata` entrano con l'etichetta, così l'AI sa quanto fidarsi.

### 2. `lib/minervini-ai.ts`

- `buildInput(symbol, analysis)`: ricava un oggetto JSON piccolo da `MinerviniAnalysis`: prezzo, esito e distanza di ogni criterio del Trend Template, RS e `peerCount`, `vcp` (contrazioni, pivot, stato, volume secco, rapporto di volume, stop suggerito) e `vcp.base`. Nessun dato grezzo di candele.
- `computeHash(input)`: sha256 di `PROMPT_VERSION`, versione del rulebook e input, come in `bull-bear-note.ts`.
- `analyze(symbol)`: legge la cache per hash; se manca, costruisce il prompt, chiama `requestLlmJson` e valida l'output; poi salva.
- Se l'analisi non esiste (storico insufficiente) o l'LLM non è configurato, restituisce `null` e la UI mostra solo i dati a regole.

### 3. Formato dell'output

```
{
  verdict: 'ready' | 'wait' | 'no',
  summary: string,            // 2-3 frasi, italiano
  criteria: [{ ruleId, outcome: 'met' | 'not_met' | 'not_assessable', note }],
  missing: string[],           // cosa deve ancora succedere per diventare ready
  risks: string[],
  uncovered: string[]          // aspetti che il rulebook non copre
}
```

Validazione, nell'ordine:
1. Forma JSON corretta; liste con lunghezza massima; testi tagliati.
2. Ogni `ruleId` esiste nel rulebook. Una risposta con id sconosciuti viene scartata, non corretta.
3. Coerenza con i numeri: se il Trend Template non passa tutti i criteri misurabili, `verdict` non può essere `ready`. Il codice abbassa il verdetto a `wait` e lo segnala nel risultato.
4. Dopo la validazione fallita si ritenta una volta; poi si restituisce `null` senza salvare.

### 4. Persistenza

Nuova tabella Prisma `MinerviniAiNote`, per simbolo e non per `Stock`, perché i candidati dello scanner non sono tutti in watchlist:

```
symbol, day (data), inputHash, result (Json), model, promptVersion, generatedAt
unique (symbol, day)
```

Una generazione per titolo e per giorno; se l'hash cambia nello stesso giorno (dati nuovi), si rigenera una sola volta e poi si sovrascrive. Voci vecchie spazzate come per `CacheEntry`.

### 5. Route e controlli

- `POST /api/minervini-ai/[symbol]`: richiede login, usa il bucket `heavy`, risposta 429 oltre il limite. La chiave Gemini resta lato server.
- Un titolo alla volta, su richiesta dell'utente. Nessuna generazione automatica allo scan.

### 6. Interfaccia

Pulsante "Analisi AI" accanto a "Mostra grafico" nella riga dello scanner e nel `MinerviniPanel`. Mostra uno scheletro mentre genera; poi verdetto, riepilogo, elenco dei criteri con esito e le sezioni `missing`, `risks`, `uncovered`. In ogni caso l'avviso "non è consulenza finanziaria". Se non disponibile, non appare nulla di rotto: resta il pannello a regole.

## Test di competenza

Serve per sapere se l'AI è affidabile prima di mostrarla.

- **Positivi:** i 22 casi di `charts-pdf` (titolo, data e prezzo del breakout). Per ciascuno si ricostruisce lo stato dei dati il giorno prima del breakout dallo storico e si esegue l'analisi.
- **Negativi:** breakout che il rilevatore ha segnalato e che sono scesi sotto lo stop dell'8% entro poche settimane, ricavati dallo storico del nostro universo.
- **Misura:** concordanza tra `verdict` e esito; frequenza con cui cita regole inesistenti (deve essere 0); frequenza di `ready` sui negativi.
- **Soglia di accettazione:** da fissare prima di eseguirlo, insieme all'utente, per non adattarla ai risultati.
- Il test usa chiamate reali a Gemini: va fuori dalla suite normale (`vitest run`) e si lancia a mano.
- Limite: i positivi sono scelti col senno di poi, quindi il test non misura da solo quanto il metodo funzioni; misura se l'AI applica bene le regole.

## Test del codice

- Rulebook: id coerenti con il documento.
- `buildInput`: dati essenziali presenti, nessun dato inatteso.
- Validazione dell'output: id sconosciuti scartati, verdetto abbassato se il Trend Template non passa, testi lunghi tagliati.
- Hash: cambia con l'input, con la versione del prompt e con la versione del rulebook.
- Route: 401 senza login, 429 oltre il limite, risposta da cache senza chiamare l'LLM.
- LLM simulato nei test, come negli altri moduli.

## Fasi

1. `minervini-rulebook.ts`, `buildInput`, validazione e prompt, senza UI né DB. Verificabile con LLM simulato.
2. Tabella, cache e route.
3. Interfaccia.
4. Test di competenza e revisione del prompt.

Ogni fase è utilizzabile da sola. La fase 4 decide se le fasi 1-3 vanno mostrate agli utenti o restano interne.

## Rimandato

- **Immagine del grafico** nel prompt: solo se il test di competenza mostra che i numeri non bastano.
- **AVWAP** opzionale: richiede un calcolo che oggi non esiste; si valuta dopo.
- **Fondamentali, regime di mercato, linea RS**: servono dati che non abbiamo; fino ad allora sono `non valutabile`.
- **Analisi in batch** dello scanner: cambia costi e limiti, richiede un design a parte.
- **Testo dei libri** come citazioni: possibile solo in locale; non ne facciamo dipendere il prodotto.

## Rischi

- Il rulebook ha ancora regole `non verificata` e il codice usa soglie nostre (zona d'acquisto 5%, stop 8%). L'AI le tratta come tali; chi legge deve poterlo vedere.
- Gemini Flash Lite può essere troppo debole sul ragionamento a più regole: il test di competenza lo dirà, e `LLM_MODEL` permette di cambiare modello senza toccare il codice.
- Il campione RS dell'analisi singola (40 titoli) è più piccolo di quello dello scanner: il prompt riceve `peerCount` per dirlo.
