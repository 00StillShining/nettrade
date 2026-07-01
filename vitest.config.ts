import { defineConfig } from "vitest/config";

// Minimal, separate config for the pure-node engine test suite (no jsdom —
// src/engine/** has no DOM dependency). Kept apart from vite.config.ts so
// the Tauri dev/build config's VITE_MOCK/VITE_SPIKE defines and dev-server
// settings never leak into the test run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/engine/**/*.test.ts"],
  },
});
