/** Architecture request detection and detail-level selection (kept separate from AI I/O). */

export type ArchitectureDetail = "medium" | "detailed";

// Note: bare "scalability" is NOT included — "What about scalability?" is an
 // aspect follow-up, not a request to regenerate a full architecture.
const ARCHITECTURE_HINT =
  /\b(architect(?:ure|ural)?|system design|system-design|microservice|micro-service|high[\s-]?level design|hld|lld|low[\s-]?level design|load balancer|message queue|event[\s-]?driven|distributed system|cdn|api gateway|data flow|sequence diagram|mermaid|component diagram|software design)\b/i;

/** Follow-ups that should refine one aspect of a prior architecture, not redraw it. */
const ASPECT_FOLLOW_UP =
  /^(?:what about|how about|and(?:\s+what about)?|also)\s+(scalability|reliability|security|caching|latency|throughput|availability|observability|monitoring|storage|database|auth(?:entication|orization)?|resilience|failure(?:\s+modes)?|cost|pricing)\??$/i;

const DETAILED_HINT =
  /\b(detailed architecture|more detail(?:ed)?|expand(?:ed)?(?:\s+the)?\s+architecture|expand(?:\s+this)?|zoom into|low[\s-]?level design|\blld\b|show internal services|deep dive|internal (?:service|design)|subsystem detail|full architecture|exhaustive)\b/i;

const MEDIUM_HINT =
  /\b(high[\s-]?level(?:\s+architecture)?|medium detail|overview|summary architecture|simple architecture|bird'?s[\s-]?eye)\b/i;

const FRESH_TOPIC_HINT =
  /\b(?:new|fresh|different|another|instead)\b[\s\S]{0,40}\b(?:architecture|system|design)\b|\b(?:architecture|system design|design(?:\s+the)?(?:\s+architecture)?)\s+(?:for|of)\s+/i;

const WELL_KNOWN_SYSTEM =
  /\b(uber|ola|netflix|amazon|aws|spotify|airbnb|instagram|whatsapp|youtube|twitter|x\.com|meta|facebook|tiktok|doordash|swiggy|zomato|stripe|shopify|discord|slack|github|gmail|google maps|ride[\s-]?hailing|food[\s-]?delivery)\b/i;

/** Asking what HLD/LLD/architecture *means*, not asking to produce a diagram. */
const CONCEPT_ASK =
  /\b(?:what\s+(?:is|are)|what'?s|define|definition\s+of|explain(?:\s+(?:what|the|how))?\b|difference\s+between|differences?\s+between|compare|meaning\s+of|tell\s+me\s+about)\b/i;

const ARCH_TERMS =
  /\b(hld|lld|high[\s-]?level(?:\s+design)?|low[\s-]?level(?:\s+design)?|system design|architecture|mermaid)\b/i;

/** Explicit generation / design verbs for a named system. */
const DESIGN_GENERATION =
  /\b(?:design|draw|generate|create|build|produce|write|draft|propose)\b[\s\S]{0,60}\b(?:architecture|hld|lld|system|diagram|mermaid)\b|\b(?:architecture|hld|lld|system design)\s+(?:for|of)\s+\w+/i;

/**
 * When Ask AI wraps a `Question:` line, detect architecture intent from that
 * line only — not from surrounding rules/context that may mention design terms.
 */
export function extractPrimaryAskIntent(prompt: string): string {
  const text = prompt.trim();
  const match = text.match(/\bQuestion:\s*([^\n]+)/i);
  if (match?.[1]?.trim()) return match[1].trim();
  return text;
}

/**
 * True when the user wants a definition/explanation of architecture concepts
 * (e.g. "What is HLD and LLD?") rather than a generated system design.
 */
export function isArchitectureConceptQuestion(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (!CONCEPT_ASK.test(text)) return false;
  if (!ARCH_TERMS.test(text)) return false;
  // "What is the architecture for Uber?" / "Design HLD for …" → generate.
  if (DESIGN_GENERATION.test(text)) return false;
  if (/\b(?:architecture|hld|lld|system design)\s+(?:for|of)\s+/i.test(text)) {
    return false;
  }
  return true;
}

/** "Design an e-commerce order management system" — generate, don't define. */
const DESIGN_A_SYSTEM =
  /\b(?:design|architect|draft|propose)\b[\s\S]{0,100}\b(?:system|architecture|platform|application|hld|lld)\b/i;

export function looksLikeArchitecture(
  prompt: string,
  hasScreenshot = false,
): boolean {
  const text = extractPrimaryAskIntent(prompt);
  if (!text) return false;
  // Definitional HLD/LLD questions must not open the Mermaid pipeline.
  if (isArchitectureConceptQuestion(text)) return false;
  if (ARCHITECTURE_HINT.test(text)) return true;
  if (DESIGN_A_SYSTEM.test(text)) return true;
  // Screenshot + explicit design wording only — avoid every "service/database" chat.
  if (
    hasScreenshot &&
    /\b(architecture|system design|design (?:this|the) system|draw (?:a |the )?diagram|mermaid)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export function getArchitectureDetail(prompt: string): ArchitectureDetail {
  const text = extractPrimaryAskIntent(prompt);
  if (!text) return "medium";
  // Concept questions never need detailed architecture generation.
  if (isArchitectureConceptQuestion(text)) return "medium";
  if (MEDIUM_HINT.test(text) && !DETAILED_HINT.test(text)) return "medium";
  if (DETAILED_HINT.test(text)) return "detailed";
  return "medium";
}

/** True when the user is starting a new system architecture, not expanding the prior one. */
export function isFreshArchitectureTopic(
  prompt: string,
  priorWasArchitecture: boolean,
): boolean {
  if (!priorWasArchitecture) return false;
  if (!looksLikeArchitecture(prompt, false)) return false;
  if (DETAILED_HINT.test(prompt)) return false;
  if (/\b(expand|more detail|refine|improve|same system|previous)\b/i.test(prompt)) {
    return false;
  }
  return FRESH_TOPIC_HINT.test(prompt) || WELL_KNOWN_SYSTEM.test(prompt);
}

/**
 * True when the user is asking about one aspect of an existing design
 * (e.g. "What about scalability?") rather than requesting a new full HLD.
 */
export function isArchitectureAspectFollowUp(prompt: string): boolean {
  const text = extractPrimaryAskIntent(prompt).trim();
  if (!text) return false;
  if (ASPECT_FOLLOW_UP.test(text)) return true;
  // Slightly looser: short question focused on one quality attribute.
  if (
    text.length <= 80 &&
    /\b(scalability|reliability|security|caching|latency|throughput|availability|observability)\b/i.test(
      text,
    ) &&
    !DESIGN_A_SYSTEM.test(text) &&
    !/\b(design|draw|generate|mermaid|full architecture|system design)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export function hasMermaidBlock(text: string): boolean {
  return /```mermaid[\s\S]*?```/i.test(text);
}

export function extractMermaidBlock(markdown: string): string | null {
  const match = markdown.match(/```mermaid\s*\n([\s\S]*?)```/i);
  return match?.[1]?.trim() ? match[1].trim() : null;
}
