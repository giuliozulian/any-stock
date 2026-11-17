# Watchlist per utente — piano

## Obiettivo
Ogni utente ha la sua watchlist e i suoi prezzi di ingresso/uscita. Prezzi, notizie, raccomandazioni e analisi restano condivisi (una sola chiamata esterna per titolo, qualunque sia il numero di utenti).

## Fuori ambito (scelto)
Avvisi dello scanner, impostazioni dello scanner e candidati scartati in Scopri restano globali.

## Modello
- `WatchlistEntry`: `id`, `userId`, `stockId` → `Stock`, `userEmail`, `addedAt`, `entryPrice`, `sellPrice`, `entryTriggeredAt`, `sellTriggeredAt`; unico su `(userId, stockId)`.
- Da `Stock` si tolgono `addedAt`, `entryPrice`, `sellPrice`, `entryTriggeredAt`, `sellTriggeredAt`.
- `Stock` esiste finché almeno una entry lo punta; alla rimozione dell'ultima si cancella (cascade su notizie e snapshot).

## Migrazione (da eseguire a mano sul DB reale, con backup)
1. Crea `WatchlistEntry`.
2. Copia ogni `Stock` in una entry per l'utente originale: `SELECT id::text, email FROM auth.users ORDER BY created_at LIMIT 1` (fallback `'dev'` se lo schema `auth` non esiste).
3. Solo dopo aver verificato la copia: elimina le colonne da `Stock`.

## Punti da cambiare (31 query su `prisma.stock`, 25 file)
- `lib/auth.ts`: `requireUser` e le pagine devono dare l'`id` e l'`email` dell'utente.
- API: `stocks` (GET/POST), `stocks/[symbol]` (GET/PATCH/DELETE), `refresh`, `quotes`.
- Pagine: `/`, `/stock/[symbol]`, `/movimenti`, `/politici`, `/trimestrali`.
- Componenti che leggono i prezzi di ingresso/uscita: `AlertTargets`, `SinceWatching`, `live-quotes`.
- `lib/alerts.ts` e `lib/alert-runner.ts`: gli avvisi di prezzo si valutano per entry e si inviano a `userEmail`.
- Cron (`refresh`, `alerts`, `insiders`) e `lib/insider-digest.ts`: lavorano sui titoli distinti con almeno una entry.
- Feed con token (`widget`, `calendar`): oggi un solo token. Serve decidere di quale utente mostrano la watchlist (proposta: variabile `FEED_USER_ID`).
- Test: `resetDb` pulisce anche `WatchlistEntry`; ogni test che crea uno `Stock` crea anche la entry.

## Ordine
1. Schema e migrazione sul DB di test, test dei nuovi helper (`watchlistFor(userId)`).
2. Auth: id ed email utente.
3. API e cron.
4. Pagine e componenti.
5. Verifica con due utenti: l'uno non vede né modifica la watchlist dell'altro.

## Rischi
- Migrazione su dati reali: backup prima, esecuzione in due passi.
- Il lavoro in corso sul fair value tocca gli stessi file (`lib/refresh.ts`, pagine): meglio unirlo prima, o lavorare in un worktree.
