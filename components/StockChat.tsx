'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { sseMessages } from '@/lib/sse'
import { MAX_CHARS, MAX_MESSAGES, type ChatTurn } from '@/lib/chat-request'
import styles from './StockChat.module.css'

type ErrorCode = 'rate_limited' | 'upstream' | 'timeout' | 'unavailable'

interface Message {
  role: 'user' | 'model'
  text: string
  sources?: { title: string; url: string }[]
  error?: ErrorCode
}

const ERRORS: Record<ErrorCode, string> = {
  rate_limited: 'Troppe richieste in poco tempo: riprova tra un minuto.',
  upstream: 'Il servizio non ha risposto: riprova.',
  timeout: 'La risposta ha impiegato troppo: riprova.',
  unavailable: 'La chat non è disponibile al momento.',
}

const SUGGESTIONS = ['Perché si è mosso oggi?', 'Ci sono notizie recenti rilevanti?', 'Quali sono i rischi principali?']

// A turn that failed (error or no text) is left out, together with its question, so the conversation keeps alternating.
function toHistory(messages: Message[]): ChatTurn[] {
  const out: ChatTurn[] = []
  for (let i = 0; i < messages.length; i++) {
    const next = messages[i + 1]
    if (messages[i].role === 'user' && next && next.role === 'model' && (next.error || !next.text)) {
      i++
      continue
    }
    out.push({ role: messages[i].role, text: messages[i].text })
  }
  return out
}

export function StockChat({ symbol, name }: { symbol: string; name: string }) {
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const busy = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => abortRef.current?.abort(), [])
  const returnFocus = useRef(false)
  useEffect(() => {
    if (open) inputRef.current?.focus()
    else if (returnFocus.current) {
      returnFocus.current = false
      launcherRef.current?.focus()
    }
  }, [open])
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  const full = toHistory(messages).length >= MAX_MESSAGES

  async function send(raw: string, base: Message[] = messages) {
    const question = raw.trim().slice(0, MAX_CHARS)
    if (!question || busy.current) return
    const history = toHistory(base)
    if (history.length >= MAX_MESSAGES) return

    busy.current = true
    setStreaming(true)
    setDraft('')
    setMessages([...base, { role: 'user', text: question }, { role: 'model', text: '' }])
    const controller = new AbortController()
    abortRef.current = controller
    const patch = (fn: (m: Message) => Message) => setMessages((cur) => cur.map((m, i) => (i === cur.length - 1 ? fn(m) : m)))

    try {
      const res = await fetch(`/api/stocks/${encodeURIComponent(symbol)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...history, { role: 'user', text: question }] }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const error: ErrorCode = res.status === 429 ? 'rate_limited' : res.status === 503 ? 'unavailable' : 'upstream'
        patch((m) => ({ ...m, error }))
        return
      }
      for await (const message of sseMessages(res.body)) {
        const data = JSON.parse(message.data)
        if (message.event === 'text') patch((m) => ({ ...m, text: m.text + data.delta }))
        else if (message.event === 'sources') patch((m) => ({ ...m, sources: data.items }))
        else if (message.event === 'error') patch((m) => ({ ...m, error: data.code }))
      }
    } catch {
      if (!controller.signal.aborted) patch((m) => ({ ...m, error: 'upstream' }))
    } finally {
      busy.current = false
      setStreaming(false)
    }
  }

  function retry() {
    const at = messages.map((m) => m.role).lastIndexOf('user')
    if (at !== -1) void send(messages[at].text, messages.slice(0, at))
  }

  function reset() {
    abortRef.current?.abort()
    busy.current = false
    setStreaming(false)
    setMessages([])
    setDraft('')
  }

  function close() {
    returnFocus.current = true
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(draft)
    }
  }

  const last = messages[messages.length - 1]
  const canRetry = !streaming && last?.role === 'model' && Boolean(last.error) && last.error !== 'unavailable'

  return (
    <>
      {!open && (
        <button ref={launcherRef} type="button" className={styles.launcher} aria-label={`Chiedi all’IA su ${symbol}`} onClick={() => setOpen(true)}>
          <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true" fill="currentColor">
            <path d="M8 0l1.7 5.3L15 7l-5.3 1.7L8 14l-1.7-5.3L1 7l5.3-1.7z" />
          </svg>
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className={styles.panel}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
          }}
        >
          <header className={styles.head}>
            <div>
              <h2 id={titleId} className={styles.title}>
                Chiedi all’IA su {symbol}
              </h2>
              <span className={styles.badge}>Scritto dall’IA</span>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.textButton} onClick={reset}>
                Nuova chat
              </button>
              <button type="button" className={styles.iconButton} aria-label="Chiudi" onClick={close}>
                ×
              </button>
            </div>
          </header>

          <div ref={listRef} className={styles.list} aria-live="polite">
            {messages.length === 0 && (
              <div className={styles.empty}>
                <p>Chiedimi di {name}: uso i dati dell’app e, per le notizie recenti, il web.</p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className={styles.suggestion} onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) =>
              m.role === 'model' && !m.text && !m.error ? null : (
                <div key={i} className={m.role === 'user' ? styles.user : styles.model}>
                  {m.text && <p className={styles.text}>{m.text}</p>}
                  {m.sources && m.sources.length > 0 && (
                    <p className={styles.sources}>
                      Fonti:{' '}
                      {m.sources
                        .filter((s) => /^https?:\/\//i.test(s.url))
                        .map((s) => (
                          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
                            {s.title}
                          </a>
                        ))}
                    </p>
                  )}
                  {m.error && <p className={styles.error}>{ERRORS[m.error]}</p>}
                </div>
              ),
            )}
            {canRetry && (
              <button type="button" className={styles.textButton} onClick={retry}>
                Riprova
              </button>
            )}
          </div>

          <div className={styles.composer}>
            {full ? (
              <p className={styles.hint}>La conversazione è lunga: avvia una nuova chat per continuare.</p>
            ) : (
              <textarea
                ref={inputRef}
                className={styles.input}
                rows={2}
                maxLength={MAX_CHARS}
                value={draft}
                placeholder={`Chiedi qualcosa su ${name}`}
                aria-label="La tua domanda"
                disabled={streaming}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
              />
            )}
            {streaming && (
              <button type="button" className={styles.stop} onClick={() => abortRef.current?.abort()}>
                Interrompi
              </button>
            )}
            <p className={styles.disclaimer}>Può contenere errori e non è consulenza finanziaria.</p>
          </div>
        </div>
      )}
    </>
  )
}
