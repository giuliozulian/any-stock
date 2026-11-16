# Scheda titolo: stagionalità — Design

## Contesto

Sotto-progetto 2 di 4 nati dall'analisi della scheda strumento di
Forecaster terminal. Il sotto-progetto 1
(`2026-11-16-price-performance-design.md`) ha portato lo storico prezzi
completo (`getFullPriceHistory` in `lib/history.ts`) e la tab
"Andamento". Questo spec riusa quello storico e non aggiunge fonti
dati.

## Obiettivo

L'app serve a decidere se e quando entrare su un titolo in watchlist.
"Andamento" dice quanto ha reso il titolo e quanto è sotto i massimi.
Manca la risposta a una domanda sul *quando*: questo periodo dell'anno è
stato storicamente favorevole o sfavorevole al titolo?

Obiettivo: una nuova tab "Stagionalità" nella scheda titolo che lo dice
in una frase e lo mostra in cinque blocchi. Vale per titoli USA e
italiani: servono solo i prezzi.

## Decisioni prese

- **Posizione**: nuova tab "Stagionalità" subito dopo "Andamento".
- **Finestra**: un selettore in cima alla tab sceglie su quanti anni
  calcolare: 5, 10, 20 anni o tutto lo storico. Predefinito 10.
- **Adesso**: una frase in cima riassume il mese in corso e il
  successivo; gli stessi due mesi sono evidenziati nei grafici e la
  curva stagionale segna la data di oggi.
- **Calcolo sul server**: il server calcola i risultati di tutte le
  finestre e li passa già pronti; il selettore nel browser cambia solo
  quale finestra è mostrata. Nessun prezzo giornaliero inviato al
  browser per questa tab.
- **Prezzo di riferimento**: chiusura corretta per gli split, senza
  dividendi, come in "Andamento".
- **Grafici**: SVG scritti a mano, nessuna libreria nuova.
- **Ciclo elettorale**: è il ciclo presidenziale USA, mostrato anche
  per i titoli italiani con etichetta esplicita.

## Calcoli

Nuovo file `lib/seasonality.ts`. Solo funzioni pure: ricevono
`PricePoint[]` e la data di riferimento `now`; non fanno rete e non
leggono l'orologio. Le date si leggono in UTC, come in
`lib/performance.ts`.

### Anni completi e finestre

Un anno è **completo** se è precedente all'anno di `now` e la serie ha
almeno un punto nell'anno prima (serve la chiusura di fine anno
precedente come base). L'anno in corso non è mai completo.

Una finestra di N anni comprende gli ultimi N anni completi. La
finestra "tutto" comprende tutti gli anni completi. Le finestre 5, 10 e
20 esistono solo se gli anni completi sono almeno N; "tutto" esiste
sempre. La finestra predefinita è 10 se esiste, altrimenti "tutto".

Con meno di 3 anni completi non si calcola nulla: la funzione
principale restituisce `null`.

### Rendimenti mensili

Per ogni mese di ogni anno: ultima chiusura del mese / ultima chiusura
del mese precedente − 1. Un mese senza punti, o senza punti nel mese
precedente, non ha valore (`null`). Il mese in corso ha un valore
parziale, segnato come tale.

Il rendimento dell'anno è quello di `yearlyReturns` in
`lib/performance.ts`.

### Medie per mese

Per ciascuno dei 12 mesi, sugli anni della finestra che hanno un
valore per quel mese: media aritmetica dei rendimenti, numero di anni
positivi, numero di anni con valore. Un rendimento pari a zero non
conta come positivo.

### Curva stagionale

Per ogni anno della finestra: andamento cumulato rispetto all'ultima
chiusura dell'anno precedente, per ciascun giorno di calendario dal
1° gennaio al 31 dicembre. Nei giorni senza chiusura vale l'ultimo
valore disponibile; prima della prima chiusura dell'anno vale zero. Il
29 febbraio è escluso, quindi ogni anno ha 365 valori.

La curva è la media dei valori degli anni della finestra, giorno per
giorno: 365 valori in percentuale.

La curva dell'anno in corso è calcolata allo stesso modo, fino al
giorno di `now`.

### Giorno della settimana

Rendimento giornaliero = chiusura / chiusura del punto precedente − 1,
attribuito al giorno della settimana del punto. Si considerano solo le
coppie di punti distanti al massimo 4 giorni di calendario, così i
tratti di storico più radi del giornaliero restano fuori. Si usano i
punti che cadono negli anni della finestra.

Per ciascun giorno da lunedì a venerdì: rendimento medio, quota di
giorni positivi, numero di giorni. Un giorno della settimana senza
dati è omesso.

### Ciclo presidenziale USA

Ogni anno completo è classificato dal resto della divisione per 4:
0 anno di elezione, 1 anno post-elezione, 2 metà mandato, 3 anno
pre-elezione. Per ciascun tipo: rendimento annuo medio, anni positivi,
numero di anni. Questo blocco usa sempre tutti gli anni completi, non
la finestra scelta: su 10 anni ci sarebbero solo 2 o 3 casi per tipo.
Il risultato indica anche il tipo dell'anno di `now`.

### Funzione principale

`seasonality(points, now)` restituisce `null` oppure:

- `years`: una riga per anno, dall'anno in corso al primo anno
  completo: anno, 12 rendimenti mensili (`number | null`), rendimento
  dell'anno, indicatore di anno parziale. Serve la tabella per tutte le
  finestre.
- `windows`: una voce per finestra esistente: chiave (`5`, `10`, `20`,
  `all`), primo e ultimo anno, medie per mese, curva stagionale,
  statistiche per giorno della settimana.
- `defaultWindow`: chiave della finestra predefinita.
- `currentYearCurve`: curva dell'anno in corso.
- `electionCycle`: le quattro voci del ciclo e il tipo dell'anno in
  corso.
- `currentMonth`, `nextMonth`: indici dei mesi da evidenziare (dicembre
  è seguito da gennaio) e giorno dell'anno di oggi per la linea sulla
  curva.

## Interfaccia

Nuova voce in `StockTabs` in `app/stock/[symbol]/page.tsx`, dopo
"Andamento", con contenuto `SeasonalityPanel`. La pagina passa
`fullHistory` e `now`, già disponibili.

`SeasonalityPanel` è un componente server: chiama
`seasonality(points, now)` e passa il risultato a `SeasonalityView`,
componente client che tiene la finestra selezionata e compone i
blocchi. Dall'alto:

1. **Selettore finestra**: bottoni "5 anni", "10 anni", "20 anni",
   "Tutto", solo per le finestre esistenti. Accanto, il periodo
   coperto: "2016–2025".
2. **Frase su adesso**: "Novembre è stato positivo 8 anni su 10, in
   media +4,2%. Dicembre: 6 su 10, in media +1,1%." Cambia con la
   finestra.
3. **Curva stagionale**: linea della media da gennaio a dicembre, linea
   dell'anno in corso sovrapposta fino a oggi, linea verticale su oggi,
   linea dello zero, etichette dei mesi sull'asse.
4. **Medie per mese**: 12 barre verdi o rosse con percentuale, sotto
   ogni barra "8/10". Mese in corso e successivo evidenziati.
5. **Anno per mese**: tabella con una riga per anno (anno in corso in
   cima, poi gli anni della finestra dal più recente), colonne
   gen–dic e totale anno. Celle verdi o rosse, vuote dove manca il
   valore; i valori parziali hanno stile attenuato. La tabella scorre
   in orizzontale dentro il suo riquadro; la pagina no.
6. **Giorno della settimana**: 5 barre con rendimento medio e quota di
   giorni positivi.
7. **Ciclo presidenziale USA**: 4 barre con rendimento annuo medio e
   "X su N", tipo dell'anno in corso evidenziato. Sotto il titolo:
   "Calcolato su tutto lo storico."

I tre blocchi a barre (mesi, giorni, ciclo) usano lo stesso componente
di grafico a barre.

In fondo, una nota: prezzi di chiusura corretti per gli split,
dividendi esclusi, fonte Yahoo Finance; la stagionalità descrive il
passato e non è una previsione. Se `sparseBefore` non è `null`, la nota
avvisa che prima di quella data i dati sono meno fitti dei giornalieri,
come in "Andamento".

Testi in italiano, numeri e date formattati `it-IT`, percentuali con
`formatPct` di `lib/performance.ts`. Ogni grafico ha un `aria-label`
che ne riassume il contenuto; il selettore espone lo stato selezionato.
Layout leggibile a larghezza telefono.

## Casi limite

- **Meno di 3 anni completi**: la tab mostra "Storico troppo breve per
  la stagionalità."
- **Yahoo non risponde e cache vuota** (serie vuota): la tab mostra
  "Storico non disponibile al momento."
- **Mese senza dati in un anno** (quotazione a metà anno,
  sospensione): cella vuota, escluso dalle medie; il denominatore di
  "X su N" è il numero di anni con valore.
- **Mese senza alcun valore nella finestra**: la barra non compare e
  la frase su quel mese è omessa.
- **Dicembre**: il mese successivo è gennaio.
- **Inizio gennaio**, prima della prima chiusura dell'anno: la curva
  dell'anno in corso è vuota; compaiono solo la media e la linea di
  oggi.
- **Storico a passo misto**: mesi e curva usano le date dei punti; i
  giorni della settimana escludono i tratti radi.
- **Finestra uguale a "tutto"** (esempio: esattamente 10 anni
  completi): entrambe le voci compaiono e mostrano gli stessi numeri.

## Test

Vitest, scritti prima del codice.

- `lib/seasonality.ts`, su serie costruite a mano: rendimento mensile
  e mese mancante; anni completi e finestre esistenti con 2, 3, 7, 12
  e 25 anni; finestra predefinita; medie per mese con conteggio dei
  positivi e zero non positivo; curva di un titolo che sale in modo
  identico ogni anno, uguale alla curva del singolo anno; esclusione
  del 29 febbraio; curva dell'anno in corso tronca a oggi; giorni
  della settimana con salto di fine settimana e con tratto
  settimanale escluso; classificazione del ciclo e tipo dell'anno in
  corso; dicembre seguito da gennaio; serie vuota.
- Componenti: frase e numeri attesi per la finestra predefinita; il
  selettore cambia frase, barre e righe della tabella; compaiono solo
  le finestre esistenti; i due messaggi di storico breve e non
  disponibile; mese in corso e successivo evidenziati; celle vuote e
  parziali nella tabella.

## Fuori da questo spec

- Rendimento atteso a 30, 60, 90 giorni dalla data di oggi.
- Confronto con un indice o con il settore.
- Stagionalità di volumi o volatilità.
- Mediana e altre statistiche oltre a media e conteggio dei positivi.
- Fondamentali extra e tecnici (sotto-progetti 3 e 4).
