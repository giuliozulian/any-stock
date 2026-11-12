# Analisi notizie con LLM (GitHub Models)

## Obiettivo
Sostituire l'analisi a parole chiave con un agente LLM che valuta l'impatto reale di ogni notizia sul titolo.

## Decisioni
- Provider: Google Gemini (`GEMINI_API_KEY`, modello `gemini-3.5-flash-lite`, endpoint compatibile OpenAI); override opzionale con `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL`. GitHub Models, scelto inizialmente, è stato dismesso il 30/07/2026.
- L'analisi parte al Refresh, solo per le notizie senza analisi. Il risultato è salvato in `NewsAnalysis` (1:1 con `NewsItem`) e non viene mai rifatto.
- Output JSON validato: `direction` (positive/negative/neutral), `intensity` 1-5, `horizon` (short/medium/long), `scope` (direct/indirect), `confidence` (low/medium/high), `rationale` (italiano, max ~220 caratteri).
- Peso nel verdetto: le notizie con confidenza alta, intensità ≥ 3 e pubblicate negli ultimi 7 giorni contano +1 (positive) o −1 (negative). Netto ≥ +2 aggiunge +1 al punteggio del verdetto, ≤ −2 toglie 1. Formula riportata nel tooltip.
- Fallback: senza token o con errore LLM, la notizia resta senza analisi e la UI mostra l'analisi base a parole chiave con etichetta "analisi base". L'errore non blocca il Refresh.

## UI
Le card dello slider mostrano impatto, intensità (n/5), orizzonte, ambito e motivazione del modello. Tooltip "i" con fonte e formula.

## Test
Client LLM testato con `fetch` mockato (parsing/validazione/errori); formula del peso in `evaluate`; rendering delle card con e senza analisi.
