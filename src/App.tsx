import "./index.css";
import "./theme/tokens.css";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import BakedCrt from "./shell/BakedCrt";
import { AnimusProvider, useAnimus } from "./menu/animusStore";
import AnimusCanvas from "./menu/AnimusCanvas";
import AnimusMenu from "./menu/AnimusMenu";
import MenuWipe from "./menu/MenuWipe";
import ScreenFrame from "./menu/ScreenFrame";
import Dashboard from "./screens/dashboard/Dashboard";
import Positions from "./screens/positions/Positions";
import Watchlist from "./screens/watchlist/Watchlist";
import Performance from "./screens/performance/Performance";
import Compare from "./screens/compare/Compare";
import Journal from "./screens/journal/Journal";
import Settings from "./screens/settings/Settings";

/**
 * App — Phase-3a shell. The Animus (AC-style WebGL menu) IS home: the app opens
 * into the 3D menu at "/", the user dives from a wafer-stack into a screen, and
 * a consistent control (Esc / the ◄ ANIMUS wordmark in Chrome) surfaces them
 * back. This replaced the interim flat nav (removed from Chrome).
 *
 * Anti-brick architecture (RUNTIME_AND_STACK §5, skill §7):
 *   #1  ONE persistent <AnimusCanvas>, mounted here ONCE, NEVER per route — it
 *       stays mounted whether the menu or a screen is showing.
 *   #2  It renders on demand only; a screen showing flips mode → "screen" and
 *       its useFrame early-returns (dead-still GPU behind the opaque screen).
 *   #5  During a dive the CRT is SUSPENDED (mode === "diving") so the wipe +
 *       dolly are the single full-screen effect.
 */
function Shell() {
  const { mode, wipeActive, wipeRunId } = useAnimus();

  return (
    <>
      {/* Persistent WebGL layer — behind everything (z 0), never unmounted. */}
      <AnimusCanvas />

      <Routes>
        {/* "/" is the Animus menu HUD (NOT a screen) — it renders NO opaque
            Frame, so the pale --animus-field void from the canvas shows. */}
        <Route path="/" element={<AnimusMenu />} />

        {/* The seven data screens render inside the opaque dark Frame, which
            covers the (frozen) canvas. ScreenFrame also asserts mode="screen". */}
        <Route path="/positions" element={<ScreenFrame><Positions /></ScreenFrame>} />
        <Route path="/watchlist" element={<ScreenFrame><Watchlist /></ScreenFrame>} />
        <Route path="/performance" element={<ScreenFrame><Performance /></ScreenFrame>} />
        <Route path="/compare" element={<ScreenFrame><Compare /></ScreenFrame>} />
        <Route path="/journal" element={<ScreenFrame><Journal /></ScreenFrame>} />
        <Route path="/settings" element={<ScreenFrame><Settings /></ScreenFrame>} />

        {/* Dashboard also has a route so returning to it (or a stale hash) works;
            it renders as a screen. The menu's DASHBOARD stack dives here. */}
        <Route path="/dashboard" element={<ScreenFrame><Dashboard /></ScreenFrame>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Dive wipe — hoisted OUT of AnimusMenu so it survives the navigation at
          the wipe's cover point (AnimusMenu unmounts there). It sits below the
          CRT slot and above the routed screen; provider owns its lifecycle. */}
      <MenuWipe active={wipeActive} runId={wipeRunId} />

      {/* Baked CRT on top — suspended during the dive AND while the wipe is still
          sweeping so it never re-composites mid-sweep / competes with the
          transition's GPU layer (#5). */}
      <BakedCrt suspended={mode === "diving" || wipeActive} />
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AnimusProvider>
        <Shell />
      </AnimusProvider>
    </HashRouter>
  );
}
