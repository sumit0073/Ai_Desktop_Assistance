import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Ordinary suite — excludes opt-in live proxy tests (*.live.test.ts).
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.live.test.ts", "node_modules/**"],
  },
});
