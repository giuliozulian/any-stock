import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { PriceChart } from '@/components/PriceChart'
import { PriceHistoryChart } from '@/components/PriceHistoryChart'
import { AnalystTrendChart } from '@/components/AnalystTrendChart'
import { InfoTip } from '@/components/InfoTip'
import { EarningsNote } from '@/components/EarningsNote'
import { InsightPanel } from '@/components/InsightPanel'
import { getIntradayHistory, getPriceHistory } from '@/lib/history'
import { NewsList } from '@/components/NewsList'
import { CompanyOverview } from '@/components/CompanyOverview'
import { WatchStar } from '@/components/WatchStar'
import { getIpoCalendar, getMetrics, getProfile, getQuote, type IpoEvent } from '@/lib/finnhub'
import { getYahooQuote } from '@/lib/yahoo-quote'
import { RefreshButton } from '@/components/RefreshButton'
import { FundamentalsGrid } from '@/components/FundamentalsGrid'
import { SinceWatching } from '@/components/SinceWatching'
import { AlertTargets } from '@/components/AlertTargets'
import { LiveChange, LivePrice, LiveStamp } from '@/components/live-quotes'
import { VerdictCard, ReasonsSection } from '@/components/EvaluationPanel'
import { VideoList } from '@/components/VideoList'
import { InsiderPanel } from '@/components/InsiderPanel'
import { StockTabs } from '@/components/StockTabs'
import { FairValueCard } from '@/components/FairValueCard'
import { altmanZ } from '@/lib/solidity'
import { FinancialAnalysis } from '@/components/FinancialAnalysis'
import { getAnnualFinancials } from '@/lib/fundamentals'
import { CongressPanel } from '@/components/CongressPanel'
import { getCongressTrades } from '@/lib/congress'
import { getInsiderData } from '@/lib/insider-data'
import { getRecentVideos, isYoutubeConfigured } from '@/lib/youtube'
import { evaluateStock } from '@/lib/evaluate'
import { refreshStockIfStale } from '@/lib/refresh'
import { marketCapStatus, peStatus, rangeStatus } from '@/lib/figure-status'
import styles from './page.module.css'

function formatMarketCap(millions: number | null): string {
  if (millions === null) return '—'
  if (millions >= 1_000_000) return `$${(millions / 1_000_000).toFixed(2)}T`
  if (millions >= 1_000) return `$${(millions / 1_000).toFixed(1)}B`
  return `$${millions.toFixed(0)}M`
}

function formatExchange(exchange: string): string {
  if (exchange.includes('NASDAQ')) return 'NASDAQ'
  if (exchange.includes('NYSE')) return 'NYSE'
  return exchange.split(' - ')[0]
}

async function findIpo(symbol: string): Promise<IpoEvent | null> {
  const day = 24 * 60 * 60 * 1000
  const now = Date.now()
  try {
    const events = await getIpoCalendar(new Date(now - 60 * day).toISOString().slice(0, 10), new Date(now + 120 * day).toISOString().slice(0, 10))
    return events.find((e) => e.symbol?.toUpperCase() === symbol) ?? null
  } catch {
    return null
  }
}

function IpoPreview({ ipo }: { ipo: IpoEvent }) {
  const when = new Date(`${ipo.date}T00:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <>
      <Link href="/ipo" className={styles.back}>
        ← IPO
      </Link>
      <header className={styles.header}>
        <div>
          <p className={styles.ticker}>
            {ipo.exchange ? `${ipo.exchange}: ` : ''}
            {ipo.symbol}
          </p>
          <h1 className={styles.name}>{ipo.name}</h1>
        </div>
      </header>
      <Suspense fallback={<p className={styles.stale}>Carico la descrizione…</p>}>
        <CompanyOverview symbol={ipo.symbol ?? ipo.name} name={ipo.name} />
      </Suspense>
      <dl className={styles.previewStats}>
        <div>
          <dt>Debutto in Borsa</dt>
          <dd>{when}</dd>
        </div>
        {ipo.price && (
          <div>
            <dt>Prezzo previsto</dt>
            <dd>{ipo.price} $</dd>
          </div>
        )}
        {ipo.totalValue ? (
          <div>
            <dt>Valore dell’offerta</dt>
            <dd>{ipo.totalValue >= 1e9 ? `${(ipo.totalValue / 1e9).toFixed(1)} mld $` : `${(ipo.totalValue / 1e6).toFixed(0)} mln $`}</dd>
          </div>
        ) : null}
        {ipo.status && (
          <div>
            <dt>Stato</dt>
            <dd>{ipo.status}</dd>
          </div>
        )}
      </dl>
      <p className={styles.stale}>Il titolo non è ancora quotato (o non ha ancora prezzi): quando inizia a scambiare qui compariranno prezzo e grafico.</p>
    </>
  )
}

async function StockPreview({ symbol }: { symbol: string }) {
  let profile: Awaited<ReturnType<typeof getProfile>> | null = null
  let quote: Awaited<ReturnType<typeof getQuote>> | null = null
  try {
    ;[profile, quote] = await Promise.all([getProfile(symbol), getQuote(symbol)])
  } catch {
    profile = null
  }

  const covered = Boolean(profile && profile.name)
  const [history, intraday, metrics, years] = await Promise.all([
    getPriceHistory(symbol),
    getIntradayHistory(symbol),
    covered ? getMetrics(symbol).catch(() => null) : Promise.resolve(null),
    covered ? getAnnualFinancials(symbol).catch(() => []) : Promise.resolve([]),
  ])
  const yahoo = covered ? null : await getYahooQuote(symbol)
  if (!covered && !yahoo) {
    const ipo = await findIpo(symbol)
    if (!ipo) notFound()
    return <IpoPreview ipo={ipo} />
  }

  const name = profile?.name || yahoo!.name
  const exchange = profile?.name ? formatExchange(profile.exchange) : yahoo!.exchange
  const price = covered ? quote?.currentPrice ?? 0 : yahoo!.price
  const pct = covered ? quote?.changePercent ?? null : yahoo!.changePct
  const currency = covered ? '$' : yahoo!.currency === 'EUR' ? '€' : yahoo!.currency === 'USD' ? '$' : `${yahoo!.currency} `
  const up = pct === null || pct >= 0
  return (
    <>
      <Link href="/" className={styles.back}>
        ← Watchlist
      </Link>
      <header className={styles.header}>
        <div>
          <p className={styles.ticker}>
            {exchange ? `${exchange}: ` : ''}
            {symbol}
          </p>
          <h1 className={styles.name}>{name}</h1>
          {covered && (
            <div className={styles.starRow}>
              <WatchStar symbol={symbol} watched={false} />
            </div>
          )}
        </div>
        {price > 0 && (
          <div className={styles.quote}>
            <div className={styles.heroRow}>
              <span className={styles.price}>
                {currency}
                {price.toFixed(2)}
              </span>
              {pct !== null && (
                <span className={`${styles.change} ${up ? styles.gain : styles.loss}`}>
                  {up ? '+' : '−'}
                  {Math.abs(pct).toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        )}
      </header>
      <Suspense fallback={<p className={styles.stale}>Carico la descrizione…</p>}>
        <CompanyOverview symbol={symbol} name={name} industry={profile?.industry} />
      </Suspense>
      {history.length > 1 && (
        <section className={styles.chartCard} aria-label="Andamento del prezzo">
          <h2 className={styles.sectionTitle}>Andamento del prezzo</h2>
          <PriceHistoryChart points={history} intraday={intraday.points} prevClose={intraday.prevClose} />
        </section>
      )}
      {covered && price > 0 && metrics && (
        <FairValueCard
          input={{ price, epsTTM: metrics.epsTTM, bookValuePerShare: metrics.bookValuePerShare ?? null, cashFlowPerShare: metrics.cashFlowPerShare ?? null, epsGrowth5Y: metrics.epsGrowth5Y, dividendYield: metrics.dividendYield }}
          altman={years.length > 0 ? altmanZ(years[years.length - 1], profile?.marketCapitalization ? profile.marketCapitalization * 1e6 : null) : null}
        />
      )}
      {metrics && (metrics.week52Low !== null || metrics.peRatio !== null) && (
        <dl className={styles.previewStats}>
          {metrics.week52Low !== null && metrics.week52High !== null && (
            <div>
              <dt>Range 52 settimane</dt>
              <dd>
                {currency}
                {metrics.week52Low.toFixed(2)} – {currency}
                {metrics.week52High.toFixed(2)}
              </dd>
            </div>
          )}
          {metrics.peRatio !== null && (
            <div>
              <dt>P/E</dt>
              <dd>{metrics.peRatio.toFixed(1)}</dd>
            </div>
          )}
          {profile?.marketCapitalization ? (
            <div>
              <dt>Capitalizzazione</dt>
              <dd>${(profile.marketCapitalization / 1000).toFixed(1)} mld</dd>
            </div>
          ) : null}
        </dl>
      )}
      <p className={styles.stale}>
        {covered
          ? 'Questo titolo non è nella tua watchlist. Premi la stella per aggiungerlo: scarico notizie, valutazione e trimestrali e li trovi qui.'
          : 'Questo titolo è quotato in una borsa che i dati gratuiti di Finnhub non coprono: posso mostrare solo il prezzo, non posso aggiungerlo alla watchlist.'}
      </p>
    </>
  )
}

async function StockDetail({ paramsPromise }: { paramsPromise: Promise<{ symbol: string }> }) {
  await connection()
  const { symbol: rawSymbol } = await paramsPromise
  const symbol = rawSymbol.toUpperCase()

  await refreshStockIfStale(symbol).catch(() => undefined)

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 100 },
      news: {
        orderBy: { publishedAt: 'desc' },
        take: 20,
        include: { analysis: true },
      },
      recommendations: { orderBy: { period: 'desc' }, take: 6 },
      insight: true,
    },
  })

  if (!stock) {
    return <StockPreview symbol={symbol} />
  }

  const latest = stock.snapshots[0]

  const earliestSnapshot =
    stock.snapshots.length > 1
      ? await prisma.priceSnapshot.findFirst({
          where: { stockId: stock.id },
          orderBy: { timestamp: 'asc' },
        })
      : null

  const [history, intraday, videos, insiders, congress, financials, metrics] = await Promise.all([
    getPriceHistory(stock.symbol),
    getIntradayHistory(stock.symbol),
    getRecentVideos(stock.symbol, stock.name),
    getInsiderData(stock.symbol),
    getCongressTrades(stock.symbol),
    getAnnualFinancials(stock.symbol),
    getMetrics(stock.symbol).catch(() => null),
  ])

  const evaluation = latest
    ? evaluateStock({
        latestSnapshot: {
          price: latest.price,
          week52High: latest.week52High,
          week52Low: latest.week52Low,
          relativePerf13W: latest.relativePerf13W,
          pegRatio: latest.pegRatio,
          roe: latest.roe,
          debtToEquity: latest.debtToEquity,
          netMargin: latest.netMargin,
          dividendYield: latest.dividendYield,
          payoutRatio: latest.payoutRatio,
          epsTTM: latest.epsTTM,
          epsGrowth5Y: latest.epsGrowth5Y,
        },
        earliestSnapshot: earliestSnapshot
          ? {
              price: earliestSnapshot.price,
              timestamp: earliestSnapshot.timestamp,
            }
          : null,
        newsAnalyses: stock.news.flatMap((n) => (n.analysis ? [{ ...n.analysis, publishedAt: n.publishedAt }] : [])),
        recentRecommendations: stock.recommendations.slice(0, 2).map((r) => ({
          period: r.period,
          strongBuy: r.strongBuy,
          buy: r.buy,
          hold: r.hold,
          sell: r.sell,
          strongSell: r.strongSell,
        })),
      })
    : null

  const position52w =
    latest && latest.week52High !== null && latest.week52Low !== null && latest.week52High > latest.week52Low
      ? Math.min(1, Math.max(0, (latest.price - latest.week52Low) / (latest.week52High - latest.week52Low)))
      : null

  const pe = peStatus(latest?.peRatio ?? null)
  const fairValueCard = (embedded: boolean) =>
    latest && metrics ? (
      <FairValueCard
        embedded={embedded}
        input={{ price: latest.price, epsTTM: metrics.epsTTM, bookValuePerShare: metrics.bookValuePerShare ?? null, cashFlowPerShare: metrics.cashFlowPerShare ?? null, epsGrowth5Y: metrics.epsGrowth5Y, dividendYield: metrics.dividendYield }}
        altman={financials.length > 0 ? altmanZ(financials[financials.length - 1], latest.marketCap === null ? null : latest.marketCap * 1e6) : null}
      />
    ) : null
  const cap = marketCapStatus(latest?.marketCap ?? null)
  const range = rangeStatus(position52w)

  const seriesTrendClass = stock.snapshots.length > 1 ? (stock.snapshots[0].price >= stock.snapshots[stock.snapshots.length - 1].price ? styles.gain : styles.loss) : ''

  return (
    <>
      <Link href="/" className={styles.back}>
        ← Watchlist
      </Link>

      <header className={styles.header}>
        <div>
          <p className={styles.ticker}>
            {formatExchange(stock.exchange)}: {stock.symbol}
          </p>
          <h1 className={styles.name}>{stock.name}</h1>
          <div className={styles.starRow}>
            <WatchStar symbol={stock.symbol} watched />
          </div>
        </div>

        {latest ? (
          <div className={styles.quote}>
            <div className={styles.heroRow}>
              <span className={styles.price}>
                <LivePrice symbol={stock.symbol} initial={latest.price} />
              </span>
              <LiveChange symbol={stock.symbol} initial={latest.changePct} className={styles.change} tones={{ gain: styles.gain, loss: styles.loss, flat: '' }} />
            </div>
            <div className={styles.quoteMeta}>
              <span>
                <LiveStamp symbol={stock.symbol} fallback={`Aggiornato ${latest.timestamp.toLocaleString()}`} />
              </span>
              <RefreshButton symbol={stock.symbol} />
            </div>
          </div>
        ) : (
          <div className={styles.quote}>
            <p className={styles.stale}>Nessun dato ancora: premi Refresh per scaricare l&apos;ultimo prezzo.</p>
            <RefreshButton symbol={stock.symbol} />
          </div>
        )}
      </header>

      <Suspense fallback={<p className={styles.stale}>Carico la descrizione…</p>}>
        <CompanyOverview symbol={stock.symbol} name={stock.name} />
      </Suspense>

      <div className={styles.alerts}>
        <AlertTargets symbol={stock.symbol} entryPrice={stock.entryPrice} sellPrice={stock.sellPrice} entryTriggered={stock.entryTriggeredAt !== null} sellTriggered={stock.sellTriggeredAt !== null} />
      </div>
      {latest && <SinceWatching symbol={stock.symbol} addedAt={stock.addedAt} entryPrice={earliestSnapshot?.price ?? latest.price} currentPrice={latest.price} />}
      <EarningsNote date={stock.nextEarningsDate} hour={stock.nextEarningsHour} epsEstimate={stock.nextEarningsEpsEstimate} dividendYield={latest?.dividendYield ?? null} />

      {!evaluation && fairValueCard(false)}

      <div className={styles.hero}>
        {latest && (
          <div className={styles.chartCol}>
            <section className={styles.chartCard} aria-labelledby="price-title">
              <h2 id="price-title" className={styles.sectionTitle}>
                Andamento del prezzo
                <InfoTip
                  label="Cos’è l’andamento del prezzo"
                  source="Yahoo Finance (chiusure giornaliere, query1.finance.yahoo.com), dati reali; se non disponibili, le tue rilevazioni salvate da Finnhub (/quote)"
                  formula="variazione del periodo = (ultimo prezzo − primo prezzo del periodo) ÷ primo prezzo × 100"
                >
                  <strong>Andamento del prezzo</strong>
                  <span>Mostra come è cambiato il prezzo di chiusura giorno per giorno. Passa il mouse (o il dito) sul grafico per vedere il prezzo di una data.</span>
                  <span>Serve a capire se il titolo sta salendo, scendendo o è fermo, e se il prezzo di oggi è alto o basso rispetto al periodo scelto.</span>
                </InfoTip>
              </h2>
              {history.length > 1 ? (
                <PriceHistoryChart points={history} intraday={intraday.points} prevClose={intraday.prevClose} />
              ) : stock.snapshots.length > 1 ? (
                <>
                  <div className={`${styles.chart} ${seriesTrendClass}`}>
                    <PriceChart snapshots={stock.snapshots} width={640} height={180} strokeWidth={2} />
                  </div>
                  <p className={styles.chartCaption}>
                    {stock.snapshots.length} rilevazioni dal {stock.snapshots[stock.snapshots.length - 1].timestamp.toLocaleDateString('it-IT')}
                  </p>
                </>
              ) : (
                <p className={styles.chartEmpty}>Storico non disponibile al momento: premi Refresh per aggiungere una rilevazione.</p>
              )}
            </section>

            <div className={styles.strip}>
              <dl className={styles.figures}>
                <div className={styles.figure}>
                  <dt>
                    P/E
                    <InfoTip
                      label="Cos’è il P/E"
                      source="Finnhub, campo peBasicExclExtraTTM (/stock/metric)"
                      formula="P/E = prezzo dell’azione ÷ utile per azione (ultimi 12 mesi). Giudizio: < 15 buono, 15–30 neutro, > 30 negativo, ≤ 0 azienda in perdita"
                    >
                      <strong>P/E (prezzo/utili)</strong>
                      <span>Quanti dollari paghi per ogni dollaro di utile annuo dell’azienda. Un P/E di 20 significa che il prezzo vale 20 anni di utili attuali.</span>
                      <span>Serve a capire se l’azione è cara o economica rispetto a quanto guadagna. Non entra direttamente nel giudizio, ma è alla base del PEG.</span>
                    </InfoTip>
                  </dt>
                  <dd className="numeral">{latest.peRatio?.toFixed(1) ?? '—'}</dd>
                  <p className={`${styles.figureStatus} ${styles[`tone_${pe.tone}`]}`}>{pe.label}</p>
                </div>
                <div className={styles.figure}>
                  <dt>
                    Capitalizzazione
                    <InfoTip
                      label="Cos’è la capitalizzazione"
                      source="Finnhub (/stock/profile2), campo marketCapitalization"
                      formula="capitalizzazione = prezzo × numero di azioni in circolazione. Dimensione: ≥ 200 mld colosso, ≥ 10 mld grande, ≥ 2 mld media, sotto piccola"
                    >
                      <strong>Capitalizzazione di mercato</strong>
                      <span>Il valore totale dell’azienda in borsa: prezzo dell’azione per numero di azioni (T = mille miliardi, B = miliardi).</span>
                      <span>Serve a capire la dimensione: le aziende più grandi sono in genere più stabili, quelle piccole più volatili.</span>
                    </InfoTip>
                  </dt>
                  <dd className="numeral">{formatMarketCap(latest.marketCap)}</dd>
                  <p className={`${styles.figureStatus} ${styles[`tone_${cap.tone}`]}`}>{cap.label}</p>
                </div>
              </dl>

              <section className={styles.range} aria-label="Intervallo a 52 settimane">
                <div className={styles.rangeHead}>
                  <span className={styles.rangeLabel}>
                    Intervallo 52 settimane
                    <InfoTip
                      label="Cos’è l’intervallo a 52 settimane"
                      source="Finnhub, campi 52WeekHigh e 52WeekLow (/stock/metric); prezzo attuale da /quote"
                      formula="posizione nel range = (prezzo − minimo) ÷ (massimo − minimo) × 100. Giudizio: < 25% vicino ai minimi, > 80% vicino ai massimi"
                    >
                      <strong>Intervallo a 52 settimane</strong>
                      <span>Il prezzo più basso e più alto dell’ultimo anno. Il pallino indica dove si trova il prezzo di oggi.</span>
                      <span>Vicino al minimo può essere un’occasione o un segnale di debolezza; vicino al massimo, forza o rischio di prezzo già alto. Entra nel segnale a breve termine.</span>
                    </InfoTip>
                  </span>
                  {position52w !== null && <span className={styles.rangePos}>al {Math.round(position52w * 100)}% del range</span>}
                </div>
                <div className={styles.rangeTrack}>{position52w !== null && <span className={styles.rangeMarker} style={{ left: `${position52w * 100}%` }} />}</div>
                <div className={`${styles.rangeEnds} numeral`}>
                  <span>{latest.week52Low?.toFixed(2) ?? '—'}</span>
                  <span>{latest.week52High?.toFixed(2) ?? '—'}</span>
                </div>
                <p className={`${styles.figureStatus} ${styles[`tone_${range.tone}`]}`}>{range.label}</p>
              </section>
            </div>
          </div>
        )}
        {evaluation && <VerdictCard evaluation={evaluation}>{fairValueCard(true)}</VerdictCard>}
      </div>

      <StockTabs
        tabs={[
          {
            id: 'valutazione',
            label: 'Valutazione',
            content: (
              <>
                {evaluation && <ReasonsSection evaluation={evaluation} />}
                <div className={styles.layout}>
                  {stock.recommendations.length > 0 && <AnalystTrendChart periods={stock.recommendations} />}
                  {evaluation && <FundamentalsGrid details={evaluation.details} />}
                </div>
              </>
            ),
          },
          {
            id: 'bilanci',
            label: 'Bilanci',
            content: (
              <>
                <FinancialAnalysis years={financials} marketCapMillions={latest?.marketCap ?? null} />
              </>
            ),
          },
          {
            id: 'insider',
            label: 'Insider e politici',
            content: (
              <>
                <InsiderPanel data={insiders} />

                <CongressPanel trades={congress} />
              </>
            ),
          },
          {
            id: 'notizie',
            label: 'Notizie e video',
            content: (
              <>
                {stock.insight && <InsightPanel insight={stock.insight} />}
                <section className={styles.news}>
                  <h2 className={styles.sectionTitle}>
                    Notizie recenti
                    <InfoTip
                      label="Come leggere le notizie"
                      source="Finnhub (/company-news) per i titoli reali; analisi di impatto fatta da un modello IA (Google Gemini, gemini-3.5-flash-lite) e salvata nel database; senza risposta del modello, parole chiave (lib/news-impact.ts)"
                      formula="il modello restituisce direzione, intensità 1-5, orizzonte e confidenza. Nel verdetto contano solo le notizie con confidenza alta, intensità ≥ 3 e degli ultimi 7 giorni: +1 per positiva, −1 per negativa; saldo ≥ +2 aggiunge 1 punto, ≤ −2 ne toglie 1"
                    >
                      <strong>Notizie e impatto stimato</strong>
                      <span>Le ultime notizie sul titolo. Il colore indica l’impatto probabile: verde positivo, rosso negativo, ambra neutro. Sotto trovi la motivazione dell’IA.</span>
                      <span>“Sul titolo” = parla direttamente dell’azienda; “indiretto” = riguarda concorrenti o il settore. È una stima di un modello, può sbagliare: non è una previsione.</span>
                    </InfoTip>
                  </h2>
                  <p className={styles.newsHint}>Impatto stimato da un’IA che legge ogni notizia, non è una previsione.</p>
                  <NewsList news={stock.news} stock={{ symbol: stock.symbol, name: stock.name }} />
                </section>

                {isYoutubeConfigured() && (
                  <section className={styles.news}>
                    <h2 className={styles.sectionTitle}>
                      Video recenti
                      <InfoTip
                        label="Come leggere i video"
                        source="YouTube Data API v3 (search.list), ricerca “nome azienda + ticker + stock”, solo video pubblicati negli ultimi 7 giorni, ordinati per rilevanza; prima i risultati di una ricerca in italiano (relevanceLanguage=it), poi quelli generici"
                        formula="filtro: publishedAfter = adesso − 7 giorni; massimo 6 risultati, italiani per primi; cache di 6 ore per titolo"
                      >
                        <strong>Video degli ultimi 7 giorni</strong>
                        <span>Analisi e commenti pubblicati su YouTube negli ultimi giorni su questo titolo. Sono opinioni di terzi: non sono verificati e non entrano nel giudizio.</span>
                        <span>Serve a farti un’idea del dibattito in corso e a trovare approfondimenti da guardare.</span>
                      </InfoTip>
                    </h2>
                    <VideoList videos={videos} />
                  </section>
                )}
              </>
            ),
          },
        ]}
      />
    </>
  )
}

export default function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  return (
    <main className={styles.shell}>
      <Suspense fallback={<p className={styles.stale}>Loading stock…</p>}>
        <StockDetail paramsPromise={params} />
      </Suspense>
    </main>
  )
}
