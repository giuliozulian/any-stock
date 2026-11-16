import type { Criterion } from '@/lib/minervini'
import type { MinerviniAnalysis } from '@/lib/minervini-data'
import styles from './MinerviniPanel.module.css'

const pct = (v: number) => `${Math.round(v * 100)}%`
const price = (v: number) => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// The method as Minervini applies it: first the trend, then leadership, then a low-risk entry.
const STEPS = [
  {
    title: 'Trend',
    why: 'Si comprano solo titoli già in salita: il prezzo sta sopra le medie mobili e le medie sono in ordine, 50 sopra 150 sopra 200.',
    ids: [1, 2, 3, 4, 5],
  },
  {
    title: 'Forza',
    why: 'I vincenti sono lontani dai minimi, vicini ai massimi e salgono più degli altri titoli.',
    ids: [6, 7, 8],
  },
]

type Tone = 'gain' | 'warn' | 'loss'

function isUnreliable(c: Criterion) {
  return c.id === 8 && c.value === 'non affidabile'
}

function stateOf(c: Criterion) {
  return isUnreliable(c) ? 'na' : c.ok ? 'ok' : 'ko'
}

function toneOf(ok: number, total: number): Tone | 'na' {
  if (total === 0) return 'na'
  return ok === total ? 'gain' : ok === 0 ? 'loss' : 'warn'
}

function verdict(a: MinerviniAnalysis): { tone: Tone; title: string; text: string } {
  const { template } = a
  const missing = template.criteria.filter((c) => !c.ok && !isUnreliable(c)).map((c) => c.label.toLowerCase())
  if (template.passed) return { tone: 'gain', title: 'Trend rialzista solido', text: `Rispetta tutti i ${template.total} criteri del Trend Template.` }
  if (template.stage2) return { tone: 'warn', title: 'Trend rialzista, ma incompleto', text: `Il trend è sano, ma manca: ${missing.join('; ')}.` }
  return {
    tone: 'loss',
    title: 'Non è in un trend rialzista',
    text: 'Minervini compra solo titoli già in salita. Qui il prezzo non rispetta le medie mobili: meglio aspettare.',
  }
}

function action(a: MinerviniAnalysis): string | null {
  if (!a.template.stage2) return null
  const { vcp } = a
  if (vcp.pivot === null || vcp.suggestedStop === null) return 'Nessun punto d’ingresso chiaro: aspetta che il prezzo si consolidi in una base.'
  return `Possibile ingresso sopra ${price(vcp.pivot)}, con stop a ${price(vcp.suggestedStop)} (8% sotto).`
}

function CriterionRow({ c }: { c: Criterion }) {
  const state = stateOf(c)
  const status = state === 'na' ? 'non valutabile' : c.ok ? 'soddisfatto' : 'non soddisfatto'
  return (
    <li className={styles.row} data-state={state} aria-label={`${c.label}: ${status}`}>
      <span className={styles.mark} aria-hidden="true">
        {state === 'ok' ? '✓' : state === 'ko' ? '✗' : '–'}
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

export function MinerviniPanel({ analysis }: { analysis: MinerviniAnalysis | null }) {
  if (!analysis) return <p className={styles.empty}>Dati insufficienti: servono almeno 222 giorni di quotazioni per valutare il Trend Template.</p>

  const { template, vcp, peerCount } = analysis
  const v = verdict(analysis)
  const next = action(analysis)
  const byId = new Map(template.criteria.map((c) => [c.id, c]))
  const maxDepth = Math.max(...vcp.contractions, 0.01)
  const hasBase = vcp.pivot !== null && vcp.suggestedStop !== null

  return (
    <div className={styles.panel}>
      <section className={styles.verdict} data-tone={v.tone} aria-labelledby="minervini-verdict-title">
        <div className={styles.verdictHead}>
          <h2 id="minervini-verdict-title" className={styles.verdictTitle}>
            {v.title}
          </h2>
          <span className={styles.score}>
            <strong>{template.passedCount}</strong>
            {` su ${template.total} criteri`}
          </span>
          {template.stage2 && <span className={styles.badge}>Stage 2</span>}
        </div>
        <div className={styles.meter} role="img" aria-label={`${template.passedCount} criteri soddisfatti su ${template.total}`}>
          {template.criteria.map((c) => (
            <span key={c.id} className={styles.segment} data-state={stateOf(c)} />
          ))}
        </div>
        <p className={styles.verdictText}>{v.text}</p>
        {next && <p className={styles.next}>{next}</p>}
      </section>

      {STEPS.map((s, i) => {
        const items = s.ids.map((id) => byId.get(id)).filter((c): c is Criterion => Boolean(c))
        const rated = items.filter((c) => !isUnreliable(c))
        const ok = rated.filter((c) => c.ok).length
        return (
          <section key={s.title} className={styles.card} aria-label={s.title}>
            <StepHead n={i + 1} title={s.title} why={s.why} chip={rated.length ? `${ok}/${rated.length}` : null} tone={toneOf(ok, rated.length)} />
            <ul className={styles.list}>
              {items.map((c) => (
                <CriterionRow key={c.id} c={c} />
              ))}
            </ul>
          </section>
        )
      })}

      <section className={styles.card} aria-label="Ingresso (VCP)">
        <StepHead
          n={3}
          title="Ingresso (VCP)"
          why="Dopo il rialzo il prezzo si calma con oscillazioni sempre più piccole. Si entra quando supera il massimo precedente (il pivot), con uno stop corto."
          chip={hasBase ? 'Base trovata' : 'Nessuna base'}
          tone={hasBase ? 'gain' : 'loss'}
        />
        {!hasBase ? (
          <p className={styles.hint}>Nessuna base VCP rilevata: cerchiamo oscillazioni sempre più piccole, ad esempio 25% → 12% → 6%. Per ora non c’è un punto d’ingresso.</p>
        ) : (
          <div className={styles.vcp}>
            <div className={styles.bars} role="img" aria-label={`Contrazioni: ${vcp.contractions.map(pct).join(', ')}`}>
              {vcp.contractions.map((d, i) => (
                <div key={i} className={styles.barCol}>
                  <div className={styles.barTrack}>
                    <div className={styles.bar} style={{ height: `${Math.max(8, (d / maxDepth) * 100)}%` }} data-last={i === vcp.contractions.length - 1} />
                  </div>
                  <span className={styles.barLabel}>{pct(d)}</span>
                </div>
              ))}
            </div>
            <dl className={styles.tiles}>
              <div className={styles.tile}>
                <dt>Prezzo d’ingresso</dt>
                <dd>{price(vcp.pivot!)}</dd>
              </div>
              <div className={styles.tile}>
                <dt>Stop loss</dt>
                <dd data-tone="loss">{price(vcp.suggestedStop!)}</dd>
              </div>
              <div className={styles.tile}>
                <dt>Volume</dt>
                <dd data-tone={vcp.volumeDryUp ? 'gain' : undefined}>{vcp.volumeDryUp ? 'In calo' : 'Non in calo'}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      <p className={styles.note}>
        {peerCount >= 5
          ? `Forza relativa: rendimento a 12 mesi confrontato con altri ${peerCount} titoli tra watchlist e candidati.`
          : 'Forza relativa non affidabile: servono almeno 5 altri titoli tra watchlist e candidati.'}{' '}
        Strumento di analisi, non un consiglio di investimento. Fonte: Yahoo Finance.
      </p>
    </div>
  )
}
