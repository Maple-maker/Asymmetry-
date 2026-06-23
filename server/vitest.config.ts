import { defineConfig } from "vitest/config";

// Minimal vitest config for the M1 rubric engine. Node environment (pure TS, no DOM).
// vitest transpiles per-file via esbuild, so it runs `lib/rubric/` without touching the
// existing tsconfig (which scopes `rootDir`/`include` to `src/`).
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "src/**/*.test.ts"],
  },
});
