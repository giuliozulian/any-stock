# Login con Supabase Auth — Design

## Obiettivo
Mettere tutta l'app dietro un login con email e password appoggiato a Supabase Auth, per chiudere il task 4 di `auditcalc.md`: oggi chiunque conosca l'URL può leggere la watchlist con i prezzi di ingresso e vendita, svuotarla, lanciare scansioni e chiamate LLM a carico dell'utente, consumare la quota Finnhub e armare avvisi email.

Successo:
- Senza login, ogni pagina porta a `/login` e ogni route `/api` risponde 401 (salvo le eccezioni elencate sotto).
- Con le credenziali giuste l'utente entra e naviga come oggi; con un'email diversa da quella consentita, o con credenziali sbagliate, vede lo stesso errore generico.
- I job automatici (cron Vercel, workflow GitHub) continuano a funzionare con `CRON_SECRET`.
- Una configurazione mancante non lascia mai l'app aperta in produzione.

## Decisioni prese
- **Cosa protegge**: tutta l'app, pagine e API, in lettura e in scrittura.
- **Fuori dal login**: `/login`, i file statici, `manifest` e icone (il browser li chiede senza cookie), i cron (`CRON_SECRET`), `widget` e `calendar` (token obbligatorio, perché sono letti da un widget o da un'app calendario che non fanno login).
- **Provider**: Supabase Auth, pacchetti `@supabase/supabase-js` e `@supabase/ssr`. Prisma continua a parlare direttamente con il DB: Supabase serve solo per l'identità.
- **Utenti**: uno solo, creato a mano. Le iscrizioni pubbliche si disattivano nel pannello Supabase. L'app non ha pagina di registrazione. In più confronta l'email con `AUTH_ALLOWED_EMAIL`, così un'iscrizione riaperta per errore non fa entrare estranei.
- **Sessione**: cookie httpOnly gestiti da `@supabase/ssr`, rinnovati in `proxy.ts`, verificati sul server di Supabase con `auth.getUser()` (mai con `getSession()`, che si fida del cookie).
- **Controllo doppio**: il proxy fa il reindirizzamento rapido, ma ogni route e ogni pagina ricontrolla da sé, come raccomanda la guida di Next 16.
- **Workflow serale dello scanner**: `/api/scanner` e `/api/scanner/step` accettano la sessione **oppure** `Authorization: Bearer CRON_SECRET`.

## Variabili d'ambiente
| Variabile | Dove | Note |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | app (Vercel e locale) | `https://vkchgkeovwgvxgqpbnco.supabase.co`; la ref non è un segreto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | chiave pubblica per natura (Settings → API) |
| `AUTH_ALLOWED_EMAIL` | app | l'unica email che può entrare |
| `AUTH_DISABLED` | solo locale | `1` apre l'app **solo se** `NODE_ENV !== 'production'`, con avviso nel terminale |
| `WIDGET_TOKEN` | app | ora obbligatorio |
| `CALENDAR_TOKEN` | app | nuovo, obbligatorio |
| `SUPABASE_SERVICE_ROLE_KEY` | **solo `.env.local`** | usata solo da `scripts/create-user.mjs`; mai su Vercel, mai nel codice |

Fail-closed: se `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` o `AUTH_ALLOWED_EMAIL` mancano e `AUTH_DISABLED` non è attivo in sviluppo, ogni route protetta risponde 503 `{ error: 'Auth not configured' }` e le pagine mostrano un messaggio di configurazione mancante, senza reindirizzare in loop.

## Architettura

### Moduli
- `lib/supabase/server.ts`: `createSupabaseServerClient()` per route e server component, con i cookie di `next/headers` (asincroni in Next 16).
- `lib/supabase/proxy.ts`: `updateSession(request)` per il proxy: crea il client con i cookie della richiesta e della risposta, rinnova la sessione e restituisce `{ response, user }`.
- `lib/auth.ts`:
  - `authConfigured(): boolean` e `authDisabled(): boolean` (vero solo con `AUTH_DISABLED=1` e `NODE_ENV !== 'production'`).
  - `isAllowedEmail(email: string | undefined | null): boolean`: confronto senza distinzione tra maiuscole e minuscole con `AUTH_ALLOWED_EMAIL`.
  - `getAuthedUser(): Promise<{ id: string; email: string } | null>`: `auth.getUser()` più controllo dell'email.
  - `requireUser(request?: Request, options?: { allowCron?: boolean }): Promise<{ ok: true } | { ok: false; response: Response }>`: per le route; 401 senza utente, 503 senza configurazione. Con `allowCron` accetta `Authorization: Bearer <CRON_SECRET>` (confronto a tempo costante).
  - `requireUserOrRedirect(): Promise<void>`: per le pagine; `redirect('/login?next=…')` senza utente.
- `proxy.ts` (radice): `export async function proxy(request)`; usa `updateSession`; per `/api/*` senza utente risponde 401 JSON, per le pagine reindirizza a `/login?next=<percorso originale>`. `matcher` che esclude `_next/static`, `_next/image`, `favicon.ico`, `icon.svg`, `manifest.webmanifest`, `pwa-icon`, `login`, `api/cron`, `api/widget`, `api/calendar`.
- `lib/safe-next.ts`: `safeNext(value: string | null | undefined): string`: accetta solo percorsi che iniziano con una sola `/` (niente `//`, niente schema, niente `\`), altrimenti `/`.

### Pagina e azioni
- `app/login/page.tsx` (server): se l'utente è già autenticato reindirizza a `next`; altrimenti mostra il form.
- `app/login/LoginForm.tsx` (client, `useActionState`): campi email e password, pulsante "Entra", errore in una riga con `role="alert"`.
- `app/login/actions.ts` (`'use server'`):
  - `login(prevState, formData)`: valida che email e password siano stringhe non vuote; `signInWithPassword`; se riesce ma l'email non è consentita fa `signOut` e risponde con lo stesso errore; errore sempre `Email o password errati`; in caso di successo `redirect(safeNext(next))`. Errori imprevisti: `Non riesco ad accedere, riprova tra poco` (senza dettagli).
  - `logout()`: `signOut` e `redirect('/login')`.
- `components/SiteNav.tsx` e `app/layout.tsx`: il layout calcola `signedIn` con `getAuthedUser()` e lo passa al menu; con `signedIn` il menu mostra "Esci" (un `<form action={logout}>` con un pulsante), altrimenti mostra solo il marchio, senza voci di navigazione.

### Protezione delle route
`requireUser()` come prima istruzione di ogni handler in:
`stocks` (GET, POST), `stocks/[symbol]` (GET, PATCH, DELETE), `stocks/[symbol]/refresh`, `discover`, `discover/[symbol]`, `quotes`, `search`, `scanner/alerts/[symbol]`, `scanner/alerts/settings`.
`scanner` e `scanner/step`: `requireUser(request, { allowCron: true })`.
Ogni pagina protetta chiama `await requireUserOrRedirect()` come prima istruzione: `app/page.tsx`, `scopri`, `movimenti`, `politici`, `trimestrali`, `ipo`, `confronta`, `scanner`, `stock/[symbol]`. Non lo metto nel layout radice: `/login` usa lo stesso layout e finirebbe in un ciclo di reindirizzamenti.
`getAuthedUser()` è avvolta in `React.cache()`, così layout e pagina condividono una sola verifica per richiesta (il proxy ne fa una sua, per rinnovare i cookie).
Eccezioni che non lo chiamano: `app/api/cron/*` (restano su `CRON_SECRET`), `widget`, `calendar`, `login`.

### Widget e calendario
- `widget`: se `WIDGET_TOKEN` non è impostato risponde 401 (oggi apriva senza controllo); il resto invariato.
- `calendar`: richiede `?token=` uguale a `CALENDAR_TOKEN`; se la variabile manca risponde 401.
- I confronti dei token sono a tempo costante.

### Workflow e cron
- `.github/workflows/scanner.yml`: aggiunge l'intestazione `Authorization: Bearer ${{ secrets.CRON_SECRET }}` alle due chiamate `curl`.
- `price-alerts.yml` e `insider-digest.yml` chiamano già `/api/cron/*` con `CRON_SECRET`: nessuna modifica (da verificare nel piano).
- Cron Vercel (`/api/cron/refresh`): invariato.

### Creazione dell'account
`scripts/create-user.mjs` (la cartella `scripts/` è ignorata da git, resta locale): legge `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` da `.env.local`, chiede email e password nel terminale (la password non è mostrata), chiama `POST /auth/v1/admin/users` con `email_confirm: true` e stampa solo l'esito. Mai la chiave o la password nei log. Se l'utente esiste già, lo dice.

## Gestione errori
- Credenziali sbagliate o email non consentita: stesso messaggio, nessun indizio su quale delle due.
- Supabase non raggiungibile: `getAuthedUser` restituisce `null` (fail-closed) e il login mostra il messaggio generico di indisponibilità.
- Sessione scaduta durante l'uso: le chiamate `fetch` dal browser ricevono 401; le pagine reindirizzano a `/login?next=…` al prossimo caricamento. I componenti che fanno `fetch` mostrano già un errore generico in caso di risposta non riuscita.
- `next` malevolo (`//evil.com`, `https://…`, `/\evil`): ignorato, si va a `/`.
- Token di widget o calendario mancanti o sbagliati: 401 senza dettagli.

## Test (vitest)
- `tests/lib/safe-next.test.ts`: percorsi interni accettati; `//x`, `https://x`, `/\x`, vuoto, `null` rifiutati.
- `tests/lib/auth.test.ts` (client Supabase simulato): nessuna sessione → 401; email diversa → 401 e nessun accesso; email uguale con maiuscole diverse → ok; config mancante → 503; `AUTH_DISABLED=1` fuori produzione → ok, in produzione ignorato; Bearer `CRON_SECRET` giusto/sbagliato/assente con e senza `allowCron`; confronto a tempo costante (lunghezze diverse non lanciano).
- `tests/api/auth-routes.test.ts`: per ogni route protetta (tabella di handler) senza utente → 401 e nessuna scrittura nel DB; con utente simulato → comportamento normale (un caso per route già testata). Route `scanner`: Bearer `CRON_SECRET` accettato.
- `tests/api/widget-calendar.test.ts`: senza token configurato 401; token sbagliato 401; giusto 200.
- `tests/lib/proxy.test.ts`: pagina senza utente → redirect con `next`; `/api` senza utente → 401; percorsi esclusi non toccati; con utente → passa e propaga i cookie.
- `tests/components/LoginForm.test.tsx`: invio, errore generico con `role="alert"`, pulsante disattivato durante l'invio.
- `tests/components/SiteNav.test.tsx`: "Esci" presente con `signedIn`, assente e senza voci di menu senza.
- `tests/lib/pages-auth.test.ts`: ogni pagina protetta senza utente reindirizza a `/login` (con `requireUserOrRedirect` simulato che lancia il redirect).
- I test di route esistenti simulano `requireUser` (modulo `@/lib/auth`) per restare indipendenti da Supabase.
- `bash -n` e `grep` sul workflow modificato; nessuna chiamata reale a Supabase nei test.

## Da fare da parte dell'utente dopo l'implementazione
1. Supabase → Authentication → Providers → Email: disattivare "Allow new users to sign up".
2. Creare l'utente con `! node scripts/create-user.mjs` (o dal pannello con "Auto Confirm User").
3. Impostare su Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `AUTH_ALLOWED_EMAIL`, `WIDGET_TOKEN`, `CALENDAR_TOKEN`, e ridistribuire.
4. Aggiornare gli URL già sottoscritti di widget e calendario con `?token=…`.
5. Controllare che il secret `CRON_SECRET` esista in GitHub (c'è già per gli altri job).

## Fuori scope
- Pagina di recupero password e registrazione nell'app.
- Più utenti, ruoli, accesso a terzi.
- Limite ai tentativi di login oltre a quello integrato di Supabase.
- Row Level Security su Supabase: l'app usa Prisma con connessione diretta e non passa dall'API Supabase.
- Autenticazione a più fattori.
