import { describe, expect, it } from "vitest";
import { shouldAllowDirectGroqChat } from "./chatProxyValidation";
import { shouldAllowDirectGroqStt } from "./sttProxyValidation";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("../..", import.meta.url)));

function readWorkflow(name: string): string {
  return readFileSync(join(root, ".github/workflows", name), "utf8");
}

describe("release safety contracts", () => {
  it("blocks direct Groq chat and STT in production even with allow flags", () => {
    expect(
      shouldAllowDirectGroqChat({
        prod: true,
        proxyUrl: undefined,
        allowDirectDevFlag: "true",
      }),
    ).toEqual({ allow: false, reason: "production_requires_proxy" });

    expect(
      shouldAllowDirectGroqStt({
        prod: true,
        proxyUrl: undefined,
        allowDirectDevFlag: "true",
      }),
    ).toEqual({ allow: false, reason: "production_requires_proxy" });
  });

  it("prefers proxy over direct when proxy URL is set", () => {
    expect(
      shouldAllowDirectGroqChat({
        prod: false,
        proxyUrl: "https://example.supabase.co/functions/v1/chat-proxy",
        allowDirectDevFlag: "true",
      }).allow,
    ).toBe(false);
    expect(
      shouldAllowDirectGroqStt({
        prod: false,
        proxyUrl: "https://example.supabase.co/functions/v1/stt-proxy",
        allowDirectDevFlag: "true",
      }).allow,
    ).toBe(false);
  });

  for (const file of ["build-windows.yml", "build-macos.yml"] as const) {
    it(`${file} requires both proxy URLs and scans before package`, () => {
      const yml = readWorkflow(file);
      expect(yml).toContain("VITE_STT_PROXY_URL");
      expect(yml).toContain("VITE_CHAT_PROXY_URL");
      expect(yml).toMatch(/Missing secret VITE_STT_PROXY_URL/);
      expect(yml).toMatch(/Missing secret VITE_CHAT_PROXY_URL/);
      expect(yml).toMatch(/GROQ_API_KEY\|ALLOW_DIRECT_GROQ/);
      expect(yml).toContain("npm run check:bundle-secrets");
      expect(yml).toContain("security-check.log");
      expect(yml).toContain("Quality gates");
      // Must not wire Groq server secret into Vite env construction.
      expect(yml).not.toMatch(/secrets\.GROQ_API_KEY/);
      expect(yml).not.toMatch(/VITE_GROQ_API_KEY:\s*\$\{\{\s*secrets/);
    });
  }
});
