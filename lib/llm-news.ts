// Default: Gemini tramite il suo endpoint compatibile OpenAI. LLM_API_KEY/LLM_BASE_URL/LLM_MODEL
// permettono di usare un altro provider compatibile (OpenAI, Groq...).
const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_MODEL = "gemini-3.5-flash-lite";

function config(): { key: string; baseUrl: string; model: string } | null {
  const custom = process.env.LLM_API_KEY;
  if (custom) {
    return {
      key: custom,
      baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
      model: process.env.LLM_MODEL || "gpt-4o-mini",
    };
  }
  const gemini = process.env.GEMINI_API_KEY;
  if (gemini) {
    return {
      key: gemini,
      baseUrl: process.env.LLM_BASE_URL || GEMINI_BASE_URL,
      model: process.env.LLM_MODEL || GEMINI_MODEL,
    };
  }
  return null;
}
const TIMEOUT_MS = 20_000;

export type Direction = "positive" | "negative" | "neutral";
export type Horizon = "short" | "medium" | "long";
export type Scope = "direct" | "indirect";
export type Confidence = "low" | "medium" | "high";

export interface LlmNewsAnalysis {
  direction: Direction;
  intensity: number;
  horizon: Horizon;
  scope: Scope;
  confidence: Confidence;
  rationale: string;
  digest: string | null;
  model: string;
}

export interface NewsAnalysisContext {
  stock: { symbol: string; name: string };
  news: {
    headline: string;
    summary: string | null;
    source: string;
    publishedAt: Date;
  };
  market?: {
    price: number;
    changePct: number;
    week52Low: number | null;
    week52High: number | null;
    pe: number | null;
  };
}

const SYSTEM_PROMPT = `Sei un analista azionario prudente. Ricevi una notizia e un titolo quotato in borsa.
Valuta l'impatto probabile della notizia sul prezzo di QUEL titolo, solo in base al contenuto fornito.
Non inventare fatti e non fare previsioni di prezzo. Se la notizia non riguarda davvero il titolo o non ha contenuto utile, usa direction "neutral" e confidence "low".
Rispondi SOLO con un oggetto JSON con questi campi:
- direction: "positive" | "negative" | "neutral"
- intensity: intero da 1 (trascurabile) a 5 (molto rilevante)
- horizon: "short" (giorni/settimane) | "medium" (mesi) | "long" (anni)
- scope: "direct" (riguarda l'azienda) | "indirect" (riguarda settore, concorrenti o mercato)
- confidence: "low" | "medium" | "high" (quanto il testo fornito basta a giudicare)
- digest: mini riassunto della notizia in italiano, 2 frasi (massimo 300 caratteri): cosa è successo, con i fatti e i numeri principali, senza giudizi
- rationale: spiegazione in italiano, 1-2 frasi, massimo 220 caratteri, in parole semplici`;

export function isLlmConfigured(): boolean {
  return config() !== null;
}

export function parseLlmAnalysis(
  raw: unknown,
  model: string,
): LlmNewsAnalysis | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const direction = r.direction;
  const horizon = r.horizon;
  const scope = r.scope;
  const confidence = r.confidence;
  const intensity =
    typeof r.intensity === "number" ? Math.round(r.intensity) : NaN;
  const digest = typeof r.digest === "string" && r.digest.trim() ? r.digest.trim().slice(0, 400) : null;
  const rationale = typeof r.rationale === "string" ? r.rationale.trim() : "";

  if (
    direction !== "positive" &&
    direction !== "negative" &&
    direction !== "neutral"
  )
    return null;
  if (horizon !== "short" && horizon !== "medium" && horizon !== "long")
    return null;
  if (scope !== "direct" && scope !== "indirect") return null;
  if (confidence !== "low" && confidence !== "medium" && confidence !== "high")
    return null;
  if (!Number.isFinite(intensity) || intensity < 1 || intensity > 5)
    return null;
  if (rationale.length === 0) return null;

  return {
    direction,
    intensity,
    horizon,
    scope,
    confidence,
    rationale: rationale.slice(0, 300),
    digest,
    model,
  };
}

function buildUserPrompt({ stock, news, market }: NewsAnalysisContext): string {
  const lines = [
    `Titolo: ${stock.name} (${stock.symbol})`,
    market
      ? `Dati attuali: prezzo $${market.price.toFixed(2)}, variazione oggi ${market.changePct.toFixed(2)}%` +
        (market.week52Low !== null && market.week52High !== null
          ? `, range 52 settimane $${market.week52Low}-$${market.week52High}`
          : "") +
        (market.pe !== null ? `, P/E ${market.pe.toFixed(1)}` : "")
      : null,
    `Fonte: ${news.source}, pubblicata il ${news.publishedAt.toISOString().slice(0, 10)}`,
    `Titolo notizia: ${news.headline}`,
    `Riassunto: ${news.summary?.trim() || "(non disponibile)"}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export async function requestLlmJson(
  system: string,
  user: string,
): Promise<{ json: unknown; model: string } | null> {
  const cfg = config();
  if (!cfg) return null;
  const { key: token, model } = cfg;
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const request = () =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 3000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  // Picchi di domanda temporanei (503) e rate limit (429): un solo nuovo tentativo.
  let res = await request();
  if (res.status === 503 || res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await request();
  }

  if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);

  const text = await res.text();
  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Il provider LLM ha risposto con un contenuto non JSON (${res.status} ${res.headers.get("content-type")}): "${text.slice(0, 40).trim()}"`,
    );
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return { json: JSON.parse(content), model };
  } catch {
    return null;
  }
}

export async function analyzeNewsWithLlm(
  ctx: NewsAnalysisContext,
): Promise<LlmNewsAnalysis | null> {
  const result = await requestLlmJson(SYSTEM_PROMPT, buildUserPrompt(ctx));
  if (!result) return null;
  return parseLlmAnalysis(result.json, result.model);
}
