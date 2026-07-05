import "./index.css";
import "./theme/tokens.css";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Animus, { AnimusFlash } from "./animus/Animus";
import AnimusSettings from "./screens/settings/AnimusSettings";
import Terminal from "./terminal/Terminal";

/**
 * App — Actuality's shell after the TERMINAL-77 pivot. Home ("/") is still the
 * verbatim raw-WebGL2 "Animus 2.0" menu (src/animus/Animus.tsx) in its pale
 * void — untouched. The data world is now the MDN terminal (src/terminal/):
 * ONE persistent shell mounted at "/:screenId" that hosts all ten screens
 * (dashboard/positions/watchlist/performance/orders/scanner/alerts/news/
 * compare/journal) and swaps between them under its own CRT power-off —
 * navigating between terminal screens changes only the param, so <Terminal/>
 * NEVER remounts and the desktop chrome/engine clock persist.
 *
 * Settings now lives in the ANIMUS WORLD too: "/settings" renders
 * <AnimusSettings/> (src/screens/settings/AnimusSettings.tsx) directly — its
 * own fixed pale-void root, NO Frame and NO BakedCrt, exactly like the "/"
 * Animus route. The pale void is not a dark CRT screen, so the baked tube is
 * gone here; BakedCrt is no longer rendered by ANY route (the terminal carries
 * its own overlay stack). Its file remains in place, just unused.
 *
 * The old Frame+Chrome data screens (src/screens/*) are UNROUTED here but
 * their files remain (cleanup is a later stage). The legacy cream Settings.tsx
 * is DELETED (2026-07-05): it offered sub-minute sync keycaps the persisted
 * refresh pref deliberately refuses (broker 1 req/s budget) — a dead file that
 * contradicted the live Settings was a trap, not an archive. The static
 * "/settings" route is matched by the router ahead of the ":screenId" param
 * automatically.
 */

function Shell() {
  return (
    <>
      <Routes>
        {/* "/" — the Animus menu. Its own fixed pale-void wrapper covers the
            viewport; no Frame, no CRT. */}
        <Route path="/" element={<Animus />} />

        {/* Settings — the Animus pale-void configuration screen. Its own fixed
            pale-void root; no Frame, no CRT (same world as "/"). */}
        <Route path="/settings" element={<AnimusSettings />} />

        {/* The terminal — every other top-level segment is a screen id;
            Terminal validates it and bounces unknowns to /dashboard. */}
        <Route path="/:screenId" element={<Terminal />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* White dive flash — hoisted here so it OUTLIVES the Animus during the
          route swap (Animus unmounts at the flash's cover point). ./flash.ts
          drives its opacity; the element is always present so the cover works
          whether we're on "/", over Settings, or over a mounted screen. */}
      <AnimusFlash />
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
