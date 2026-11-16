import { VCP_STATUS_LABEL, type Criterion, type Level, type TrendTemplate, type Vcp } from '@/lib/minervini'
import type { MinerviniAnalysis } from '@/lib/minervini-data'
import styles from './MinerviniPanel.module.css'

const pct = (v: number) => `${Math.round(v * 100)}%`
const price = (v: number) => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Within 1% of the threshold: still a miss, but worth watching.
const NEAR_MISS = -0.01
// Minervini wants breakout volume at least 40% above average.
const BREAKOUT_VOLUME = 1.4
const TIGHT_CONTRACTION = 0.1

// The method asks three questions in order; a "no" stops the analysis there.
const STEPS = [
  {
    title: 'Sta salendo?',
    why: 'Minervini compra solo titoli già in salita. Lo si vede dalle medie mobili: il prezzo deve stare sopra, e le medie devono essere in fila, dalla più breve alla più lunga.',
    ids: [1, 2, 3, 4, 5],
  },
  {
    title: 'È tra i più forti?',
    why: 'Tra i titoli in salita cerca i leader: già lontani dai minimi dell’anno, vicini ai massimi, e saliti più degli altri.',
    ids: [6, 7, 8],
  },
]

const GLOSSARY = [
  ['Media mobile', 'Il prezzo medio degli ultimi 50, 150 o 200 giorni di borsa. Smussa gli alti e bassi quotidiani e mostra la direzione di fondo.'],
  ['Stage 2', 'La fase in cui un titolo sale con decisione: prezzo sopra le medie e medie in fila. È l’unica fase in cui Minervini compra.'],
  ['Forza relativa', 'Quanto è salito il titolo nell’ultimo anno rispetto agli altri, da 0 a 100. 70 vuol dire che ha fatto meglio del 70% dei titoli confrontati.'],
  ['Base (VCP)', 'Una pausa dopo la salita in cui il prezzo oscilla sempre meno: ogni discesa è più piccola della precedente. Segnala che i venditori si stanno esaurendo.'],
  ['Pivot', 'Il prezzo massimo dell’ultima oscillazione della base. Se il prezzo lo supera con molti scambi, la salita riparte: è il punto d’ingresso.'],
  ['Stop loss', 'Il prezzo a cui si vende per limitare la perdita se l’acquisto va male. Minervini non accetta più del 7-8% di perdita.'],
] as const

type Tone = 'gain' | 'warn' | 'loss'
type State = 'ok' | 'near' | 'ko' | 'na'

function isUnreliable(c: Criterion) {
  return c.id === 8 && c.value === 'non affidabile'
}

function stateOf(c: Criterion): State {
  if (isUnreliable(c)) return 'na'
  if (c.ok) return 'ok'
  return c.margin !== null && c.margin > NEAR_MISS ? 'near' : 'ko'
}

function toneOf(ok: number, total: number): Tone | 'na' {
  if (total === 0) return 'na'
  return ok === total ? 'gain' : ok === 0 ? 'loss' : 'warn'
}

const lower = (c: Criterion) => c.label.charAt(0).toLowerCase() + c.label.slice(1)

function verdict(t: TrendTemplate): { tone: Tone; title: string; text: string } {
  const missed = t.criteria.filter((c) => !c.ok && !isUnreliable(c))
  if (t.passed) return { tone: 'gain', title: 'Trend rialzista solido', text: `Supera tutti i ${t.total} controlli: è il tipo di titolo che Minervini prende in considerazione.` }
  if (t.stage2) return { tone: 'warn', title: 'In salita, ma non ancora un leader', text: `Il trend è sano, ma manca: ${missed.map(lower).join('; ')}.` }
  const trendMissed = missed.filter((c) => c.id <= 5)
  const near = trendMissed.some((c) => stateOf(c) === 'near')
  return {
    tone: 'loss',
    title: 'Per ora non è in salita',
    text: `Non supera ${trendMissed.length} controlli del trend su 5, quindi per Minervini non si compra: meglio aspettare.${near ? ' Alcuni mancano per meno dell’1%: vale la pena ricontrollare tra qualche settimana.' : ''}`,
  }
}

function action(t: TrendTemplate, vcp: Vcp): string | null {
  if (!t.stage2) return null
  if (vcp.pivot === null || vcp.suggestedStop === null || vcp.lastLow === null) return 'Nessun punto d’ingresso chiaro: si aspetta che il prezzo si fermi e formi una base.'
  const stop = `stop a ${price(vcp.suggestedStop)}`
  switch (vcp.status) {
    case 'forming':
      return `Da tenere d’occhio: si entra solo se il prezzo supera ${price(vcp.pivot)} con molti più scambi del solito, ${stop}.`
    case 'breakout':
      return vcp.volumeRatio !== null && vcp.volumeRatio >= BREAKOUT_VOLUME
        ? `Sta superando il pivot (${price(vcp.pivot)}) con scambi forti: è il momento d’ingresso del metodo, ${stop}.`
        : `Sta superando il pivot (${price(vcp.pivot)}), ma con pochi scambi: queste rotture spesso falliscono. Meglio una conferma.`
    case 'extended':
      return `Il prezzo è già più del 5% sopra il pivot (${price(vcp.pivot)}): comprare ora vuol dire inseguire. Si aspetta una nuova base.`
    case 'failed':
      return `La base si è rotta: il prezzo è sceso sotto l’ultimo minimo (${price(vcp.lastLow)}). Niente ingresso.`
    default:
      return null
  }
}

const MARK: Record<State, string> = { ok: '✓', near: '!', ko: '✗', na: '–' }
const STATUS: Record<State, string> = { ok: 'soddisfatto', near: 'mancato per poco', ko: 'non soddisfatto', na: 'non valutabile' }

function CriterionRow({ c }: { c: Criterion }) {
  const state = stateOf(c)
  return (
    <li className={styles.row} data-state={state} aria-label={`${c.label}: ${STATUS[state]}, ${c.value}`}>
      <span className={styles.mark} aria-hidden="true">
        {MARK[state]}
      </span>
      <span className={styles.rowLabel} aria-hidden="true">
        {c.label}
      </span>
      <span className={styles.rowValue} aria-hidden="true">
        {c.value}
      </span>
    </li>
  )
}

// Ideal order next to today's order: the clearest way to read criteria 1, 2, 4 and 5 at a glance.
function Ladder({ levels }: { levels: Level[] }) {
  const today = [...levels].sort((a, b) => b.value - a.value)
  const inPlace = today.filter((l, i) => l.key === levels[i].key).length
  return (
    <figure className={styles.ladder} aria-label={`Ordine di oggi, dal più alto: ${today.map((l) => `${l.label} ${price(l.value)}`).join(', ')}. ${inPlace} su 4 al posto giusto.`}>
      <div className={styles.ladderGrid} aria-hidden="true">
        <span className={styles.ladderHead}>Come dovrebbe essere</span>
        <span className={styles.ladderHead}>Com’è oggi</span>
        {levels.map((ideal, i) => {
          const actual = today[i]
          const match = actual.key === ideal.key
          return (
            <div key={ideal.key} className={styles.ladderRow}>
              <span className={styles.ladderIdeal}>{ideal.label}</span>
              <span className={styles.ladderActual} data-match={match}>
                <span>{actual.label}</span>
                <span className={styles.ladderValue}>{price(actual.value)}</span>
              </span>
            </div>
          )
        })}
      </div>
      <figcaption className={styles.ladderCaption}>Dall’alto in basso: il prezzo in cima, poi le medie dalla più breve alla più lunga.</figcaption>
    </figure>
  )
}

function StepHead({ n, title, why, chip, tone }: { n: number; title: string; why: string; chip: string | null; tone: Tone | 'na' }) {
  return (
    <header className={styles.stepHead}>
      <span className={styles.stepNum} aria-hidden="true">
        {n}
      </span>
      <h3 className={styles.stepTitle}>{title}</h3>
      {chip && (
        <span className={styles.chip} data-tone={tone}>
          {chip}
        </span>
      )}
      <p className={styles.why}>{why}</p>
    </header>
  )
}

function EntryStep({ template, vcp }: { template: TrendTemplate; vcp: Vcp }) {
  const hasBase = vcp.pivot !== null && vcp.suggestedStop !== null
  const why = 'Dopo la salita il prezzo si riposa, oscillando sempre meno. Si compra quando supera il massimo dell’ultima oscillazione (il pivot) con molti scambi, e si fissa subito uno stop poco sotto.'

  if (!template.stage2) {
    return (
      <section className={styles.card} aria-label="È il momento di entrare?">
        <StepHead n={3} title="È il momento di entrare?" why={why} chip="Non ancora" tone="na" />
        <p className={styles.hint}>Il punto d’ingresso si cerca solo se la risposta alla prima domanda è sì. Prima il trend, poi il momento.</p>
      </section>
    )
  }

  const last = vcp.contractions[vcp.contractions.length - 1]
  const maxDepth = Math.max(...vcp.contractions, 0.01)
  const tone: Tone = !hasBase || vcp.status === 'failed' ? 'loss' : vcp.status === 'forming' || vcp.status === 'breakout' ? 'gain' : 'warn'
  const chip = !hasBase ? 'Nessuna base' : VCP_STATUS_LABEL[vcp.status!]

  return (
    <section className={styles.card} aria-label="È il momento di entrare?">
      <StepHead n={3} title="È il momento di entrare?" why={why} chip={chip} tone={tone} />
      {!hasBase ? (
        <p className={styles.hint}>Nessuna base trovata. Cerchiamo almeno due discese, ognuna più piccola della precedente, per esempio 25% → 12% → 6%.</p>
      ) : (
        <div className={styles.vcp}>
          <div className={styles.barsWrap}>
            <div className={styles.bars} role="img" aria-label={`Discese della base: ${vcp.contractions.map(pct).join(', ')}`}>
              {vcp.contractions.map((d, i) => (
                <div key={i} className={styles.barCol}>
                  <div className={styles.barTrack}>
                    <div className={styles.bar} style={{ height: `${Math.max(8, (d / maxDepth) * 100)}%` }} data-last={i === vcp.contractions.length - 1} />
                  </div>
                  <span className={styles.barLabel}>{pct(d)}</span>
                </div>
              ))}
            </div>
            <p className={styles.barsCaption}>Le discese della base, ognuna più piccola</p>
          </div>
          <dl className={styles.tiles}>
            <div className={styles.tile}>
              <dt>Pivot, prezzo d’ingresso</dt>
              <dd>{price(vcp.pivot!)}</dd>
            </div>
            <div className={styles.tile}>
              <dt>Stop loss, 8% sotto</dt>
              <dd data-tone="loss">{price(vcp.suggestedStop!)}</dd>
            </div>
            <div className={styles.tile}>
              <dt>Ultima discesa</dt>
              <dd data-tone={last <= TIGHT_CONTRACTION ? 'gain' : undefined}>
                {pct(last)}
                <small>{last <= TIGHT_CONTRACTION ? 'stretta, bene' : 'ancora ampia'}</small>
              </dd>
            </div>
            <div className={styles.tile}>
              <dt>Scambi recenti</dt>
              <dd data-tone={vcp.volumeDryUp ? 'gain' : undefined}>
                {vcp.volumeDryUp ? 'In calo' : 'Non in calo'}
                <small>{vcp.volumeDryUp ? 'chi vende si sta esaurendo' : 'idealmente calano'}</small>
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  )
}

export function MinerviniPanel({ analysis }: { analysis: MinerviniAnalysis | null }) {
  if (!analysis) return <p className={styles.empty}>Dati insufficienti: servono almeno 222 giorni di quotazioni per applicare il metodo.</p>

  const { template, vcp, peerCount } = analysis
  const v = verdict(template)
  const next = action(template, vcp)
  const byId = new Map(template.criteria.map((c) => [c.id, c]))

  return (
    <div className={styles.panel}>
      <section className={styles.verdict} data-tone={v.tone} aria-labelledby="minervini-verdict-title">
        <div className={styles.verdictHead}>
          <h2 id="minervini-verdict-title" className={styles.verdictTitle}>
            {v.title}
          </h2>
          <span className={styles.score}>
            <strong>{template.passedCount}</strong>
            {` su ${template.total} controlli`}
          </span>
          {template.stage2 && <span className={styles.badge}>Stage 2</span>}
        </div>
        <div className={styles.meter} role="img" aria-label={`${template.passedCount} controlli superati su ${template.total}`}>
          {template.criteria.map((c) => (
            <span key={c.id} className={styles.segment} data-state={stateOf(c)} />
          ))}
        </div>
        <p className={styles.verdictText}>{v.text}</p>
        {next && <p className={styles.next}>{next}</p>}
      </section>

      <section className={styles.intro} aria-label="Come funziona il metodo">
        <p>
          Mark Minervini è un trader americano che ha vinto il campionato USA di investimento con rendimenti a tre cifre. Il suo metodo cerca titoli già in forte salita e dice quando comprarli
          rischiando poco. Fa tre domande, in ordine: se una risposta è no, ci si ferma lì.
        </p>
        <details className={styles.glossary}>
          <summary>Le parole del metodo</summary>
          <dl>
            {GLOSSARY.map(([term, text]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.scope}>
            Questa scheda guarda solo il prezzo. Minervini chiede anche utili e fatturato in forte crescita: li trovi nelle schede Valutazione e Bilanci.
          </p>
        </details>
      </section>

      {STEPS.map((s, i) => {
        const items = s.ids.map((id) => byId.get(id)).filter((c): c is Criterion => Boolean(c))
        const rated = items.filter((c) => !isUnreliable(c))
        const ok = rated.filter((c) => c.ok).length
        return (
          <section key={s.title} className={styles.card} aria-label={s.title}>
            <StepHead n={i + 1} title={s.title} why={s.why} chip={rated.length ? `${ok}/${rated.length}` : null} tone={toneOf(ok, rated.length)} />
            {i === 0 && <Ladder levels={template.levels} />}
            <ul className={styles.list}>
              {items.map((c) => (
                <CriterionRow key={c.id} c={c} />
              ))}
            </ul>
          </section>
        )
      })}

      <EntryStep template={template} vcp={vcp} />

      <p className={styles.note}>
        {peerCount >= 5
          ? `Forza relativa: il rendimento degli ultimi 12 mesi confrontato con altri ${peerCount} titoli tra watchlist e candidati. Minervini la misura contro tutto il mercato e preferisce valori sopra 90, quindi qui è un’indicazione approssimata.`
          : 'Forza relativa non calcolata: servono almeno 5 altri titoli tra watchlist e candidati per il confronto.'}{' '}
        Strumento di analisi, non un consiglio di investimento. Fonte: Yahoo Finance.
      </p>
    </div>
  )
}
