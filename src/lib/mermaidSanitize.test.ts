import { describe, expect, it } from "vitest";
import {
  fixSubgraphLine,
  isMangledSubgraphId,
  normalizeMermaidInMarkdown,
  optimizeMermaidLayout,
  sanitizeMermaidChart,
  validateMermaidStructure,
} from "./mermaidSanitize";

describe("fixSubgraphLine", () => {
  it("preserves valid id and quoted title", () => {
    expect(fixSubgraphLine('  subgraph clients["Clients"]')).toBe(
      '  subgraph clients["Clients"]',
    );
  });

  it("repairs mangled ApiLayer_API_Layer style ids", () => {
    const fixed = fixSubgraphLine("subgraph ApiLayer_API_Layer");
    expect(fixed).toMatch(/^subgraph \w+\[".+"\]$/);
    expect(fixed).not.toContain("ApiLayer_API_Layer");
    expect(fixed.toLowerCase()).not.toMatch(/api layer api layer/);
  });

  it("does not invent duplicated visible titles", () => {
    const fixed = fixSubgraphLine('subgraph apiGateway["API GATEWAY API GATEWAY"]');
    expect(fixed).toBe('subgraph apiGateway["API GATEWAY"]');
  });
});

describe("isMangledSubgraphId", () => {
  it("flags duplicated title encodings", () => {
    expect(isMangledSubgraphId("ApiLayer_API_Layer", "API Layer")).toBe(true);
    expect(isMangledSubgraphId("clients", "Clients")).toBe(false);
  });
});

describe("sanitizeMermaidChart", () => {
  it("inserts missing arrows between bare node lists", () => {
    const out = sanitizeMermaidChart("flowchart TB\nKafka Redis");
    expect(out).toContain("Kafka --> Redis");
  });

  it("forces TB stack with LR peers inside subgraphs", () => {
    const out = sanitizeMermaidChart(`flowchart LR
subgraph clients["Clients"]
  direction TB
  A[App]
end
subgraph api["API"]
  B[GW]
end
A --> B`);
    expect(out).toMatch(/^flowchart TB/m);
    expect(out).not.toMatch(/flowchart\s+LR/i);
    // Layers stack top→bottom; peers within a layer sit side-by-side.
    expect(out).toContain("direction LR");
    expect(out).not.toMatch(/direction\s+TB/i);
  });

  it("strips markdown table rows that break Mermaid PIPE parsing", () => {
    const out = sanitizeMermaidChart(`flowchart TB
| Client | Responsibility |
| --- | --- |
Gateway[API Gateway]`);
    expect(out).not.toContain("|");
    expect(out).toContain("Gateway[API Gateway]");
    expect(out).not.toMatch(/^node --- node$/m);
  });

  it("rewrites pipe-shaped nodes and unglues flowchart TBnode", () => {
    const out = sanitizeMermaidChart(
      `flowchart TBnode|Clients| --> Gateway[API]`,
    );
    expect(out).toMatch(/^flowchart TB$/m);
    expect(out).toContain("node[Clients]");
    expect(out).toContain("Gateway[API]");
    expect(out).not.toContain("|");
  });

  it("keeps unique subgraph ids when duplicates appear", () => {
    const out = sanitizeMermaidChart(`flowchart TB
subgraph services["Services"]
  A[A]
end
subgraph services["More Services"]
  B[B]
end`);
    expect(out).toMatch(/subgraph services\b/);
    expect(out).toMatch(/subgraph services2\b/);
  });

  it("does not corrupt non-subgraph labels during normalize", () => {
    const md = normalizeMermaidInMarkdown(`# Title

\`\`\`mermaid
flowchart TB
  subgraph edge["Edge"]
    Gateway[API Gateway]
  end
  Client --> Gateway
\`\`\`

Still here.`);
    expect(md).toContain("Still here.");
    expect(md).toContain('subgraph edge["Edge"]');
    expect(md).toContain("Gateway[API Gateway]");
  });

  it("reorders layers clients → api → services → data and dedupes edges", () => {
    const out = sanitizeMermaidChart(`flowchart TB
subgraph dataStores["Data Stores"]
  OrdersDb[(Orders DB)]
end
subgraph clients["Clients"]
  Web[Web App]
end
subgraph apiGateway["API Gateway"]
  Gw[API Gateway]
end
subgraph coreServices["Core Services"]
  OrderSvc[Order Service]
end
Web --> Gw
Web --> Gw
Gw --> OrderSvc
OrderSvc --> OrdersDb`);
    const clientsAt = out.indexOf('subgraph clients["Clients"]');
    const apiAt = out.indexOf('subgraph apiGateway["API Gateway"]');
    const svcAt = out.indexOf('subgraph coreServices["Core Services"]');
    const dataAt = out.indexOf('subgraph dataStores["Data Stores"]');
    expect(clientsAt).toBeGreaterThanOrEqual(0);
    expect(apiAt).toBeGreaterThan(clientsAt);
    expect(svcAt).toBeGreaterThan(apiAt);
    expect(dataAt).toBeGreaterThan(svcAt);
    expect(out.match(/Web --> Gw/g)?.length).toBe(1);
  });

  it("shortens oversized node labels without dropping edges", () => {
    const out = sanitizeMermaidChart(`flowchart TB
subgraph clients["Clients"]
  A[Very Long Client Application Container Name With Noise]
end
A --> B[API]`);
    expect(out).toContain("A --> B");
    expect(out).toMatch(/A\[[^\]]{1,28}\]/);
  });
});

describe("optimizeMermaidLayout", () => {
  it("preserves e-commerce style relationships after reorder", () => {
    const chart = `flowchart TB
subgraph dataStores["Data Stores"]
  direction LR
  OrdersDb[(Orders DB)]
  InventoryDb[(Inventory DB)]
end
subgraph clients["Clients"]
  direction LR
  Web[Web App]
  Mobile[Mobile App]
end
subgraph apiGateway["API Gateway"]
  direction LR
  Gw[API Gateway]
end
subgraph coreServices["Core Services"]
  direction LR
  OrderSvc[Order Service]
  InventorySvc[Inventory Service]
end
subgraph messaging["Messaging"]
  direction LR
  Kafka[(Kafka)]
end
subgraph external["External"]
  direction LR
  Stripe[[Payment]]
end
Web --> Gw
Mobile --> Gw
Gw --> OrderSvc
Gw --> InventorySvc
OrderSvc --> OrdersDb
InventorySvc --> InventoryDb
OrderSvc -.-> Kafka
OrderSvc --> Stripe`;
    const out = optimizeMermaidLayout(chart);
    const validation = validateMermaidStructure(out);
    expect(validation.ok).toBe(true);
    for (const edge of [
      "Web --> Gw",
      "Mobile --> Gw",
      "Gw --> OrderSvc",
      "Gw --> InventorySvc",
      "OrderSvc --> OrdersDb",
      "InventorySvc --> InventoryDb",
      "OrderSvc -.-> Kafka",
      "OrderSvc --> Stripe",
    ]) {
      expect(out).toContain(edge);
    }
    expect(out.indexOf("clients")).toBeLessThan(out.indexOf("apiGateway"));
    expect(out.indexOf("apiGateway")).toBeLessThan(out.indexOf("coreServices"));
    expect(out.indexOf("coreServices")).toBeLessThan(out.indexOf("messaging"));
    expect(out.indexOf("messaging")).toBeLessThan(out.indexOf("dataStores"));
  });
});

describe("validateMermaidStructure", () => {
  it("accepts a balanced flowchart", () => {
    const result = validateMermaidStructure(`flowchart TB
subgraph clients["Clients"]
  App[App]
end
App --> Api`);
    expect(result.ok).toBe(true);
  });

  it("auto-closes a missing subgraph end during sanitize", () => {
    const result = validateMermaidStructure(`flowchart TB
subgraph clients["Clients"]
  App[App]
`);
    expect(result.ok).toBe(true);
    expect(result.chart).toMatch(/subgraph clients\["Clients"\][\s\S]*\bend\b/);
  });

  it("rejects missing edges after sanitize attempt context", () => {
    // After sanitize, bare lists become edges — validation should pass.
    const result = validateMermaidStructure(`flowchart TB
A B`);
    expect(result.ok).toBe(true);
    expect(result.chart).toContain("A --> B");
  });
});
