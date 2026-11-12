# Riassunto e valutazione per titolo (news + video) — Design

## Obiettivo
Per ogni titolo, Gemini produce un unico riassunto in italiano e una valutazione prudente basati sulle ultime news e sui video YouTube recenti. Il risultato compare nella pagina `app/stock/[symbol]`.

Fuori scope: analisi per singolo video, trascrizioni dei video, previsioni di prezzo, consulenza finanziaria.

## Contesto esistente
- `lib/llm-news.ts` contiene la configurazione LLM (`config()`, Gemini via endpoint OpenAI-compatibile, override `LLM_*`) e l'analisi per singola notizia (`NewsAnalysis`).
- `lib/youtube.ts` restituisce `RecentVideo[]` (titolo, canale, data) con cache in memoria di 6 ore. I video non sono salvati su DB.
- `lib/refresh.ts` aggiorna un titolo (prezzo, news, analisi news) ed è chiamato dal cron `app/api/cron/refresh`.

## Design

### Dati
Nuovo modello Prisma `StockInsight` (uno per titolo, `stockId` unico, aggiornato con upsert):
`summary` (String), `verdict` ("positive" | "neutral" | "negative"), `score` (Int 1-5, rilevanza/forza del segnale), `keyPoints` (String[]), `risks` (String[]), `confidence` ("low" | "medium" | "high"), `inputHash` (String), `model` (String), `generatedAt` (DateTime).

### Modulo `lib/stock-insight.ts`
- `buildInsightInput(stock, news, videos)`: prende al massimo 10 news (titolo, fonte, data, summary troncato) e al massimo 6 video (titolo, canale, data). Dei video si usano solo i metadati.
- `computeInputHash(input)`: hash SHA-256 degli input normalizzati. Se uguale a quello salvato, non si chiama Gemini.
- `parseInsight(raw, model)`: validazione rigorosa del JSON (enum, limiti di lunghezza, array limitati a 4 elementi); restituisce `null` se invalido.
- `generateInsight(...)`: riusa `config()` esportato da `llm-news.ts` (da esportare, senza duplicarlo), timeout 20 s, risposta JSON.
- Prompt di sistema: analista prudente, solo dal contenuto fornito, nessun fatto inventato, nessuna previsione di prezzo, `verdict: "neutral"` e `confidence: "low"` se il materiale è scarso o non pertinente. I video sono segnali di sentiment di bassa affidabilità e vanno pesati meno delle news.
- Se non ci sono né news né video, non si genera nulla.

### Integrazione
- `refreshStock` chiama un passo isolato in `try/catch` dopo l'analisi delle news (errore loggato, mai bloccante), come già avviene per gli altri passi.
- La pagina legge `StockInsight` insieme al resto e mostra un riquadro "Riassunto e valutazione" sopra la lista news: verdetto con colore, punteggio, riassunto, punti chiave, rischi, data di generazione e avviso "Non è consulenza finanziaria".
- Nessuna chiamata LLM durante il rendering della pagina. Se manca l'insight, il riquadro non appare.

### Errori
- LLM non configurato, timeout o JSON invalido: nessun upsert, l'insight precedente resta visibile.
- Errore YouTube: si procede con le sole news.

### Test (vitest, in `tests/lib`)
- `parseInsight`: casi validi, enum errati, campi mancanti, troncamento degli array.
- `computeInputHash`: stabile a parità di input, diverso se cambia una news o un video.
- `generateInsight` con `fetch` mockato: salta la chiamata se l'hash è invariato.
