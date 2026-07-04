import "./index.css";
import "./theme/tokens.css";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Frame from "./shell/Frame";
import BakedCrt from "./shell/BakedCrt";
import Animus, { AnimusFlash } from "./animus/Animus";
import Settings from "./screens/settings/Settings";
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
 * The old Frame+Chrome data screens (src/screens/*) are UNROUTED here but
 * their files remain in place (cleanup is a later stage). Only Settings keeps
 * the legacy Frame + BakedCrt treatment; the static "/settings" route is
 * matched by the router ahead of the ":screenId" param automatically.
 *
 * BakedCrt renders ONLY on /settings now: the terminal carries its OWN CRT
 * overlay stack (scanlines/vignette/bezel/roll inside the .t77 root), and the
 * Animus's overexposed white void was never allowed a dark tube. Stacking the
 * legacy baked curve over the terminal would double-expose the glass.
 */

function Shell() {
  const onSettings = useLocation().pathname === "/settings";

  return (
    <>
      <Routes>
        {/* "/" — the Animus menu. Its own fixed pale-void wrapper covers the
            viewport; no Frame, no CRT. */}
        <Route path="/" element={<Animus />} />

        {/* Settings — the one legacy data screen kept (Frame + Chrome inside). */}
        <Route path="/settings" element={<Frame><Settings /></Frame>} />

        {/* The terminal — every other top-level segment is a screen id;
            Terminal validates it and bounces unknowns to /dashboard. */}
        <Route path="/:screenId" element={<Terminal />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* White dive flash — hoisted here so it OUTLIVES the Animus during the
          route swap (Animus unmounts at the flash's cover point). ./flash.ts
          drives its opacity; the element is always present so the cover works
          whether we're on "/" or over a mounted screen. */}
      <AnimusFlash />

      {/* Baked CRT ONLY over the legacy Settings screen — the terminal brings
          its own tube, the Animus keeps its void. */}
      {onSettings && <BakedCrt />}
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
