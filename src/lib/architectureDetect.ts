/** Architecture request detection and detail-level selection (kept separate from AI I/O). */

export type ArchitectureDetail = "medium" | "detailed";

const ARCHITECTURE_HINT =
  /\b(architect(?:ure|ural)?|system design|system-design|microservice|micro-service|high[\s-]?level design|hld|lld|low[\s-]?level design|load balancer|message queue|event[\s-]?driven|distributed system|scalability|cdn|api gateway|data flow|sequence diagram|mermaid|component diagram|software design)\b/i;

const DETAILED_HINT =
  /\b(detailed architecture|more detail(?:ed)?|expand(?:ed)?(?:\s+the)?\s+architecture|expand(?:\s+this)?|zoom into|low[\s-]?level design|\blld\b|show internal services|deep dive|internal (?:service|design)|subsystem detail|full architecture|exhaustive)\b/i;

const MEDIUM_HINT =
  /\b(high[\s-]?level(?:\s+architecture)?|medium detail|overview|summary architecture|simple architecture|bird'?s[\s-]?eye)\b/i;

const FRESH_TOPIC_HINT =
  /\b(?:new|fresh|different|another|instead)\b[\s\S]{0,40}\b(?:architecture|system|design)\b|\b(?:architecture|system design|design(?:\s+the)?(?:\s+architecture)?)\s+(?:for|of)\s+/i;

const WELL_KNOWN_SYSTEM =
  /\b(uber|ola|netflix|amazon|aws|spotify|airbnb|instagram|whatsapp|youtube|twitter|x\.com|meta|facebook|tiktok|doordash|swiggy|zomato|stripe|shopify|discord|slack|github|gmail|google maps|ride[\s-]?hailing|food[\s-]?delivery)\b/i;

export function looksLikeArchitecture(
  prompt: string,
  hasScreenshot = false,
): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (ARCHITECTURE_HINT.test(text)) return true;
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
  const text = prompt.trim();
  if (!text) return "medium";
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

export function hasMermaidBlock(text: string): boolean {
  return /```mermaid[\s\S]*?```/i.test(text);
}

export function extractMermaidBlock(markdown: string): string | null {
  const match = markdown.match(/```mermaid\s*\n([\s\S]*?)```/i);
  return match?.[1]?.trim() ? match[1].trim() : null;
}
