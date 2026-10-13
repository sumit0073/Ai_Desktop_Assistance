import {
  type ArchitectureDetail,
  extractMermaidBlock,
  getArchitectureDetail,
  hasMermaidBlock,
  isFreshArchitectureTopic,
  looksLikeArchitecture,
} from "./architectureDetect";
import { shouldAllowDirectGroqChat } from "./chatProxyValidation";
import { extractStreamDeltaText, type StreamDelta } from "./aiStreamParse";
import {
  normalizeMermaidInMarkdown,
  replaceFirstMermaidBlock,
  validateMermaidStructure,
} from "./mermaidSanitize";
import { isSupabaseConfigured, supabase } from "./supabase";

export type { ArchitectureDetail } from "./architectureDetect";
export {
  getArchitectureDetail,
  hasMermaidBlock,
  looksLikeArchitecture,
} from "./architectureDetect";

export type AnalysisHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  imageBase64?: string;
};

export type AnalysisInput = {
  prompt?: string;
  imageBase64?: string | null;
  hasScreenshot?: boolean;
  /** Prior turns (oldest → newest). Current prompt/image are sent separately. */
  history?: AnalysisHistoryMessage[];
  /** Called with the full text accumulated so far as each stream chunk arrives. */
  onChunk?: (text: string) => void;
  /** Force architecture pipeline (e.g. Expand Architecture button). */
  forceArchitecture?: boolean;
  /** Override detail detection when expanding. */
  architectureDetail?: ArchitectureDetail;
  /** Abort in-flight stream (tests / future UI cancel). */
  signal?: AbortSignal;
  /** Optional access token override (tests). */
  accessToken?: string;
};

/** Keep enough thread context without blowing the request size. */
const MAX_HISTORY_MESSAGES = 12;
/** At most one LLM syntax repair after local sanitize. */
const MAX_MERMAID_REPAIR_ATTEMPTS = 1;

/**
 * SECURITY:
 * - Production MUST use `VITE_CHAT_PROXY_URL` (Supabase Edge Function `chat-proxy`).
 * - Direct Groq calls require `VITE_ALLOW_DIRECT_GROQ_CHAT=true` in DEV only.
 * - Never ship `VITE_GROQ_API_KEY` in production builds.
 * - See docs/ai-security.md
 */

/** Groq OpenAI-compatible API — DEV direct path only. */
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_TEXT_MODEL = "openai/gpt-oss-20b";
/** Free-tier chat model that accepts images. */
const DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b";

const SYSTEM_PROMPT = `You are System Bunny, a desktop AI assistant for focus sessions and system design.

Style rules (ChatGPT-like):
- Use clean Markdown: short headings, bold key terms, bullet lists when helpful.
- Keep structure readable — not a giant wall of text.
- Prefer clear explanations; add a short follow-up offer when useful.
- For normal screenshots (not architecture), say what matters on screen, any blocker/error, and one concrete next action.
- When prior messages exist, continue that thread. Do not ask which topic the user means if the subject is already clear.`;

const MERMAID_DIAGRAM_RULES = `## Mermaid diagram rules (must render cleanly)
- ALWAYS use \`flowchart TB\` — vertical STACK only (NEVER \`flowchart LR\` / sideways-long layouts)
- Stack formation (like grandfather → father → son): each layer sits BELOW the one above
  1. TOP — Clients / users
  2. MIDDLE-UPPER — API Gateway / edge / auth
  3. MIDDLE — Core domain services
  4. LOWER — Messaging / realtime (when relevant)
  5. BOTTOM — Data stores / caches
- Declare subgraphs in that exact top→bottom order
- Inside each subgraph put \`direction LR\` so peer boxes in the SAME layer sit side-by-side; the layers themselves still stack top→bottom
- Edges are downward connectors only: upper-layer node \`-->\` lower-layer node. Do not chain layers left-to-right
- Compact but readable: short labels (2–4 words), prefer fewer wider layers over one sideways-long ribbon
- Do not cram — keep enough nodes to stay recognizable; do not sprawl empty horizontal chains
- Prefer ~3–6 boxes per layer when possible so the stack stays balanced
- Use \`sequenceDiagram\` / \`erDiagram\` only when the user explicitly asks for that diagram type
- Meaningful unique CamelCase node IDs (TripService, RedisCache) — IDs are not display labels
- Every node needs a short human-readable label
- Use shapes: \`[Service]\`, \`[(Database/Cache)]\`, messaging as \`[(Kafka)]\` or \`[WebSocket Gateway]\`, externals as \`[[Payment Provider]]\` when useful
- Organize into clear subgraphs with unique CamelCase id + quoted title, typically:
  - \`subgraph clients["Clients"]\`
  - \`subgraph apiGateway["API Gateway"]\` (auth/edge here when relevant)
  - \`subgraph coreServices["Core Services"]\`
  - \`subgraph messaging["Messaging"]\` when async/realtime matters
  - \`subgraph dataStores["Data Stores"]\`
  - Optional \`subgraph external["External"]\` for third parties
- NEVER mangle ids like \`subgraph ApiLayer_API_Layer\` or duplicate the title in the id
- Avoid nested subgraphs unless they clearly help
- Explicit edges only: one \`-->\` (sync) or \`-.->\` (async/events) per line
- Connect services only to the stores/queues they actually use — do not wire every service to every database
- Label only important edges; keep labels to a few words
- No \`%%\` comments, no \`click\`/\`link\`, no HTML in labels, no external URLs
- Prefer a readable medium HLD; if the design is huge, keep one clear stacked overview rather than an unreadable giant`;

function buildArchitectureSystemPrompt(detail: ArchitectureDetail): string {
  const detailBlock =
    detail === "detailed"
      ? `## Detail level: DETAILED
- Target about 25–50 meaningful nodes when the system warrants it
- Prefer a clear expanded diagram; if too large, use one primary diagram and note what a second diagram would cover
- Expand: individual services, service-to-service calls, API vs event flows, DB ownership, caches/indexes, brokers, authn/z, integrations, retries/timeouts/idempotency, scaling/replication/partitioning, observability, key failure paths
- Preserve component names and boundaries from any prior architecture in this thread
- Do not invent irrelevant services just to raise the node count`
      : `## Detail level: MEDIUM (default)
- Target about 12–25 meaningful nodes, adjusted to complexity
- Optimize for clarity: clients, entry points, major services, primary DBs/caches, messaging/realtime when relevant, external integrations, main request/data flows
- Prefer a readable overview over exhaustive infrastructure`;

  return `You are System Bunny Architecture — a senior software architect helping design clear system architectures.

Understand the requested system before drawing. Identify clients, entry points, application/domain services, databases, caches, messaging, external integrations, and infrastructure only when relevant.
Distinguish synchronous request/response from asynchronous event flows.
Do not claim insider knowledge of Uber, Netflix, Amazon, etc. When inventing a plausible design, label decisions as **design recommendations**.
Do not add irrelevant services just to look detailed.

${detailBlock}

## Output order (architecture responses only)
1. **Title** — \`# Architecture: <System>\` (or \`# Detailed Architecture: <System>\` in detailed mode)
2. **Brief overview** — 2–4 sentences
3. **Architecture diagram** — \`## Architecture Diagram\` then ONE \`\`\`mermaid flowchart TB\`\`\` (vertical stack only)
4. **Major components** — \`## Major Components\` table: \`| Component | Responsibility |\`
5. **Database / storage** — \`## Database and Storage Strategy\` table: \`| Store | Type | What it holds | Why |\`
6. **Key workflows** — \`## Key Workflows\` — 2–4 named workflows with numbered steps
7. **Scalability and reliability** — short bullets
8. **Assumptions and trade-offs** — short bullets

Keep supporting text concise. The diagram is the primary visual.

${MERMAID_DIAGRAM_RULES}

Example (medium — vertical stack; adapt layers to the system):
\`\`\`mermaid
flowchart TB
  subgraph clients["Clients"]
    direction LR
    RiderApp[Rider App]
    DriverApp[Driver App]
  end
  subgraph edge["Edge and API"]
    direction LR
    Gateway[API Gateway]
  end
  subgraph domain["Domain Services"]
    direction LR
    TripSvc[Trip Service]
    MatchSvc[Matching Service]
  end
  subgraph async["Async Messaging"]
    direction LR
    Kafka[(Kafka)]
  end
  subgraph data["Data"]
    direction LR
    PrimaryDB[(Primary DB)]
    Redis[(Redis)]
  end
  RiderApp --> Gateway
  DriverApp --> Gateway
  Gateway --> TripSvc
  Gateway --> MatchSvc
  TripSvc --> Kafka
  MatchSvc --> Kafka
  TripSvc --> PrimaryDB
  MatchSvc --> Redis
\`\`\``;
}

export function getChatProxyUrl(): string | undefined {
  const url = (import.meta.env.VITE_CHAT_PROXY_URL as string | undefined)?.trim();
  return url || undefined;
}

/** DEV-only client key — never read outside import.meta.env.DEV for DCE. */
function getClientDevApiKey(): string | undefined {
  if (!import.meta.env.DEV) return undefined;
  const key =
    (import.meta.env.VITE_GROQ_API_KEY as string | undefined) ||
    (import.meta.env.VITE_XAI_API_KEY as string | undefined);
  if (
    !key ||
    key === "your-groq-api-key" ||
    key === "your-xai-api-key" ||
    key.trim().length < 10
  ) {
    return undefined;
  }
  return key.trim();
}

function getTextModel(): string {
  return (
    (import.meta.env.VITE_GROQ_MODEL as string | undefined)?.trim() ||
    (import.meta.env.VITE_XAI_MODEL as string | undefined)?.trim() ||
    DEFAULT_TEXT_MODEL
  );
}

function getVisionModel(): string {
  return (
    (import.meta.env.VITE_GROQ_VISION_MODEL as string | undefined)?.trim() ||
    DEFAULT_VISION_MODEL
  );
}

function chatRouting(): {
  mode: "proxy" | "direct_dev" | "unavailable";
  reason: string;
} {
  const proxyUrl = getChatProxyUrl();
  if (proxyUrl) return { mode: "proxy", reason: "proxy_configured" };
  const direct = shouldAllowDirectGroqChat({
    prod: import.meta.env.PROD,
    proxyUrl,
    allowDirectDevFlag: import.meta.env.VITE_ALLOW_DIRECT_GROQ_CHAT as
      | string
      | undefined,
  });
  if (direct.allow && getClientDevApiKey()) {
    return { mode: "direct_dev", reason: direct.reason };
  }
  return {
    mode: "unavailable",
    reason: import.meta.env.PROD
      ? "production_requires_proxy"
      : direct.reason,
  };
}

/** True when chat can run (proxy URL, or explicit DEV direct Groq). */
export function isAiConfigured(): boolean {
  return chatRouting().mode !== "unavailable";
}

/** @deprecated Use isAiConfigured */
export const isGroqConfigured = isAiConfigured;
/** @deprecated Use isAiConfigured */
export const isGrokConfigured = isAiConfigured;

async function resolveAccessToken(override?: string): Promise<string> {
  if (override?.trim()) return override.trim();
  if (!supabase || !isSupabaseConfigured) {
    throw new Error(
      "Supabase Auth is required for chat AI. Sign in, or configure VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.",
    );
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error("Could not read auth session for chat AI.");
  }
  const token = data.session?.access_token;
  if (!token) {
    throw new Error(
      "Sign in to use chat AI. Demo mode has no auth token for the secure proxy.",
    );
  }
  return token;
}

type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: ChatContent;
};

function imageMime(base64: string): "image/jpeg" | "image/png" {
  return base64.startsWith("/9j/") ? "image/jpeg" : "image/png";
}

async function groqFetch(
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return await tauriFetch(input, {
      ...init,
      connectTimeout: 90_000,
    } as RequestInit & { connectTimeout?: number });
  } catch {
    return fetch(input, init);
  }
}

function appendSsePayload(
  payload: string,
  full: string,
  onChunk?: (text: string) => void,
): string {
  if (!payload || payload === "[DONE]") return full;
  try {
    const json = JSON.parse(payload) as StreamDelta;
    const piece = extractStreamDeltaText(json);
    if (piece) {
      const next = full + piece;
      onChunk?.(next);
      return next;
    }
  } catch {
    // ignore malformed / partial frames
  }
  return full;
}

/** Parse OpenAI/Groq SSE chat.completion.chunk frames into text deltas. */
async function readChatCompletionStream(
  response: Response,
  onChunk?: (text: string) => void,
): Promise<string> {
  const body = response.body;
  if (!body) {
    const raw = await response.text();
    let full = "";
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      full = appendSsePayload(trimmed.slice(5).trim(), full, onChunk);
    }
    if (!full.trim()) throw new Error("AI returned an empty response.");
    return full;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      if (!trimmed.startsWith("data:")) continue;

      full = appendSsePayload(trimmed.slice(5).trim(), full, onChunk);
    }
  }

  const trailing = buffer.trim();
  if (trailing.startsWith("data:")) {
    full = appendSsePayload(trailing.slice(5).trim(), full, onChunk);
  }

  if (!full.trim()) {
    throw new Error("AI returned an empty response.");
  }
  return full;
}

type CompleteChatOptions = {
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
  accessToken?: string;
};

async function completeChatViaProxy(
  model: string,
  messages: ChatMessage[],
  options: CompleteChatOptions,
): Promise<string> {
  const proxyUrl = getChatProxyUrl();
  if (!proxyUrl) {
    throw new Error("VITE_CHAT_PROXY_URL is not configured.");
  }

  const accessToken = await resolveAccessToken(options.accessToken);
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  let response: Response;
  try {
    response = await groqFetch(proxyUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(anonKey ? { apikey: anonKey } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.35,
        stream: true,
      }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    if (/failed to fetch|networkerror|load failed/i.test(detail)) {
      throw new Error(
        "Could not reach the chat proxy (network). Check VITE_CHAT_PROXY_URL and try again.",
      );
    }
    throw new Error(detail || "AI request failed.");
  }

  if (!response.ok) {
    throw new Error(await safeErrorDetail(response));
  }

  return readChatCompletionStream(response, options.onChunk);
}

async function completeChatViaDirectGroqDev(
  model: string,
  messages: ChatMessage[],
  options: CompleteChatOptions,
): Promise<string> {
  const apiKey = getClientDevApiKey();
  if (!apiKey) {
    throw new Error(
      "Direct Groq chat requires VITE_GROQ_API_KEY plus VITE_ALLOW_DIRECT_GROQ_CHAT=true (local development only).",
    );
  }

  let response: Response;
  try {
    response = await groqFetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.35,
        stream: true,
      }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    if (/failed to fetch|networkerror|load failed/i.test(detail)) {
      throw new Error(
        "Could not reach Groq (network/CORS or image too large). Restart the app after the latest update and try Ctrl/⌘+H again.",
      );
    }
    throw new Error(detail || "AI request failed.");
  }

  if (!response.ok) {
    throw new Error(await safeErrorDetail(response));
  }

  return readChatCompletionStream(response, options.onChunk);
}

async function completeChat(
  model: string,
  messages: ChatMessage[],
  options: CompleteChatOptions = {},
): Promise<string> {
  const route = chatRouting();
  if (route.mode === "proxy") {
    return completeChatViaProxy(model, messages, options);
  }
  if (route.mode === "direct_dev") {
    return completeChatViaDirectGroqDev(model, messages, options);
  }
  if (import.meta.env.PROD) {
    throw new Error(
      "Chat AI requires VITE_CHAT_PROXY_URL in production. See docs/ai-security.md.",
    );
  }
  throw new Error(
    "Chat AI is not configured. Set VITE_CHAT_PROXY_URL, or for local development only set VITE_ALLOW_DIRECT_GROQ_CHAT=true and VITE_GROQ_API_KEY. See docs/ai-security.md.",
  );
}

function toUserContent(text: string, imageBase64?: string | null): ChatContent {
  const image = imageBase64?.trim() || null;
  if (!image) return text;
  return [
    { type: "text", text },
    {
      type: "image_url",
      image_url: {
        url: `data:${imageMime(image)};base64,${image}`,
      },
    },
  ];
}

function trimHistory(
  history: AnalysisHistoryMessage[] | undefined,
): AnalysisHistoryMessage[] {
  if (!history?.length) return [];
  let keptImage = false;
  const recent = history.slice(-MAX_HISTORY_MESSAGES);
  const out: AnalysisHistoryMessage[] = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    if (msg.role === "user" && msg.imageBase64) {
      if (keptImage) {
        out.push({ role: "user", content: msg.content });
      } else {
        keptImage = true;
        out.push(msg);
      }
    } else {
      out.push(msg);
    }
  }
  return out.reverse();
}

function historyAsTextOnly(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    typeof m.content === "string"
      ? m
      : {
          role: m.role,
          content:
            m.content.find((p) => p.type === "text")?.text ??
            "(prior screenshot message)",
        },
  );
}

async function repairMissingArchitecture(
  detail: ArchitectureDetail,
  priorMessages: ChatMessage[],
  previous: string,
  chatOpts: CompleteChatOptions,
): Promise<string> {
  const system = buildArchitectureSystemPrompt(detail);
  return completeChat(
    getTextModel(),
    [
      { role: "system", content: system },
      ...historyAsTextOnly(priorMessages),
      {
        role: "user",
        content:
          `Rewrite as a ${detail} architecture response with a valid \`\`\`mermaid flowchart TB\`\`\` block in vertical stack formation (top→bottom like grandfather→father→son — never sideways LR). ` +
          `Stack layers Clients → API Gateway → Core Services → Messaging → Data Stores; use direction LR inside each subgraph for peers; keep labels short and compact but readable. ` +
          `Preserve the same system intent and detail level (${detail}). ` +
          `Use system-specific subgraphs with unique ids and quoted titles (never mangled ids like ApiLayer_API_Layer). ` +
          `Then include Major Components, Database and Storage Strategy, Key Workflows, Scalability and reliability, and Assumptions and trade-offs.\n\nPrevious answer:\n` +
          previous,
      },
    ],
    chatOpts,
  );
}

async function repairInvalidMermaidSyntax(
  detail: ArchitectureDetail,
  markdown: string,
  invalidChart: string,
  reason: string,
  chatOpts: CompleteChatOptions,
): Promise<string> {
  const fixed = await completeChat(
    getTextModel(),
    [
      {
        role: "system",
        content:
          `You fix Mermaid flowchart syntax only. Preserve architecture meaning and ${detail} detail level. ` +
          `Return ONLY a \`\`\`mermaid flowchart TB\`\`\` fence — no prose. ` +
          `Vertical stack only: layers top→bottom, direction LR inside subgraphs, downward edges, short labels. ` +
          `Unique CamelCase subgraph ids with quoted titles; one edge per line; no comments/click/HTML.`,
      },
      {
        role: "user",
        content:
          `Validation error: ${reason}\n\nBroken chart:\n\`\`\`mermaid\n${invalidChart}\n\`\`\`\n\nReturn a corrected Mermaid block only.`,
      },
    ],
    { signal: chatOpts.signal, accessToken: chatOpts.accessToken },
  );
  const repairedBody = extractMermaidBlock(fixed) ?? fixed;
  const validation = validateMermaidStructure(repairedBody);
  if (!validation.ok) return markdown;
  return replaceFirstMermaidBlock(markdown, validation.chart);
}

/** Chat + optional screenshot analysis via authenticated chat-proxy (or DEV direct). */
export async function analyzeWithAi(input: AnalysisInput): Promise<string> {
  const route = chatRouting();
  if (route.mode === "unavailable") {
    if (import.meta.env.PROD) {
      throw new Error(
        "Chat AI requires VITE_CHAT_PROXY_URL in production. See docs/ai-security.md.",
      );
    }
    throw new Error(
      "Chat AI is not configured. Set VITE_CHAT_PROXY_URL, or for local development only set VITE_ALLOW_DIRECT_GROQ_CHAT=true and VITE_GROQ_API_KEY. See docs/ai-security.md.",
    );
  }

  const prompt = input.prompt?.trim() ?? "";
  const imageBase64 = input.imageBase64?.trim() || null;
  const hasScreenshot = Boolean(imageBase64 || input.hasScreenshot);
  const history = trimHistory(input.history);
  const chatOpts: CompleteChatOptions = {
    onChunk: input.onChunk,
    signal: input.signal,
    accessToken: input.accessToken,
  };

  if (!prompt && !hasScreenshot) {
    return "Share a question, or press Ctrl/⌘+H to capture the screen for analysis.";
  }

  const historyBlob = history.map((m) => m.content).join("\n");
  const priorWasArchitecture =
    looksLikeArchitecture(historyBlob, false) ||
    history.some((m) => m.role === "assistant" && hasMermaidBlock(m.content));

  const detail: ArchitectureDetail =
    input.architectureDetail ?? getArchitectureDetail(prompt);
  const freshTopic = isFreshArchitectureTopic(prompt, priorWasArchitecture);

  // Screenshots alone are not architecture. Follow-ups expand only when asked.
  const architectureMode =
    Boolean(input.forceArchitecture) ||
    looksLikeArchitecture(prompt, hasScreenshot) ||
    (priorWasArchitecture && !freshTopic && DETAILED_CONTINUE.test(prompt));

  const userText = buildUserText({
    prompt,
    hasScreenshot,
    architectureMode,
    detail,
    freshTopic,
    forced: Boolean(input.forceArchitecture),
  });

  const priorMessages: ChatMessage[] = history.map((m) =>
    m.role === "assistant"
      ? { role: "assistant", content: m.content }
      : { role: "user", content: toUserContent(m.content, m.imageBase64) },
  );

  // Drop prior architecture context when starting a clearly new system.
  const effectivePrior = freshTopic ? [] : priorMessages;

  const historyHasImage = effectivePrior.some(
    (m) => typeof m.content !== "string",
  );
  const model =
    imageBase64 || historyHasImage ? getVisionModel() : getTextModel();

  const useArchitecturePrompt = architectureMode;

  const system = useArchitecturePrompt
    ? `${buildArchitectureSystemPrompt(detail)}

If the input is NOT an architecture/system-design question, ignore the architecture pipeline and answer briefly like a normal assistant (what is on screen, blockers, one next action).
When prior messages exist and this is a follow-up, expand or refine that architecture — preserve component names and boundaries.
When marked as a new architecture topic, do not reuse the previous system's components.`
    : SYSTEM_PROMPT;

  let text = await completeChat(
    model,
    [
      { role: "system", content: system },
      ...effectivePrior,
      { role: "user", content: toUserContent(userText, imageBase64) },
    ],
    chatOpts,
  );

  const shouldHaveMermaid =
    useArchitecturePrompt &&
    (Boolean(input.forceArchitecture) ||
      looksLikeArchitecture(prompt, hasScreenshot) ||
      priorWasArchitecture ||
      /\b(architecture|mermaid|system design|major components)\b/i.test(text));

  if (shouldHaveMermaid && !hasMermaidBlock(text)) {
    text = await repairMissingArchitecture(
      detail,
      effectivePrior,
      text,
      chatOpts,
    );
  }

  let normalized = normalizeMermaidInMarkdown(text);

  if (shouldHaveMermaid && hasMermaidBlock(normalized)) {
    const block = extractMermaidBlock(normalized);
    if (block) {
      let validation = validateMermaidStructure(block);
      let attempts = 0;
      while (!validation.ok && attempts < MAX_MERMAID_REPAIR_ATTEMPTS) {
        attempts += 1;
        normalized = await repairInvalidMermaidSyntax(
          detail,
          normalized,
          validation.chart || block,
          validation.reason,
          chatOpts,
        );
        const next = extractMermaidBlock(normalized);
        if (!next) break;
        validation = validateMermaidStructure(next);
      }
    }
  }

  if (normalized !== text) chatOpts.onChunk?.(normalized);
  return normalized;
}

const DETAILED_CONTINUE =
  /\b(expand|more detail|detailed|zoom into|subsystem|internal services|lld)\b/i;

function buildUserText(opts: {
  prompt: string;
  hasScreenshot: boolean;
  architectureMode: boolean;
  detail: ArchitectureDetail;
  freshTopic: boolean;
  forced: boolean;
}): string {
  const { prompt, hasScreenshot, architectureMode, detail, freshTopic, forced } =
    opts;

  const detailNote =
    detail === "detailed"
      ? "Detail level: DETAILED — expand the design while preserving existing names/boundaries when prior architecture exists."
      : "Detail level: MEDIUM — optimize for a clear readable overview.";

  if (forced || (architectureMode && (prompt || !hasScreenshot))) {
    const base =
      prompt ||
      "Generate a software architecture diagram for this system with Mermaid, then Major Components, storage strategy, workflows, scalability, and assumptions.";
    const fresh = freshTopic
      ? "\n[New architecture topic — do not reuse previous system components.]"
      : "";
    return `${base}\n\n${detailNote}${fresh}`;
  }

  if (hasScreenshot) {
    return `${prompt || "Analyze this screen capture."}

${detailNote}
If this is clearly an architecture / system-design question: produce a Mermaid architecture diagram first, then components, storage, workflows, scalability, and assumptions.
Otherwise: summarize what is on screen, note blockers/errors, and one concrete next action.`;
  }

  return prompt;
}

async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    const message = body.error?.message || body.message;
    if (message) return `Groq API error: ${message}`;
  } catch {
    // ignore parse errors
  }

  if (response.status === 401 || response.status === 403) {
    return "Unauthorized for chat AI. Sign in again, or check the chat proxy configuration.";
  }
  if (response.status === 429) {
    return "Chat rate limit hit. Wait a moment and try again.";
  }
  if (response.status === 413 || response.status === 400) {
    return "Screenshot or prompt may be too large. Try again — captures are compressed.";
  }

  return `Chat request failed (${response.status}).`;
}
