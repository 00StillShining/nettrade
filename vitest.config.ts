import { defineConfig } from "vitest/config";

// Minimal, separate config for the pure-node test suites (no jsdom —
// src/engine/** has no DOM dependency). The Animus menu is now a single
// faithful raw-WebGL2 port (src/animus/) verified in the real .app, not here,
// so it carries no unit tests. Kept apart from vite.config.ts so the Tauri
// dev/build config's VITE_MOCK/VITE_SPIKE defines and dev-server settings
// never leak into the test run.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/engine/**/*.test.ts",
      // Terminal-77 port: the pure engine layer (src/terminal/engine/**) is
      // DOM-free by law — same node environment, same suite.
      "src/terminal/**/*.test.ts",
    ],
  },
});
