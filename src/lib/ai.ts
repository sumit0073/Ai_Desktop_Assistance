import {
  type ArchitectureDetail,
  extractMermaidBlock,
  getArchitectureDetail,
  hasMermaidBlock,
  isFreshArchitectureTopic,
  looksLikeArchitecture,
} from "./architectureDetect";
import {
  normalizeMermaidInMarkdown,
  replaceFirstMermaidBlock,
  validateMermaidStructure,
} from "./mermaidSanitize";

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
};

/** Keep enough thread context without blowing the request size. */
const MAX_HISTORY_MESSAGES = 12;
/** At most one LLM syntax repair after local sanitize. */
const MAX_MERMAID_REPAIR_ATTEMPTS = 1;

/** Groq free-tier OpenAI-compatible API (console.groq.com). */
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_TEXT_MODEL = "openai/gpt-oss-20b";
/** Free-tier chat model that accepts images. */
const DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b";

const SYSTEM_PROMPT = `You are Seecog, a desktop AI assistant for focus sessions and system design.

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

  return `You are Seecog Architecture — a senior software architect helping design clear system architectures.

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

function getApiKey(): string | undefined {
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

export const isGroqConfigured = Boolean(getApiKey());
/** @deprecated Use isGroqConfigured */
export const isGrokConfigured = isGroqConfigured;

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

type StreamDelta = {
  choices?: Array<{
    delta?: { content?: string | null };
    message?: { content?: string | null };
  }>;
};

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
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as StreamDelta;
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk?.(full);
        }
      } catch {
        // ignore malformed frames
      }
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

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const json = JSON.parse(payload) as StreamDelta;
        const delta =
          json.choices?.[0]?.delta?.content ??
          json.choices?.[0]?.message?.content;
        if (typeof delta === "string" && delta.length > 0) {
          full += delta;
          onChunk?.(full);
        }
      } catch {
        // Partial JSON can appear if a frame was split oddly; keep going.
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing.startsWith("data:")) {
    const payload = trailing.slice(5).trim();
    if (payload && payload !== "[DONE]") {
      try {
        const json = JSON.parse(payload) as StreamDelta;
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          full += delta;
          onChunk?.(full);
        }
      } catch {
        // ignore
      }
    }
  }

  if (!full.trim()) {
    throw new Error("AI returned an empty response.");
  }
  return full;
}

async function completeChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  onChunk?: (text: string) => void,
): Promise<string> {
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
    });
  } catch (error) {
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

  return readChatCompletionStream(response, onChunk);
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
  apiKey: string,
  detail: ArchitectureDetail,
  priorMessages: ChatMessage[],
  previous: string,
  onChunk?: (text: string) => void,
): Promise<string> {
  const system = buildArchitectureSystemPrompt(detail);
  return completeChat(
    apiKey,
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
    onChunk,
  );
}

async function repairInvalidMermaidSyntax(
  apiKey: string,
  detail: ArchitectureDetail,
  markdown: string,
  invalidChart: string,
  reason: string,
): Promise<string> {
  const fixed = await completeChat(apiKey, getTextModel(), [
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
  ]);
  const repairedBody = extractMermaidBlock(fixed) ?? fixed;
  const validation = validateMermaidStructure(repairedBody);
  if (!validation.ok) return markdown;
  return replaceFirstMermaidBlock(markdown, validation.chart);
}

/** Call Groq (OpenAI OSS / free models) for chat + optional screenshot analysis. */
export async function analyzeWithAi(input: AnalysisInput): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "Add VITE_GROQ_API_KEY to your .env file (from console.groq.com/keys), then restart the app.",
    );
  }

  const prompt = input.prompt?.trim() ?? "";
  const imageBase64 = input.imageBase64?.trim() || null;
  const hasScreenshot = Boolean(imageBase64 || input.hasScreenshot);
  const history = trimHistory(input.history);

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

  const onChunk = input.onChunk;

  let text = await completeChat(
    apiKey,
    model,
    [
      { role: "system", content: system },
      ...effectivePrior,
      { role: "user", content: toUserContent(userText, imageBase64) },
    ],
    onChunk,
  );

  const shouldHaveMermaid =
    useArchitecturePrompt &&
    (Boolean(input.forceArchitecture) ||
      looksLikeArchitecture(prompt, hasScreenshot) ||
      priorWasArchitecture ||
      /\b(architecture|mermaid|system design|major components)\b/i.test(text));

  if (shouldHaveMermaid && !hasMermaidBlock(text)) {
    text = await repairMissingArchitecture(
      apiKey,
      detail,
      effectivePrior,
      text,
      onChunk,
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
          apiKey,
          detail,
          normalized,
          validation.chart || block,
          validation.reason,
        );
        const next = extractMermaidBlock(normalized);
        if (!next) break;
        validation = validateMermaidStructure(next);
      }
    }
  }

  if (normalized !== text) onChunk?.(normalized);
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
    return "Groq API key rejected. Check VITE_GROQ_API_KEY in .env (console.groq.com/keys).";
  }
  if (response.status === 429) {
    return "Groq rate limit hit. Wait a moment and try again.";
  }
  if (response.status === 413 || response.status === 400) {
    return "Screenshot may be too large for Groq. Try again — captures are now compressed.";
  }

  return `Groq request failed (${response.status}).`;
}
