import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  aggressiveMermaidRepair,
  sanitizeMermaidChart,
  validateMermaidStructure,
} from "../lib/mermaidSanitize";
import {
  clampZoom,
  computeActualSizeZoom,
  computeExpandInitialZoom,
  computeFitScale,
  computeInlineScale,
  effectiveScalePercent,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
} from "../lib/mermaidViewerScale";

type Props = {
  chart: string;
};

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  parse?: (text: string) => Promise<unknown> | unknown;
  render: (
    id: string,
    text: string,
  ) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
};

declare global {
  interface Window {
    mermaid?: MermaidApi;
  }
}

const MERMAID_SOURCES = [
  "/vendor/mermaid.min.js",
  "https://cdn.jsdelivr.net/npm/mermaid@11.6.0/dist/mermaid.min.js",
];

let mermaidPromise: Promise<MermaidApi> | null = null;
let activeTheme: "dark" | "default" | null = null;
let activeLayoutRev = 0;
let renderSeq = 0;

/** Bump to force Mermaid re-init when flowchart layout knobs change. */
const MERMAID_LAYOUT_REV = 2;

type ArchLayer =
  | "clients"
  | "api"
  | "services"
  | "data"
  | "messaging"
  | "external";

const LAYER_MATCHERS: Array<{ test: RegExp; layer: ArchLayer }> = [
  { test: /client/i, layer: "clients" },
  { test: /api|gateway|auth|edge/i, layer: "api" },
  {
    test: /messag|async|kafka|queue|event|realtime|real[\s_-]*time|pubsub|web[\s_-]*socket/i,
    layer: "messaging",
  },
  {
    test: /data|store|database|cache|redis|storage|postgres|mongo/i,
    layer: "data",
  },
  { test: /external|third|partner|saas|vendor/i, layer: "external" },
  {
    test: /core|service|domain|microservice|micro[\s_-]*service/i,
    layer: "services",
  },
];

function readAppTheme(): "dark" | "default" {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "default";
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-seecog-mermaid="1"][src="${src}"]`,
    );
    if (existing) {
      if (window.mermaid) resolve();
      else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error(`Failed to load ${src}`)),
          { once: true },
        );
      }
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.seecogMermaid = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function loadMermaid(): Promise<MermaidApi> {
  if (window.mermaid) return window.mermaid;

  if (!mermaidPromise) {
    mermaidPromise = (async () => {
      let lastError: unknown;
      for (const src of MERMAID_SOURCES) {
        try {
          await loadScript(src);
          if (window.mermaid) return window.mermaid;
          lastError = new Error(`Mermaid global missing after ${src}`);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("Could not load Mermaid.");
    })().catch((err) => {
      mermaidPromise = null;
      throw err;
    });
  }

  return mermaidPromise;
}

/**
 * Dagre ships in the UMD bundle. Tight, even spacing + polyline edges reduce
 * empty cluster stretch and swoopy crossings vs basis curves.
 */
function applyTheme(api: MermaidApi) {
  const theme = readAppTheme();
  if (activeTheme === theme && activeLayoutRev === MERMAID_LAYOUT_REV) return;

  const dark = theme === "dark";
  api.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "base",
    fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
    flowchart: {
      htmlLabels: true,
      curve: "linear",
      padding: 16,
      nodeSpacing: 36,
      rankSpacing: 52,
      diagramPadding: 16,
      wrappingWidth: 160,
      useMaxWidth: false,
      defaultRenderer: "dagre-wrapper",
    },
    themeVariables: {
      darkMode: dark,
      background: "transparent",
      primaryColor: dark ? "#1e3a5f" : "#dbeafe",
      primaryTextColor: dark ? "#eaf2f7" : "#0f172a",
      primaryBorderColor: dark ? "#60a5fa" : "#2563eb",
      lineColor: dark ? "#94a3b8" : "#64748b",
      textColor: dark ? "#eaf2f7" : "#0f172a",
      clusterBkg: dark ? "#121a22" : "#f8fafc",
      clusterBorder: dark ? "#334155" : "#cbd5e1",
      titleColor: dark ? "#f1f5f9" : "#0f172a",
      edgeLabelBackground: dark ? "#1e293b" : "#ffffff",
      // Keep in sync with CSS — larger post-render fonts clip inside foreignObject.
      fontSize: "15px",
      fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
      tertiaryColor: dark ? "#1e293b" : "#f1f5f9",
    },
  });
  activeTheme = theme;
  activeLayoutRev = MERMAID_LAYOUT_REV;
}

async function getMermaid(): Promise<MermaidApi> {
  const api = await loadMermaid();
  applyTheme(api);
  return api;
}

function safeRenderId(prefix: string): string {
  renderSeq += 1;
  return `seecogmmd${prefix}${renderSeq}`;
}

function measureSvgSize(svgEl: SVGSVGElement): { w: number; h: number } {
  const vb = svgEl.viewBox?.baseVal;
  let w = vb?.width || 0;
  let h = vb?.height || 0;
  try {
    const bbox = svgEl.getBBox();
    w = w || bbox.width;
    h = h || bbox.height;
  } catch {
    w =
      w ||
      Number.parseFloat(svgEl.getAttribute("width") || "") ||
      svgEl.clientWidth;
    h =
      h ||
      Number.parseFloat(svgEl.getAttribute("height") || "") ||
      svgEl.clientHeight;
  }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

function detectLayer(haystack: string): ArchLayer | null {
  for (const rule of LAYER_MATCHERS) {
    if (rule.test.test(haystack)) return rule.layer;
  }
  return null;
}

/** Map node IDs → layer from subgraph membership in the Mermaid source. */
function buildNodeLayerMap(chart: string): Map<string, ArchLayer> {
  const map = new Map<string, ArchLayer>();
  let current: ArchLayer | null = null;
  for (const raw of chart.split(/\r?\n/)) {
    const line = raw.trim();
    const sub = line.match(/^subgraph\s+([A-Za-z][\w]*)(?:\s*\[.*\])?/i);
    if (sub) {
      current = detectLayer(line) || "services";
      continue;
    }
    if (/^end$/i.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const node = line.match(/^([A-Za-z][\w]*)\s*(?:\[|\(\(|\(\[|\(|\{\{|\{|>)/);
    if (node) map.set(node[1], current);
  }
  return map;
}

function nodeIdFromDom(domId: string): string {
  const parts = domId.split("-");
  if (parts.length >= 2) return parts[1] || domId;
  return domId;
}

let labelMeasureCtx: CanvasRenderingContext2D | null = null;

function measureLabelWidth(text: string, fontWeight = "650"): number {
  if (!labelMeasureCtx) {
    const canvas = document.createElement("canvas");
    labelMeasureCtx = canvas.getContext("2d");
  }
  if (!labelMeasureCtx) return text.length * 10;
  labelMeasureCtx.font = `${fontWeight} 15px "Plus Jakarta Sans", system-ui, sans-serif`;
  return Math.ceil(labelMeasureCtx.measureText(text).width);
}

/** Grow foreignObject + shape so labels like "API Gateway" / "Redis" are not clipped. */
function fitLabelBoxes(svg: SVGSVGElement) {
  svg.querySelectorAll("g.node, g.cluster-label, g.label").forEach((g) => {
    g.querySelectorAll("[clip-path]").forEach((el) => {
      el.removeAttribute("clip-path");
    });
    (g as SVGElement).style.clipPath = "none";
  });

  const unclipHtml = (root: ParentNode) => {
    root.querySelectorAll("div, span, p, a").forEach((node) => {
      const el = node as HTMLElement;
      el.style.overflow = "visible";
      el.style.maxWidth = "none";
      el.style.width = "max-content";
      el.style.whiteSpace = "nowrap";
      el.style.textOverflow = "clip";
      el.style.display = "inline-block";
    });
  };

  const growFo = (
    fo: SVGForeignObjectElement,
    padX: number,
    padY: number,
    weight: string,
  ) => {
    unclipHtml(fo);
    fo.style.overflow = "visible";
    const host =
      (fo.querySelector(".nodeLabel") as HTMLElement | null) ||
      (fo.querySelector("span") as HTMLElement | null) ||
      (fo.querySelector("div") as HTMLElement | null);
    if (!host) return { dw: 0, dh: 0 };

    const text = (host.textContent || "").replace(/\s+/g, " ").trim();
    const curW = Number(fo.getAttribute("width") || 0);
    const curH = Number(fo.getAttribute("height") || 0);
    const textW = measureLabelWidth(text, weight);
    const needW = Math.max(textW + padX, Math.ceil(host.scrollWidth + padX));
    const needH = Math.max(28, curH, Math.ceil(host.scrollHeight + padY));
    const newW = Math.max(curW, needW);
    const newH = Math.max(curH, needH);
    const dw = newW - curW;
    const dh = newH - curH;

    const x = Number(fo.getAttribute("x") || 0);
    const y = Number(fo.getAttribute("y") || 0);
    fo.setAttribute("width", String(newW));
    fo.setAttribute("height", String(newH));
    if (dw > 0) fo.setAttribute("x", String(x - dw / 2));
    if (dh > 0) fo.setAttribute("y", String(y - dh / 2));
    return { dw, dh };
  };

  const growRect = (rect: SVGRectElement, dw: number, dh: number) => {
    if (dw <= 0 && dh <= 0) return;
    const x = rect.x.baseVal.value;
    const y = rect.y.baseVal.value;
    const w = rect.width.baseVal.value;
    const h = rect.height.baseVal.value;
    rect.setAttribute("x", String(x - dw / 2));
    rect.setAttribute("y", String(y - dh / 2));
    rect.setAttribute("width", String(w + dw));
    rect.setAttribute("height", String(h + dh));
  };

  svg.querySelectorAll("g.node").forEach((node) => {
    const g = node as SVGGElement;
    const fo = g.querySelector("foreignObject") as SVGForeignObjectElement | null;
    if (!fo) return;
    const isCylinder = Boolean(g.querySelector(":scope > path"));
    // Cylinders clip descenders — give the label cell extra height and nudge up.
    const { dw, dh } = growFo(fo, 40, isCylinder ? 28 : 18, "650");
    if (isCylinder) {
      const y = Number(fo.getAttribute("y") || 0);
      fo.setAttribute("y", String(y - 4));
    }

    g.querySelectorAll("rect").forEach((rectEl) => {
      const rect = rectEl as SVGRectElement;
      const h = rect.height.baseVal.value;
      const w = rect.width.baseVal.value;
      // Mermaid draws a thin "label chip" rect over the text — it looks like a cut cell.
      if (h < 12 || (h < 20 && w < 80)) {
        rect.setAttribute("opacity", "0");
        rect.style.display = "none";
        return;
      }
      growRect(rect, dw, dh);
    });

    // Cylinders use path outlines — scale horizontally around center when text is wider.
    if (dw > 0) {
      g.querySelectorAll(":scope > path").forEach((pathEl) => {
        const path = pathEl as SVGPathElement;
        try {
          const bbox = path.getBBox();
          if (!bbox.width) return;
          const scaleX = (bbox.width + dw) / bbox.width;
          const cx = bbox.x + bbox.width / 2;
          const prev = path.getAttribute("transform") || "";
          path.setAttribute(
            "transform",
            `${prev} translate(${cx} 0) scale(${scaleX} 1) translate(${-cx} 0)`.trim(),
          );
        } catch {
          /* ignore detached geometry */
        }
      });
    }
  });

  svg.querySelectorAll("g.cluster .cluster-label").forEach((label) => {
    const fo = label.querySelector(
      "foreignObject",
    ) as SVGForeignObjectElement | null;
    if (!fo) return;
    const { dw, dh } = growFo(fo, 36, 12, "750");
    label.querySelectorAll("rect").forEach((rect) => {
      growRect(rect as SVGRectElement, dw, dh);
    });
  });
}

function enhanceRenderedSvg(root: HTMLElement, chartSource: string) {
  const svg = root.querySelector("svg");
  if (!svg) return;

  svg.classList.add("arch-diagram-svg");
  const nodeLayers = buildNodeLayerMap(chartSource);

  svg.querySelectorAll(
    "path.flowchart-link, .edge-thickness-normal, path.path",
  ).forEach((el) => {
    const path = el as SVGPathElement;
    path.style.strokeWidth = "2.35px";
    path.setAttribute("stroke-width", "2.35");
  });

  svg.querySelectorAll("marker").forEach((marker) => {
    const m = marker as SVGMarkerElement;
    const w = Number(m.getAttribute("markerWidth") || "10");
    const h = Number(m.getAttribute("markerHeight") || "10");
    m.setAttribute("markerWidth", String(Math.max(w, 14)));
    m.setAttribute("markerHeight", String(Math.max(h, 14)));
  });

  svg.querySelectorAll("g.cluster").forEach((cluster) => {
    const g = cluster as SVGGElement;
    const id = g.id || "";
    const title =
      g.querySelector(".cluster-label")?.textContent?.trim() || "";
    const layer =
      detectLayer(`${nodeIdFromDom(id)} ${title} ${id}`) || "services";
    g.dataset.archLayer = layer;
  });

  svg.querySelectorAll("g.node").forEach((node) => {
    const g = node as SVGGElement;
    const domId = g.id || "";
    const logicalId = nodeIdFromDom(domId);
    const label = g.textContent?.trim() || "";
    let layer =
      nodeLayers.get(logicalId) ||
      detectLayer(`${logicalId} ${label} ${domId}`);

    if (!layer) {
      if (/kafka|queue|topic|bus|stream|socket/i.test(`${logicalId} ${label}`)) {
        layer = "messaging";
      } else if (
        /db|redis|cache|postgres|mongo|store|s3/i.test(`${logicalId} ${label}`)
      ) {
        layer = "data";
      } else if (/gateway|auth|api/i.test(`${logicalId} ${label}`)) {
        layer = "api";
      } else if (/app|web|mobile|client|driver|rider/i.test(`${logicalId} ${label}`)) {
        layer = "clients";
      } else {
        layer = "services";
      }
    }

    g.dataset.archLayer = layer;
  });

  // Expand label cells/shapes before size measurement so scale fits full text.
  fitLabelBoxes(svg);
}

export function MermaidBlock({ chart }: Props) {
  const reactId = useId().replace(/[^a-zA-Z]/g, "") || "x";
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const [inlineScale, setInlineScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const sanitizedRef = useRef("");
  const [expanded, setExpanded] = useState(false);
  /** Hide until scaled — prevents unscaled SVG flash / flicker. */
  const [painted, setPainted] = useState(false);
  /** Top→bottom waterfall reveal after first paint. */
  const [waterfall, setWaterfall] = useState(false);
  const [rendering, setRendering] = useState(true);

  const inlineHostRef = useRef<HTMLDivElement>(null);
  const inlineCanvasRef = useRef<HTMLDivElement>(null);
  const expandViewportRef = useRef<HTMLDivElement>(null);
  const expandCanvasRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef({ w: 0, h: 0 });
  const fitScaleRef = useRef(1);
  const zoomRef = useRef(1);
  const inlineScaleRef = useRef(1);
  const hostWidthRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  useEffect(() => {
    fitScaleRef.current = fitScale;
  }, [fitScale]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    inlineScaleRef.current = inlineScale;
  }, [inlineScale]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      activeTheme = null;
      setThemeTick((n) => n + 1);
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const tryRender = async (source: string): Promise<string> => {
      const mermaid = await getMermaid();
      if (typeof mermaid.parse === "function") {
        await mermaid.parse(source);
      }
      const id = safeRenderId(reactId);
      const { svg: rendered } = await mermaid.render(id, source);
      return rendered;
    };

    const render = async () => {
      // Keep the previous diagram on screen while the next one builds —
      // clearing SVG here is what caused the violent flicker.
      setError(null);
      setRendering(true);
      setPainted(false);
      setWaterfall(false);

      const validation = validateMermaidStructure(chart);
      const cleaned = validation.chart || sanitizeMermaidChart(chart);
      sanitizedRef.current = cleaned;
      if (!cleaned) {
        if (!cancelled) {
          setError("Empty diagram.");
          setRendering(false);
        }
        return;
      }

      try {
        const rendered = await tryRender(cleaned);
        if (cancelled) return;
        setSvg(rendered);
        setError(null);
      } catch {
        try {
          const repaired = aggressiveMermaidRepair(chart);
          sanitizedRef.current = repaired;
          const rendered = await tryRender(repaired);
          if (cancelled) return;
          setSvg(rendered);
          setError(null);
        } catch {
          if (!cancelled) {
            setSvg(null);
            setError("Diagram could not be drawn. Try asking again.");
            setRendering(false);
          }
        }
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [chart, reactId, themeTick]);

  const measureAndEnhance = useCallback((canvas: HTMLElement | null) => {
    const svgEl = canvas?.querySelector("svg");
    if (!svgEl || !canvas) return null;
    const size = measureSvgSize(svgEl);
    naturalRef.current = size;
    setNatural(size);
    enhanceRenderedSvg(canvas, sanitizedRef.current);
    return size;
  }, []);

  /** Inline: measure off-screen, then waterfall-reveal once. */
  useEffect(() => {
    if (!svg || expanded) return;
    let cancelled = false;
    let revealTimer = 0;

    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      const size = measureAndEnhance(inlineCanvasRef.current);
      if (!size) return;
      const hostW = inlineHostRef.current?.clientWidth ?? 0;
      const nextScale = computeInlineScale(hostW, size);
      inlineScaleRef.current = nextScale;
      setInlineScale(nextScale);
      hostWidthRef.current = hostW;
      setRendering(false);
      setPainted(true);
      // Second frame so layout/scale apply before the wipe starts.
      revealTimer = window.setTimeout(() => {
        if (!cancelled) setWaterfall(true);
      }, 32);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(revealTimer);
    };
  }, [svg, expanded, measureAndEnhance]);

  /** Resize only when the chat column width changes (ignore height thrash). */
  useEffect(() => {
    if (expanded || !natural.w) return;
    const host = inlineHostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;

    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const w = host.clientWidth;
        if (Math.abs(w - hostWidthRef.current) < 2) return;
        hostWidthRef.current = w;
        const next = computeInlineScale(w, naturalRef.current);
        if (Math.abs(next - inlineScaleRef.current) < 0.02) return;
        inlineScaleRef.current = next;
        setInlineScale(next);
      }, 80);
    });

    ro.observe(host);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [expanded, natural.w]);

  const centerExpandedDiagram = useCallback(() => {
    const vp = expandViewportRef.current;
    if (!vp) return;
    const canvas = vp.querySelector(
      ".arch-viewer__canvas",
    ) as HTMLElement | null;
    if (!canvas) return;
    vp.scrollLeft = Math.max(0, (canvas.scrollWidth - vp.clientWidth) / 2);
    vp.scrollTop = Math.max(0, (canvas.scrollHeight - vp.clientHeight) / 2);
  }, []);

  /** Expand: readable initial zoom (not crushed fit), then pan/zoom. */
  useEffect(() => {
    if (!svg || !expanded) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      const size = measureAndEnhance(expandCanvasRef.current);
      if (!size) return;
      const viewport = expandViewportRef.current;
      const nextFit = computeFitScale(viewport, size);
      const initialZoom = computeExpandInitialZoom(nextFit);
      fitScaleRef.current = nextFit;
      setFitScale(nextFit);
      zoomRef.current = initialZoom;
      setZoom(initialZoom);
      requestAnimationFrame(() => {
        if (!cancelled) centerExpandedDiagram();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [svg, expanded, measureAndEnhance, centerExpandedDiagram]);

  /** Keep expand fit scale fresh when the overlay is resized. */
  useEffect(() => {
    if (!expanded || !natural.w) return;
    const vp = expandViewportRef.current;
    if (!vp || typeof ResizeObserver === "undefined") return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const nextFit = computeFitScale(vp, naturalRef.current);
        if (Math.abs(nextFit - fitScaleRef.current) < 0.01) return;
        const prevEff = fitScaleRef.current * zoomRef.current;
        fitScaleRef.current = nextFit;
        setFitScale(nextFit);
        // Preserve absolute scale when the viewport changes.
        const nextZoom = clampZoom(prevEff / nextFit);
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
      }, 80);
    });
    ro.observe(vp);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [expanded, natural.w]);

  const zoomAroundCenter = useCallback((nextZoom: number) => {
    const vp = expandViewportRef.current;
    const prevZoom = zoomRef.current;
    const next = clampZoom(nextZoom);
    const prevRender = fitScaleRef.current * prevZoom;
    const nextRender = fitScaleRef.current * next;
    if (!vp || prevRender <= 0) {
      setZoom(next);
      return;
    }
    const cx = vp.scrollLeft + vp.clientWidth / 2;
    const cy = vp.scrollTop + vp.clientHeight / 2;
    const ratio = nextRender / prevRender;
    setZoom(next);
    requestAnimationFrame(() => {
      vp.scrollLeft = cx * ratio - vp.clientWidth / 2;
      vp.scrollTop = cy * ratio - vp.clientHeight / 2;
    });
  }, []);

  const fitToScreen = useCallback(() => {
    zoomRef.current = 1;
    setZoom(1);
    requestAnimationFrame(() => centerExpandedDiagram());
  }, [centerExpandedDiagram]);

  const resetReadableZoom = useCallback(() => {
    const next = computeExpandInitialZoom(fitScaleRef.current);
    zoomAroundCenter(next);
    requestAnimationFrame(() => centerExpandedDiagram());
  }, [zoomAroundCenter, centerExpandedDiagram]);

  const zoomToActualSize = useCallback(() => {
    zoomAroundCenter(computeActualSizeZoom(fitScaleRef.current));
  }, [zoomAroundCenter]);

  const onWheelZoom = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      // Ctrl/Cmd/Alt+wheel zooms; plain wheel scrolls the viewport.
      if (!(event.ctrlKey || event.metaKey || event.altKey)) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      zoomAroundCenter(zoomRef.current + delta);
    },
    [zoomAroundCenter],
  );

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAroundCenter(zoomRef.current + ZOOM_STEP);
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomAroundCenter(zoomRef.current - ZOOM_STEP);
      }
      if (event.key === "0" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        fitToScreen();
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded, zoomAroundCenter, fitToScreen]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const vp = event.currentTarget;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: vp.scrollLeft,
      scrollTop: vp.scrollTop,
    };
    vp.setPointerCapture(event.pointerId);
    vp.classList.add("arch-viewer__viewport--panning");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const vp = event.currentTarget;
    vp.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    vp.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.classList.remove("arch-viewer__viewport--panning");
    }
  };

  if (error && !svg) {
    return (
      <div className="arch-viewer arch-viewer--error">
        <p className="arch-viewer__error">{error}</p>
      </div>
    );
  }

  const expandRenderScale = fitScale * zoom;
  const expandBoxW = natural.w ? natural.w * expandRenderScale : undefined;
  const expandBoxH = natural.h ? natural.h * expandRenderScale : undefined;
  const inlineBoxW = natural.w ? natural.w * inlineScale : undefined;
  const inlineBoxH = natural.h ? natural.h * inlineScale : undefined;
  const showPending = !svg || rendering || !painted;

  const modal =
    expanded && svg && typeof document !== "undefined"
      ? createPortal(
          <div className="arch-viewer-overlay" role="dialog" aria-modal="true">
            <div className="arch-viewer arch-viewer--modal">
              <div
                className="arch-viewer__toolbar"
                role="toolbar"
                aria-label="Diagram controls"
              >
                <button
                  type="button"
                  onClick={() => zoomAroundCenter(zoomRef.current + ZOOM_STEP)}
                  title="Zoom in"
                  aria-label="Zoom in"
                  disabled={zoom >= MAX_ZOOM}
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => zoomAroundCenter(zoomRef.current - ZOOM_STEP)}
                  title="Zoom out"
                  aria-label="Zoom out"
                  disabled={zoom <= MIN_ZOOM}
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={fitToScreen}
                  title="Fit diagram to screen"
                  aria-label="Fit to screen"
                >
                  Fit
                </button>
                <button
                  type="button"
                  onClick={resetReadableZoom}
                  title="Reset to readable zoom"
                  aria-label="Reset zoom"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={zoomToActualSize}
                  title="Show diagram at 100% size"
                  aria-label="Actual size"
                >
                  100%
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  title="Close expanded view"
                  aria-label="Close expanded view"
                >
                  Close
                </button>
                <span className="arch-viewer__zoom" aria-live="polite">
                  {effectiveScalePercent(fitScale, zoom)}%
                </span>
              </div>

              <div
                ref={expandViewportRef}
                className="arch-viewer__viewport arch-viewer__viewport--interactive"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onWheel={onWheelZoom}
              >
                <div
                  className="arch-viewer__canvas"
                  style={
                    expandBoxW && expandBoxH
                      ? { width: expandBoxW, height: expandBoxH }
                      : undefined
                  }
                >
                  <div
                    ref={expandCanvasRef}
                    className="arch-viewer__inner"
                    style={{
                      width: natural.w || "auto",
                      height: natural.h || "auto",
                      transform: `scale(${expandRenderScale})`,
                    }}
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                </div>
              </div>
              <p className="arch-viewer__hint">
                Drag to pan · Ctrl+scroll to zoom · Fit / Reset / 100% · Esc to
                close
              </p>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="arch-viewer arch-viewer--inline" ref={inlineHostRef}>
        <div className="arch-viewer__toolbar" role="toolbar" aria-label="Diagram">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title="Expand diagram"
            aria-label="Expand diagram"
            disabled={!svg || showPending}
          >
            Expand
          </button>
        </div>
        <div className="arch-viewer__preview">
          {showPending && (
            <div className="arch-viewer__pending-inner" aria-busy="true">
              <span className="arch-viewer__pending-bar" />
              <p>Drawing diagram…</p>
            </div>
          )}
          {expanded ? (
            <p className="arch-viewer__placeholder">
              Diagram open in expanded view
            </p>
          ) : (
            svg && (
              <div
                className={[
                  "arch-viewer__canvas",
                  "arch-viewer__canvas--inline",
                  "arch-viewer__waterfall",
                  waterfall ? "arch-viewer__waterfall--on" : "",
                  painted ? "" : "arch-viewer__canvas--measuring",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={
                  inlineBoxW && inlineBoxH
                    ? { width: inlineBoxW, height: inlineBoxH }
                    : undefined
                }
              >
                <div
                  ref={inlineCanvasRef}
                  className="arch-viewer__inner"
                  style={{
                    width: natural.w || "auto",
                    height: natural.h || "auto",
                    transform: `scale(${inlineScale})`,
                  }}
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              </div>
            )
          )}
        </div>
      </div>
      {modal}
    </>
  );
}
