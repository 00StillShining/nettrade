import "./index.css";
import "./theme/tokens.css";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import Frame from "./shell/Frame";
import BakedCrt from "./shell/BakedCrt";
import Animus, { AnimusFlash } from "./animus/Animus";
import Dashboard from "./screens/dashboard/Dashboard";
import Positions from "./screens/positions/Positions";
import Watchlist from "./screens/watchlist/Watchlist";
import Performance from "./screens/performance/Performance";
import Compare from "./screens/compare/Compare";
import Journal from "./screens/journal/Journal";
import Settings from "./screens/settings/Settings";

/**
 * App — Actuality's shell after the Animus pivot. Home ("/") is now a single,
 * faithful raw-WebGL2 port of the AC-II "Animus 2.0" menu (src/animus/Animus.tsx),
 * living in its own pale-void world — NO dark Frame, NO baked CRT on that route.
 *
 * The seven data screens render inside the dark cinematic <Frame> + <BakedCrt/>,
 * exactly as they did pre-3a. A dive from a menu leaf runs the Animus's white
 * flash (hoisted to <AnimusFlash/> so it survives the route swap) and navigates
 * to the screen under the cover.
 *
 * Chrome (src/shell/Chrome.tsx) still gives every data screen its top page-nav
 * + Esc/wordmark return to "/". The Animus's own Esc only fires while it's
 * mounted (route "/"), and Chrome only mounts on data screens — so the two Esc
 * handlers never coexist.
 */

/** Wrap a data screen in the dark Frame (screens render their own <Chrome/>). */
function Screen({ children }: { children: ReactNode }) {
  return <Frame>{children}</Frame>;
}

function Shell() {
  // BakedCrt renders on every data screen but NOT on the Animus route — the
  // reference's overexposed white void is its own world and must not sit under
  // a dark CRT curve.
  const onMenu = useLocation().pathname === "/";

  return (
    <>
      <Routes>
        {/* "/" — the Animus menu. Its own fixed pale-void wrapper covers the
            viewport; no Frame, no CRT. */}
        <Route path="/" element={<Animus />} />

        {/* The seven data screens — dark Frame + Chrome (self-wrapped). */}
        <Route path="/dashboard" element={<Screen><Dashboard /></Screen>} />
        <Route path="/positions" element={<Screen><Positions /></Screen>} />
        <Route path="/watchlist" element={<Screen><Watchlist /></Screen>} />
        <Route path="/performance" element={<Screen><Performance /></Screen>} />
        <Route path="/compare" element={<Screen><Compare /></Screen>} />
        <Route path="/journal" element={<Screen><Journal /></Screen>} />
        <Route path="/settings" element={<Screen><Settings /></Screen>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* White dive flash — hoisted here so it OUTLIVES the Animus during the
          route swap (Animus unmounts at the flash's cover point). ./flash.ts
          drives its opacity; the element is always present so the cover works
          whether we're on "/" or over a mounted screen. */}
      <AnimusFlash />

      {/* Baked CRT on top of data screens only (route !== "/"). Inert, static. */}
      {!onMenu && <BakedCrt />}
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
