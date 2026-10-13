import { defineConfig } from "vitest/config";

/** Opt-in live proxy suite — does not run via `npm test`. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
