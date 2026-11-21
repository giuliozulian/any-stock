export type RuleKind = 'calcolo' | 'giudizio' | 'esterno'

export interface Rule {
  id: string
  rule: string
  kind: RuleKind
  // Book and page, or "scelta nostra" for a threshold the app chose.
  source: string
  // False when the rule is only in AI summaries or is our own choice; the model must say so when it relies on it.
  verified: boolean
}

// Bump on every change to RULES, so cached analyses made with an older rulebook are not reused.
export const RULEBOOK_VERSION = 3

// Differences from docs/minervini-rulebook.md, on purpose (tests/lib/minervini-rulebook.test.ts checks the rest):
// - RS1, M1, M2, F3 are 'esterno' here: the app has no data for them, so the model must mark them not assessable.
// - E4 is verified: the 10% definition of "extended" comes from Think & Trade Like a Champion, the document marks it as different from the AI summaries.
// - Rules are worded as a description of the method, never as an order to buy or sell.

const W = 'Trade Like a Stock Market Wizard'
const C = 'Think & Trade Like a Champion'

export const RULES: Rule[] = [
  { id: 'TT1', rule: 'Prezzo sopra le medie a 150 e 200 giorni', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT2', rule: 'Media a 150 giorni sopra la media a 200', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT3', rule: 'Media a 200 giorni in salita da almeno 1 mese (meglio 4-5)', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT4', rule: 'Media a 50 giorni sopra le medie a 150 e 200', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT5', rule: 'Prezzo sopra la media a 50 giorni', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT6', rule: 'Prezzo almeno 30% sopra il minimo a 52 settimane', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT7', rule: 'Prezzo entro il 25% dal massimo a 52 settimane', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT8', rule: 'Forza relativa almeno 70 su 100 (qui un percentile sui titoli confrontati, non il rating IBD)', kind: 'calcolo', source: `${W} pp. 79-80; proxy nostro`, verified: true },
  { id: 'B1', rule: 'Una base nello stage 2 dura da 5 a 26 settimane', kind: 'calcolo', source: `${W} p. 80`, verified: true },
  { id: 'B2', rule: 'Profondità della correzione di norma tra 15-20% e 35-40%, anche 50% in mercati volatili; oltre il 60% è troppo profonda', kind: 'calcolo', source: `${W} p. 245`, verified: true },
  { id: 'B3', rule: 'Una base piatta corregge al massimo il 10-15%', kind: 'calcolo', source: `${W} p. 229`, verified: true },
  { id: 'V1', rule: 'Da 2 a 6 contrazioni, tipicamente 2-4', kind: 'calcolo', source: `${W} pp. 197, 201`, verified: true },
  { id: 'V2', rule: 'Ogni contrazione è circa la metà della precedente', kind: 'calcolo', source: `${W} p. 199`, verified: true },
  { id: 'V3', rule: 'Esempi di sequenze valide: 22/8/2%, 32/14/7/3%', kind: 'giudizio', source: `${W} pp. 227, 233`, verified: true },
  { id: 'V4', rule: "Nell'ultima contrazione il volume è sotto la media a 50 giorni, con 1-2 giorni a volume molto basso", kind: 'calcolo', source: `${W} p. 225`, verified: true },
  { id: 'V5', rule: "L'ultima contrazione è molto stretta (esempi 2-5%); non c'è una soglia nei libri", kind: 'calcolo', source: 'esempi nei libri; soglia 7% nostra', verified: false },
  { id: 'V6', rule: "Il pivot è netto: il punto di minima offerta dopo l'ultima contrazione", kind: 'calcolo', source: `${W} p. 229`, verified: true },
  { id: 'V7', rule: 'Esistono ingressi alternativi (cup completion cheat, pivot nel manico)', kind: 'giudizio', source: `${W} p. 229`, verified: true },
  { id: 'V8', rule: 'Il prezzo è vicino al pivot, non già in fuga', kind: 'calcolo', source: `${W}`, verified: true },
  { id: 'E1', rule: 'Il metodo prevede l\'ingresso quando il prezzo rompe il pivot su volume in aumento', kind: 'calcolo', source: `${W} pp. 227-229`, verified: true },
  { id: 'E2', rule: "Il volume al breakout è più forte del solito; il libro non dà un numero (il 40-50% è di O'Neil)", kind: 'calcolo', source: `${W} p. 229`, verified: false },
  { id: 'E3', rule: "Zona d'acquisto fino al 5% sopra il pivot; ingresso vicino al punto di stop", kind: 'calcolo', source: `${C}; 5% scelta nostra`, verified: false },
  { id: 'E4', rule: "Un titolo oltre il 10% sopra l'ultimo consolidamento è esteso: non si compra, si aspetta un pullback o una nuova base", kind: 'calcolo', source: `${C}`, verified: true },
  { id: 'E5', rule: 'Tennis ball: ritorno al livello di rottura e ripartenza decisa', kind: 'giudizio', source: `${W} p. 237`, verified: true },
  { id: 'E6', rule: 'Dopo il breakout: follow-through, più giorni in rialzo che in calo, volume forte nei giorni in rialzo, chiusure vicine al massimo', kind: 'giudizio', source: `${C}`, verified: true },
  { id: 'E7', rule: 'Nel 40-50% dei casi il titolo torna al livello di rottura; è normale se recupera in pochi giorni o 1-2 settimane', kind: 'giudizio', source: `${C}`, verified: true },
  { id: 'S1', rule: "Lo stop si decide prima dell'ingresso e si esegue senza esitare", kind: 'calcolo', source: `${W} p. 295`, verified: true },
  { id: 'S2', rule: "Perdita massima assoluta 10%, perdita media 6-7% (l'app usa 8% sotto il prezzo pagato)", kind: 'calcolo', source: `${W} pp. 275, 301; 8% scelta nostra`, verified: true },
  { id: 'S4', rule: 'Rapporto guadagno/perdita almeno 2:1, obiettivo 3:1', kind: 'calcolo', source: `${W} p. 301`, verified: true },
  { id: 'S5', rule: 'Quando il guadagno è 3 volte il rischio, lo stop va almeno a pareggio', kind: 'calcolo', source: `${W} pp. 295, 307`, verified: true },
  { id: 'S6', rule: 'Si costruisce la posizione a scaglioni; non si fa la media al ribasso', kind: 'giudizio', source: `${W} p. 307`, verified: true },
  { id: 'S7', rule: 'In un mercato difficile gli stop si stringono (per esempio da 7-8% a 5-6%)', kind: 'calcolo', source: `${C}`, verified: true },
  { id: 'S8', rule: 'Il rischio si controlla quando si compra, non quando si vende: ingresso il più vicino possibile allo stop', kind: 'giudizio', source: `${C}`, verified: true },
  { id: 'X1', rule: 'Il metodo prevede di uscire in forza: quando il titolo corre in modo esaurito o ai primi segni di debolezza', kind: 'giudizio', source: `${W} p. 295`, verified: true },
  { id: 'X4', rule: "Segnali di distribuzione: il calo più forte dall'inizio dello stage 2, gap di esaurimento", kind: 'giudizio', source: `${W} p. 73`, verified: true },
  { id: 'X5', rule: 'Breakout in difficoltà: basso volume senza follow-through, tre minimi decrescenti su volume in aumento, chiusura sotto la media a 20 giorni su volume alto', kind: 'calcolo', source: `${C}`, verified: true },
  { id: 'RS1', rule: 'La linea RS (titolo/indice) sale e segna nuovi massimi dentro la base', kind: 'esterno', source: 'riassunti AI (IBD)', verified: false },
  { id: 'RS2', rule: 'I titoli forti mantengono la forza relativa mentre il mercato scende', kind: 'giudizio', source: `${W} p. 167`, verified: true },
  { id: 'M1', rule: 'Il mercato generale deve assecondare', kind: 'esterno', source: `${W} p. 165`, verified: true },
  { id: 'M2', rule: 'Tre stati del mercato e conteggio dei distribution day', kind: 'esterno', source: 'riassunti AI (IBD)', verified: false },
  { id: 'F1', rule: 'Utili e ricavi in accelerazione (nessuna soglia minima fissa nei libri)', kind: 'esterno', source: `${W} p. 101`, verified: true },
  { id: 'F2', rule: 'Utili per azione e ricavi dell\'ultimo trimestre in crescita oltre il 25% sullo stesso trimestre dell\'anno prima, ROE oltre il 15% (dati nel campo fundamentals)', kind: 'calcolo', source: 'CAN SLIM e report del notebook; soglie nostre', verified: false },
  { id: 'AV1', rule: 'Il prezzo sta sopra il VWAP ancorato al minimo della base (campo avwap)', kind: 'calcolo', source: 'Anchored VWAP (Shannon) nel report del notebook', verified: false },
  { id: 'F3', rule: 'Filtri di liquidità: prezzo almeno 10 $, volume 500k, controvalore 20 M$', kind: 'esterno', source: 'scelta nostra', verified: false },
]

export const RULE_IDS = new Set(RULES.map((r) => r.id))

// One line per rule, for the system prompt: `TT1 [calcolo, confermata] Regola (fonte)`.
export function rulebookPrompt(): string {
  return RULES.map((r) => `${r.id} [${r.kind}, ${r.verified ? 'confermata' : 'non verificata'}] ${r.rule} (${r.source})`).join('\n')
}
