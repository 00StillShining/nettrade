import "./index.css";
import "./theme/tokens.css";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Frame from "./shell/Frame";
import BakedCrt from "./shell/BakedCrt";
import Dashboard from "./screens/dashboard/Dashboard";
import Positions from "./screens/positions/Positions";
import Watchlist from "./screens/watchlist/Watchlist";
import Performance from "./screens/performance/Performance";
import Placeholder from "./screens/Placeholder";

/**
 * App — Phase-2 shell. Dark cinematic Frame holds the routed screen; a baked
 * (static, inert) CRT overlay sits on top. No live filters, no
 * backdrop-filter, no WebGL yet (that's Phase 3 for the Animus menu).
 *
 * Dashboard, Positions, Watchlist and Performance are real screens; the
 * remaining two data screens (Compare, Journal) plus Settings render the
 * shared cream-paper Placeholder until they're built. Everything else
 * redirects home.
 */
export default function App() {
  return (
    <HashRouter>
      <Frame>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/positions" element={<Positions />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/compare" element={<Placeholder name="Compare" />} />
          <Route path="/journal" element={<Placeholder name="Journal" />} />
          <Route path="/settings" element={<Placeholder name="Settings" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Frame>
      <BakedCrt />
    </HashRouter>
  );
}
