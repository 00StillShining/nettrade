import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import Frame from "../shell/Frame";
import { useAnimus } from "./animusStore";
import { selectionForRoute } from "./destinations";

// ScreenFrame — wraps a routed data screen in the opaque dark <Frame> AND
// asserts the Animus canvas into "screen" mode so its useFrame early-returns
// (the persistent GPU layer goes dead-still behind the opaque screen — the
// single most important anti-brick rule, #2).
//
// Setting mode here (not only in the dive orchestrator) makes it robust to
// DIRECT navigation / hard reload onto a screen route: the menu route never
// ran, but the screen still freezes the canvas correctly.
//
// It also seeds the menu selection from the current route, so Esc-ing back to
// the Animus returns with THIS screen's stack selected (rather than a stale /
// default DASHBOARD) — including after a direct-URL / hard-reload landing.
export default function ScreenFrame({ children }: { children: ReactNode }) {
  const { setMode, setSelected } = useAnimus();
  const { pathname } = useLocation();

  useEffect(() => {
    setMode("screen");
    const i = selectionForRoute(pathname);
    if (i !== null) setSelected(i);
  }, [setMode, setSelected, pathname]);

  return <Frame>{children}</Frame>;
}
