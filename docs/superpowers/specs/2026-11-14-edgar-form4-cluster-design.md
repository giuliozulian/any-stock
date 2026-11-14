# Discovery: cluster insider da Form 4 SEC (EDGAR, mercato intero) — Design

## Contesto

Sotto-progetto 1 di 3 nati dall'idea di un bot Telegram (r/scimmieinborsa,
@insidercluster) che traduce in italiano le operazioni insider (SEC,
Consob, Borsa Italiana) e segnala i cluster (più insider che comprano
lo stesso titolo in pochi giorni). I tre sotto-progetti, in ordine:

1. **Questo spec**: cluster Form 4 USA via EDGAR, come nuova fonte seed
   per `/scopri`.
2. 13D/13G/13F (ownership >5%, hedge fund quarterly) — EDGAR, da fare
   dopo, riusa l'infrastruttura di fetch di questo spec.
3. Internal dealing Italia (Consob/1Info/eMarket Storage) — fonte
   nuova e fragile (no API ufficiale), ultimo perché più rischioso.

Questo spec riguarda solo il punto 1.

## Obiettivo

Oggi `/scopri` (vedi `2026-11-13-stock-discovery-design.md`) scopre
candidati solo da movers di mercato e acquisti del Congresso. Un titolo
con forte attività insider (più dirigenti/azionisti che comprano nello
stesso momento) ma senza movimento di prezzo notevole e senza
attività Congress non emerge mai come candidato — eppure è esattamente
il tipo di segnale che il bot del post Reddit usa come scoperta
primaria.

Obiettivo: aggiungere una fonte seed basata sul feed Form 4 di EDGAR
(mercato intero, non per-simbolo) che fa emergere come candidato ogni
titolo con **almeno 2 insider distinti** che hanno depositato un
acquisto (codice `P`) negli ultimi Form 4 pubblicati.

## Non-goals

- Nessuna euristica aggiuntiva oltre al conteggio cluster: niente
  "primo acquisto da un anno", niente "quota aumentata", niente
  esclusione vendite 10b5-1 (richiedono storico per-insider, altro
  giro di fetch — eventuale iterazione futura separata, non in questo
  spec).
- Nessuna modifica a `scoreCandidate`, `ScoreInput` o `buildReason` in
  `lib/discover.ts`: l'arricchimento Finnhub esistente
  (`getInsiderTransactions` già chiamato per ogni candidato US in
  `enrichAndScore`) calcola già `insiderBuyerCount` sul simbolo
  selezionato — il punteggio insider emerge da solo una volta che il
  simbolo è un candidato. Qui si tocca solo la fase di *sourcing*.
- Nessuna pagina o notifica separata: il segnale confluisce
  esclusivamente in `/scopri`, nessun canale Telegram-style.
- Nessuna scansione esaustiva del mercato (niente daily-index EDGAR):
  solo il feed "getcurrent" (ultimi ~100 Form 4 di tutto il mercato),
  stesso principio di "fonte già bounded" delle altre fonti di
  `sourceCandidates`.
- Nessun cron: il feed viene letto solo quando l'utente preme
  "Scansiona ora", stesso modello di oggi.
- 13D/13G/13F e Italia restano fuori scope (sotto-progetti 2 e 3).

## Nuovo modulo: `lib/edgar-form4-feed.ts`

```typescript
export interface Form4ClusterSeed {
  symbol: string
  name: string       // ragione sociale dal feed EDGAR
  buyerCount: number // insider distinti con acquisto (codice P)
}

export async function getForm4ClusterSeeds(limit = 100, minBuyers = 2): Promise<Form4ClusterSeed[]>
```

Comportamento:

1. Fetch del feed Atom EDGAR "getcurrent":
   `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&output=atom&count={limit}`
   (stesso header `User-Agent` già usato in `edgar-roles.ts`). Parse
   di ogni `<entry>` → `{cik, companyName, accessionNumber, filingDate}`.
2. Per ciascun entry, risolve `cik → ticker` tramite una mappa
   `company_tickers.json` **condivisa** con `edgar-roles.ts` (stessa
   cache TTL 24h, stesso fetch — si esporta da `edgar-roles.ts` una
   funzione `getTickerByCik(cik): string | null` che costruisce, sulla
   prima chiamata, anche la mappa inversa `cik → ticker` a partire
   dai dati già scaricati per `getCik`, nessun fetch aggiuntivo).
   Entry senza ticker mappato (filer non quotato, fondo, 13F-only,
   ecc.) vengono scartati.
3. Per ogni entry con ticker risolto, fetch dell'XML del Form 4
   (`https://www.sec.gov/Archives/edgar/data/{cik}/{accession-senza-trattini}/{accession}.xml`
   — stesso schema URL usato implicitamente da `edgar-roles.ts` per i
   singoli accession), concorrenza limitata a 5 (stesso pattern di
   `runWithConcurrency` in `discover.ts`; qui duplicato localmente nel
   nuovo modulo per non introdurre una dipendenza circolare).
4. `parseForm4Transaction(xml): { insiderName: string; code: string } | null`
   — estrae `reportingOwnerId > rptOwnerName` e
   `nonDerivativeTransaction > transactionCoding > transactionCode`
   (prima occorrenza; un Form 4 con più transazioni usa la prima riga
   non-derivative, sufficiente per sapere se l'insider ha comprato).
5. Raggruppa i risultati per `symbol`, conta i `insiderName` distinti
   con `code === 'P'`, filtra `buyerCount >= minBuyers`, ritorna
   `{symbol, name: companyName, buyerCount}` ordinato per `buyerCount`
   decrescente.
6. Fetch del feed o di un singolo XML che falliscono: try/catch per
   singolo XML (quell'entry viene scartata, le altre continuano); se
   il fetch del feed stesso fallisce, l'intera funzione ritorna `[]`
   (gestito dal chiamante come le altre fonti).

## `lib/discover.ts`

### `sourceCandidates`

Nuovo blocco try/catch isolato (stesso pattern delle tre fonti
esistenti):

```typescript
try {
  const clusters = await getForm4ClusterSeeds()
  for (const c of clusters) addSeed(c.symbol, c.name, 'US', 'edgar-form4-cluster', null, null, null)
} catch (err) {
  console.error('Discovery: EDGAR Form4 cluster sourcing failed:', err instanceof Error ? err.message : String(err))
}
```

Un simbolo già presente da movers/congress guadagna semplicemente
`'edgar-form4-cluster'` in più nel suo array `source` (stesso
meccanismo di dedup già esistente in `addSeed`).

### `selectForEnrichment`

```typescript
export function selectForEnrichment(seeds: CandidateSeed[], maxUS = 14, maxIT = 6): CandidateSeed[]
```

Split interno al cap US (non cambia la firma né il cap IT):

- `maxUS` si divide in `maxUS - 4` slot per i seed US ordinati come
  oggi (`source.length` poi `|seedChangePct|` decrescente), **più**
  4 slot riservati ai seed US con `source` che contiene
  `'edgar-form4-cluster'` e lunghezza `source.length === 1` (cioè
  scoperti *solo* dal cluster, non già vincitori di uno slot normale
  perché multi-fonte o mover) — questi 4 slot ordinati per
  `buyerCount` (serve propagare `buyerCount` nel seed, vedi sotto;
  solo per l'ordinamento di questi 4, non per lo score).
- Se ci sono meno di 4 candidati cluster-only, gli slot liberi
  **non** passano agli altri (stesso principio già usato per la
  quota IT: quota fissa, non cap condiviso).
- Un seed già selezionato nei primi `maxUS - 4` (perché multi-fonte o
  mover forte) non viene mai duplicato nei 4 riservati.

`CandidateSeed` guadagna un campo opzionale:

```typescript
export interface CandidateSeed {
  // ...campi esistenti
  clusterBuyerCount?: number // solo per seed da 'edgar-form4-cluster', usato per ordinare lo split riservato
}
```

Nessun impatto su `scoreCandidate`/`ScoreInput`: questo campo serve
solo a `selectForEnrichment` per scegliere quali 4 promuovere quando
ce ne sono più di 4 candidati cluster-only in un giorno molto attivo.

## Error handling

- Feed EDGAR down → fonte vuota, scan continua con le altre tre
  (try/catch isolato, stesso pattern esistente).
- Singolo Form 4 XML non parsabile o fetch fallito → quell'entry
  scartata, non blocca le altre (nessun impatto sul conteggio
  cluster delle altre entry).
- Entry con `cik` non mappato a un ticker → scartata silenziosamente
  (filer non quotato su NYSE/Nasdaq/altro mercato coperto dal mapping
  `company_tickers.json`).

## Rischio da verificare in test manuale

Il feed "getcurrent" a 100 entry, con fetch XML a concorrenza 5,
aggiunge round-trip SEC extra ad ogni scan, sommati ai ~20
arricchimenti Finnhub/Yahoo già esistenti. Da verificare che il totale
resti sotto `maxDuration = 60` di `app/api/discover/route.ts` (nessuna
modifica di codice prevista qui, solo verifica a mano con uno scan
reale prima di considerare il sotto-progetto chiuso).

## Testing

- `lib/edgar-form4-feed.ts`:
  - `parseForm4Transaction`: XML con codice `P`, con codice `S`,
    XML malformato/senza transazione (ritorna `null`).
  - `getForm4ClusterSeeds`: feed e XML mockati — soglia `minBuyers`
    rispettata, cik non mappato scartato, un XML che fallisce non
    blocca gli altri, feed stesso che fallisce ritorna `[]`.
- `lib/discover.ts`:
  - `sourceCandidates`: la nuova fonte aggiunge seed con
    `source: ['edgar-form4-cluster']`; un simbolo già da movers
    guadagna la fonte in più senza duplicare la entry.
  - `selectForEnrichment`: split 10/4 (con `maxUS` default 14) —
    cluster-only non supera i 4 slot riservati anche con più
    candidati disponibili; mover/congress non "ruba" gli slot
    riservati; meno di 4 cluster-only non regala slot ai mover.

## Review Focus

- Un titolo con cluster insider forte ma zero movimento di prezzo e
  zero attività Congress deve comunque apparire tra i candidati
  (verifica end-to-end, non solo unit test sullo split).
- Un singolo Form 4 XML rotto non deve azzerare il conteggio cluster
  degli altri titoli nello stesso batch di 100.
- Il tempo totale di uno scan (`POST /api/discover`) resta sotto i 60s
  anche nei giorni di alta attività Form 4.
