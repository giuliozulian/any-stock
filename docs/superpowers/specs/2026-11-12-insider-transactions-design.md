# Insider: chi compra e chi vende (bozza da approvare)

## Obiettivo
Nella pagina `/stock/[symbol]` mostrare cosa fanno gli insider (dirigenti e membri del CdA) sul titolo, così un non esperto vede subito se "chi sa" sta comprando o vendendo.

## Dati
Finnhub `/stock/insider-transactions` (SEC Form 4), disponibile nel piano gratuito. Campi usati: `name`, `change` (azioni, + acquisto / − vendita), `transactionPrice`, `transactionDate`, `transactionCode`.

Codici considerati:
- `P`: acquisto sul mercato aperto (segnale forte)
- `S`: vendita sul mercato aperto (spesso piani programmati, segnale debole)
- Esclusi: `G` (regali), `A`/`M`/`F`/`X` (premi, opzioni, tasse), perché non esprimono un giudizio sul titolo.

## Proposta (default, da confermare)
1. **Riepilogo ultimi 6 mesi:** n. acquisti vs n. vendite, azioni nette, valore stimato in $, con badge "Gli insider comprano / vendono / neutro".
2. **Lista** delle ultime 10 operazioni P/S: data, nome, tipo, azioni, prezzo, valore.
3. **Spiegazione** in italiano: le vendite sono comuni (stock option, tasse); gli acquisti sul mercato sono più significativi.
4. Nessun impatto sul punteggio del giudizio nella prima versione (da valutare dopo).

## Architettura
- `lib/finnhub.ts`: `getInsiderTransactions(symbol)`.
- `lib/insiders.ts`: filtro P/S, finestra 6 mesi, riepilogo (funzione pura, testata).
- `components/InsiderPanel.tsx` + `.module.css`: server component, stesso stile delle altre schede.
- Fetch a ogni render con cache breve (`use cache`, ~6 ore), niente nuova tabella DB.
- Errore o nessun dato: stato vuoto "Nessuna operazione recente degli insider".

## Test
`tests/lib/insiders.test.ts`: filtro codici, finestra temporale, segno e totali, lista vuota.

## Decisioni
- Mostrati solo P/S più il riepilogo mensile `insider-sentiment` (MSPR).
- Mail di fine giornata (GitHub Actions, 22:30 UTC lun-ven, `/api/cron/insiders`) con i 3 titoli seguiti che hanno più operazioni P/S depositate oggi; nessuna mail se non ce ne sono; nessuna tabella nuova.
