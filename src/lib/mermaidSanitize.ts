const EDGE_OP = "(?:-->|---|==>|-.->|==|--|~~)";
const RESERVED =
  /^(end|subgraph|graph|flowchart|style|classDef|class|linkStyle|click|direction)$/i;

export type MermaidValidation =
  | { ok: true; chart: string }
  | { ok: false; reason: string; chart: string };

/** Strip Mermaid %% comments. */
export function stripMermaidPercentComments(chart: string): string {
  return chart
    .split("\n")
    .filter((line) => !/^\s*%%/.test(line))
    .map((line) => line.replace(/\s+%%.*$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeId(raw: string): string {
  let id = raw
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!id) id = "node";
  if (/^[0-9]/.test(id)) id = `n_${id}`;
  if (RESERVED.test(id)) id = `n_${id}`;
  return id;
}

function fixNodeDefLine(line: string): string {
  const m = line.match(
    /^(\s*)(.+?)(\[\[|\[\(|\[|\(\(|\(\[|\(|\{\{|\{)(.+)$/,
  );
  if (!m) return line;
  const [, indent, rawId, open, rest] = m;
  if (/-->|---|==>|subgraph/i.test(rawId)) return line;
  const id = safeId(rawId);
  return `${indent}${id}${open}${rest}`;
}

function fixEdgeLabel(label: string): string {
  return label
    .replace(/[:/\\&,;()]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28);
}

function shapeToken(token: string): string {
  const shaped = token
    .trim()
    .match(/^([A-Za-z][\w]*)(\[\[|\[\(|\[|\(\(|\(\[|\(|\{\{|\{)(.+)$/);
  if (shaped) {
    return `${safeId(shaped[1])}${shaped[2]}${shaped[3]}`;
  }
  return safeId(token);
}

function expandEdgeLine(line: string): string[] {
  const edgeRe = new RegExp(
    `^(\\s*)(\\S+?)\\s*(${EDGE_OP})\\s*(?:\\|([^|]*)\\|\\s*)?(.+?)\\s*$`,
  );
  const m = line.match(edgeRe);
  if (!m) return [line];

  const [, indent, fromRaw, op, label, toRaw] = m;
  const from = shapeToken(fromRaw);

  const shaped = toRaw.match(/^(.+?)(\[\[|\[\(|\[|\(\(|\(\[|\(|\{\{|\{)(.+)$/);
  if (shaped) {
    const to = safeId(shaped[1]);
    const mid = label ? `${op}|${fixEdgeLabel(label)}|` : op;
    return [`${indent}${from} ${mid} ${to}${shaped[2]}${shaped[3]}`];
  }

  const targets = toRaw
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (targets.length > 1 && targets.every((t) => /^[A-Za-z][\w-]*$/.test(t))) {
    const mid = label ? `${op}|${fixEdgeLabel(label)}|` : op;
    return targets.map((t) => `${indent}${from} ${mid} ${safeId(t)}`);
  }

  const mid = label ? `${op}|${fixEdgeLabel(label)}|` : op;
  return [`${indent}${from} ${mid} ${shapeToken(toRaw)}`];
}

/** Markdown table rows / separators that must never enter Mermaid. */
function isMarkdownTableLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|")) return false;
  // | --- | --- |  or  | Client | Responsibility |
  return /\|/.test(t.slice(1));
}

/** Turn invalid `id|Label|` pipe nodes into `id[Label]`. */
function fixPipeNodeSyntax(line: string): string {
  // Standalone: Foo|Label text|
  const alone = line.match(/^(\s*)([A-Za-z][\w]*)\|([^|]+)\|\s*$/);
  if (alone) {
    const label = alone[3].replace(/["']/g, "").trim() || alone[2];
    return `${alone[1]}${alone[2]}[${label}]`;
  }

  // Edge with pipe-shaped endpoints: a|L1| --> b|L2|
  return line.replace(
    /([A-Za-z][\w]*)\|([^|]+)\|/g,
    (_, id: string, label: string) => {
      const clean = String(label).replace(/["']/g, "").trim() || id;
      return `${id}[${clean}]`;
    },
  );
}

function insertMissingArrows(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [line];
  if (isMarkdownTableLine(line)) return [];
  if (
    /^(flowchart|graph|subgraph|end|classDef|style|linkStyle|click|direction)\b/i.test(
      trimmed,
    )
  ) {
    return [line];
  }

  const pipeFixed = fixPipeNodeSyntax(line);
  const working = pipeFixed;
  const workingTrim = working.trim();

  if (new RegExp(EDGE_OP).test(workingTrim)) return expandEdgeLine(working);
  if (/[[({]/.test(workingTrim)) return [fixNodeDefLine(working)];

  const parts = workingTrim.split(/\s+/);
  if (parts.length >= 2 && parts.every((p) => /^[A-Za-z][\w-]*$/.test(p))) {
    const indent = working.match(/^\s*/)?.[0] ?? "";
    return [`${indent}${parts.map(safeId).join(" --> ")}`];
  }
  return [working];
}

export function dedupeTitleWords(title: string): string {
  const words = title
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && prev.toLowerCase() === w.toLowerCase()) continue;
    out.push(w);
  }
  if (out.length >= 4 && out.length % 2 === 0) {
    const half = out.length / 2;
    const a = out.slice(0, half).join(" ").toLowerCase();
    const b = out.slice(half).join(" ").toLowerCase();
    if (a === b) return out.slice(0, half).join(" ");
  }
  // "API Layer API" odd-length near-duplicate
  if (out.length >= 3) {
    const mid = Math.floor(out.length / 2);
    const a = out.slice(0, mid).join(" ").toLowerCase();
    const b = out.slice(mid).join(" ").toLowerCase();
    if (a && b.startsWith(a)) return out.slice(0, mid).join(" ");
  }
  return out.join(" ");
}

function toCamelId(label: string): string {
  const words = label
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "group";
  return (
    words
      .map((w, i) => {
        const clean = w.replace(/[^A-Za-z0-9]/g, "");
        if (!clean) return "";
        if (i === 0) return clean.charAt(0).toLowerCase() + clean.slice(1);
        return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
      })
      .join("")
      .replace(/[^A-Za-z0-9]/g, "") || "group"
  );
}

function alnumLower(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/** Detect mangled ids like ApiLayer_API_Layer (title glued twice into the id). */
export function isMangledSubgraphId(id: string, title: string): boolean {
  if (!id) return true;
  const idNorm = alnumLower(id);
  const titleNorm = alnumLower(title);
  if (idNorm.length >= 6) {
    const mid = Math.floor(idNorm.length / 2);
    if (idNorm.slice(0, mid) === idNorm.slice(mid)) return true;
  }
  if (!titleNorm) return /_/.test(id) && idNorm.length > 18;
  if (idNorm === titleNorm + titleNorm) return true;
  if (idNorm.includes(titleNorm + titleNorm)) return true;
  // Id already encodes the title twice with separators: ApiLayer_API_Layer
  const parts = id.split(/_+/).filter(Boolean);
  if (parts.length >= 2) {
    const joined = parts.map((p) => p.toLowerCase()).join("");
    if (joined === titleNorm + titleNorm) return true;
    const half = Math.ceil(parts.length / 2);
    const a = parts.slice(0, half).join("").toLowerCase();
    const b = parts.slice(half).join("").toLowerCase();
    if (a && a === b) return true;
  }
  return false;
}

/** Turn ApiLayer_API_Layer into a single readable title. */
function demangleDisplayTitle(raw: string): string {
  const spaced = raw.replace(/_/g, " ").trim();
  const norm = alnumLower(raw);
  if (norm.length >= 6) {
    const mid = Math.floor(norm.length / 2);
    if (norm.slice(0, mid) === norm.slice(mid)) {
      const words = spaced.split(/\s+/).filter(Boolean);
      const halfWords = Math.max(1, Math.ceil(words.length / 2));
      return dedupeTitleWords(words.slice(0, halfWords).join(" "));
    }
  }
  return dedupeTitleWords(spaced);
}

/**
 * Normalize to: subgraph apiLayer["API LAYER"]
 * Preserve valid id + quoted title. Never emit ApiLayer_API_Layer as a title.
 */
export function fixSubgraphLine(line: string): string {
  const m = line.match(/^(\s*)subgraph\s+(.+?)\s*$/i);
  if (!m) return line;
  const indent = m[1];
  const rest = m[2].trim();

  let idToken = "";
  let titleToken = "";

  const quoted = rest.match(/^([A-Za-z][\w]*)\s*\[\s*["'](.+?)["']\s*\]$/);
  const bracketed = rest.match(/^([A-Za-z][\w]*)\s*\[\s*(.+?)\s*\]$/);
  if (quoted) {
    idToken = quoted[1];
    titleToken = quoted[2];
  } else if (bracketed) {
    idToken = bracketed[1];
    titleToken = bracketed[2].replace(/^["']|["']$/g, "");
  } else {
    // Bare: subgraph CLIENTS  OR  subgraph ApiLayer_API_Layer
    titleToken = rest.replace(/^\[|\]$/g, "").replace(/^["']|["']$/g, "");
  }

  const rawTitle = titleToken || idToken;
  let display = demangleDisplayTitle(rawTitle).trim();
  if (!display) display = "GROUP";

  // Prefer preserving a clean CamelCase id when the title is already separate.
  if (
    idToken &&
    /^[A-Za-z][\w]*$/.test(idToken) &&
    !isMangledSubgraphId(idToken, display)
  ) {
    return `${indent}subgraph ${idToken}["${display}"]`;
  }

  const id = toCamelId(display);
  return `${indent}subgraph ${id}["${display}"]`;
}

/**
 * Repair common LLM Mermaid mistakes so flowcharts actually parse.
 */
export function sanitizeMermaidChart(chart: string): string {
  let text = stripMermaidPercentComments(chart);

  text = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\u00a0/g, " ")
    // Literal escaped newlines from model / markdown joins
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  text = text
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Recover glued headers: "flowchart TBsubgraph" / "flowchart TBnode"
  text = text.replace(
    /\bflowchart\s*(TB|TD|LR|RL|BT)\s*(?=subgraph\b|[A-Za-z])/gi,
    "flowchart $1\n",
  );

  text = text
    .split("\n")
    .filter(
      (line) =>
        !isMarkdownTableLine(line) &&
        !/^\s*(click|link|call)\b/i.test(line) &&
        !/^\s*(style|classDef|class|linkStyle)\s*$/i.test(line),
    )
    .join("\n");

  if (
    !/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap)\b/m.test(
      text,
    )
  ) {
    text = `flowchart TB\n${text}`;
  }

  // Architecture diagrams must be top→bottom (pyramid), never sideways LR/RL.
  text = text.replace(/^\s*graph\s+/im, "flowchart ");
  text = text.replace(
    /^\s*flowchart\s+(LR|RL|BT|TD)\b/im,
    "flowchart TB",
  );
  text = text.replace(/^\s*flowchart\s*$/im, "flowchart TB");
  // Drop direction lines — we re-inject the correct ones below.
  text = text
    .split("\n")
    .filter((line) => !/^\s*direction\s+\w+\b/i.test(line))
    .join("\n");

  const out: string[] = [];
  const seenSubgraphIds = new Map<string, number>();
  for (const rawLine of text.split("\n")) {
    let line = rawLine.replace(/\t/g, "  ");
    if (/^\s*subgraph\b/i.test(line)) {
      let fixed = fixSubgraphLine(line);
      const idMatch = fixed.match(/^\s*subgraph\s+([A-Za-z][\w]*)/i);
      if (idMatch) {
        const base = idMatch[1];
        const count = seenSubgraphIds.get(base) ?? 0;
        seenSubgraphIds.set(base, count + 1);
        if (count > 0) {
          fixed = fixed.replace(
            /^\s*subgraph\s+[A-Za-z][\w]*/i,
            `${fixed.match(/^\s*/)?.[0] ?? ""}subgraph ${base}${count + 1}`,
          );
        }
      }
      out.push(fixed);
      // Peers within a layer sit side-by-side; flowchart TB stacks layers top→bottom.
      const indent = (fixed.match(/^\s*/)?.[0] ?? "") + "  ";
      out.push(`${indent}direction LR`);
      continue;
    }
    if (/^\s*flowchart\b/i.test(line)) {
      // Normalize header; keep any accidental same-line body.
      const indent = line.match(/^\s*/)?.[0] ?? "";
      out.push(`${indent}flowchart TB`);
      const rest = line
        .replace(/^\s*flowchart(?:\s+(?:LR|RL|BT|TD|TB))?\s*/i, "")
        .trim();
      if (rest) out.push(...insertMissingArrows(`${indent}${rest}`));
      continue;
    }
    if (/^\s*end\s*$/i.test(line)) {
      out.push(line);
      continue;
    }
    out.push(...insertMissingArrows(line));
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Structural validation after sanitization (no Mermaid runtime required).
 */
export function validateMermaidStructure(chart: string): MermaidValidation {
  const cleaned = sanitizeMermaidChart(chart);
  if (!cleaned) {
    return { ok: false, reason: "Empty diagram source.", chart: cleaned };
  }
  if (!/^(flowchart|graph)\b/m.test(cleaned)) {
    return {
      ok: false,
      reason: "Missing flowchart/graph header.",
      chart: cleaned,
    };
  }

  let depth = 0;
  const subgraphIds = new Set<string>();
  const nodeIds = new Set<string>();

  for (const raw of cleaned.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const sub = line.match(/^subgraph\s+([A-Za-z][\w]*)/i);
    if (sub) {
      if (subgraphIds.has(sub[1])) {
        return {
          ok: false,
          reason: `Duplicate subgraph id: ${sub[1]}`,
          chart: cleaned,
        };
      }
      subgraphIds.add(sub[1]);
      depth += 1;
      continue;
    }
    if (/^end$/i.test(line)) {
      depth -= 1;
      if (depth < 0) {
        return {
          ok: false,
          reason: "Unbalanced subgraph/end.",
          chart: cleaned,
        };
      }
      continue;
    }

    // Flag remaining adjacent bare identifiers that look like missing edges.
    if (
      !new RegExp(EDGE_OP).test(line) &&
      !/[[({]/.test(line) &&
      !/^(flowchart|graph|direction)\b/i.test(line)
    ) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2 && parts.every((p) => /^[A-Za-z][\w-]*$/.test(p))) {
        return {
          ok: false,
          reason: `Missing edge between nodes: ${line}`,
          chart: cleaned,
        };
      }
    }

    const nodeDef = line.match(/^([A-Za-z][\w]*)\s*[[({]/);
    if (nodeDef) nodeIds.add(nodeDef[1]);

    const edge = line.match(
      new RegExp(`^([A-Za-z][\\w]*)\\s*${EDGE_OP}`),
    );
    if (edge) nodeIds.add(edge[1]);
  }

  if (depth !== 0) {
    return { ok: false, reason: "Unbalanced subgraph/end.", chart: cleaned };
  }

  return { ok: true, chart: cleaned };
}

/**
 * Extra repair pass for stubborn parse errors (used after first failure).
 */
export function aggressiveMermaidRepair(chart: string): string {
  let text = sanitizeMermaidChart(chart);

  // Drop edge labels that still confuse the parser; keep the link op.
  text = text.replace(new RegExp(`(${EDGE_OP})\\|[^|]*\\|`, "g"), "$1");

  // Any remaining pipe pairs → square labels.
  text = text.replace(
    /([A-Za-z][\w]*)\|([^|\n]+)\|/g,
    (_, id: string, label: string) => {
      const clean = String(label).replace(/["']/g, "").trim() || id;
      return `${id}[${clean}]`;
    },
  );

  // Stray pipes (e.g. glued table cells) cannot appear in flowcharts.
  text = text
    .split("\n")
    .map((line) =>
      /^\s*(flowchart|graph|subgraph|end|direction)\b/i.test(line.trim())
        ? line
        : line.replace(/\|/g, " "),
    )
    .join("\n");

  text = text.replace(/\[([^\]]*)\]/g, (_, label: string) => {
    const clean = String(label)
      .replace(/["']/g, "")
      .replace(/[<>]/g, "")
      .trim();
    return `[${clean || "node"}]`;
  });

  return text;
}

const FENCED_MERMAID_RE = /```(?:mermaid)?\s*\n([\s\S]*?)```/gi;
const LOOSE_FLOWCHART_RE =
  /(?:^|\n)((?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap)\b[\s\S]*?)(?=\n{2,}#{1,3}\s|\n{2,}\*\*|\n{2,}\d+\.\s|$)/g;

function looksLikeMermaidSource(body: string): boolean {
  return /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap)\b/m.test(
    body.trim(),
  );
}

export function normalizeMermaidInMarkdown(markdown: string): string {
  let text = markdown;

  text = text.replace(FENCED_MERMAID_RE, (_full, body: string) => {
    const cleaned = sanitizeMermaidChart(String(body));
    if (!cleaned) return _full;
    if (
      !looksLikeMermaidSource(cleaned) &&
      !_full.toLowerCase().includes("```mermaid")
    ) {
      return _full;
    }
    return `\`\`\`mermaid\n${cleaned}\n\`\`\``;
  });

  if (!/```mermaid/i.test(text)) {
    text = text.replace(LOOSE_FLOWCHART_RE, (full, body: string) => {
      const cleaned = sanitizeMermaidChart(String(body));
      if (!looksLikeMermaidSource(cleaned)) return full;
      const prefix = full.startsWith("\n") ? "\n" : "";
      return `${prefix}\`\`\`mermaid\n${cleaned}\n\`\`\``;
    });
  }

  return text;
}

/** Replace the first mermaid fence body in markdown. */
export function replaceFirstMermaidBlock(
  markdown: string,
  nextChart: string,
): string {
  const cleaned = sanitizeMermaidChart(nextChart);
  let replaced = false;
  return markdown.replace(FENCED_MERMAID_RE, (full) => {
    if (replaced) return full;
    replaced = true;
    return `\`\`\`mermaid\n${cleaned}\n\`\`\``;
  });
}
