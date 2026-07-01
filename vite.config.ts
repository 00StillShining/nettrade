import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  define: {
    "import.meta.env.VITE_SPIKE": JSON.stringify(process.env.SPIKE ? "1" : ""),
    // VITE_MOCK => Dashboard shows placeholder data (no Keychain/API) for design
    // iteration without password prompts. Omit for the real live-data build.
    "import.meta.env.VITE_MOCK": JSON.stringify(process.env.MOCK ? "1" : ""),
  },

  // Bundle ALL CSS into one file with a STATIC <link> in index.html. Vite's
  // default per-chunk CSS is injected at runtime when a dynamic import resolves;
  // in the packaged WKWebView asset protocol that injection did not apply the
  // App chunk's stylesheet (Chromium + the spike loaded theirs, hiding the bug),
  // so the app rendered unstyled/white. One static stylesheet is reliable.
  build: { cssCodeSplit: false },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
