import { defineConfig } from "vitest/config";

// Minimal, separate config for the pure-node test suites (no jsdom —
// src/engine/** and the Animus's pure logic src/menu/{destinations,waferLayout}
// have no DOM dependency; the 3D/DOM Animus pieces are verified in the real
// .app, not here). Kept apart from vite.config.ts so the Tauri dev/build
// config's VITE_MOCK/VITE_SPIKE defines and dev-server settings never leak
// into the test run.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/engine/**/*.test.ts",
      "src/menu/**/*.test.ts",
    ],
  },
});
