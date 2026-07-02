// Actuality — Animus shared store (Phase 3a).
//
// The coordination hub between the three Animus pieces that must NOT be nested
// (the persistent <Canvas> lives at the App root; the menu HUD + labels are
// route/overlay siblings). It carries:
//   - `selected`  (0..6)         React state — drives HUD + which stack is red.
//   - `active`    (menu|screen|diving)  React state — drives frameloop + CRT.
//   - imperative label registration + a per-frame projection writer, so the
//     in-Canvas projector writes screen coords straight onto the label DOM
//     elements (no per-frame React re-render, no second rAF loop).
//   - an `invalidate` bridge so React can kick the demand-frameloop when (and
//     only when) something starts animating; the scene NEVER self-invalidates
//     at rest (anti-brick law #2).
//
// Anti-brick: this is plain refs + a tiny context. No animation lives here.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { STACK_COUNT, clampSelection, routeForSelection } from "./destinations";
import { DIVE_DOLLY_LEAD_MS, DIVE_NAV_AT_MS, DIVE_TOTAL_MS } from "./diveTiming";

/** Where the app's attention is — governs the frameloop + CRT + input. */
export type AnimusMode = "menu" | "screen" | "diving";

/** A projected label slot the overlay fills in and the projector writes to. */
export interface LabelSlot {
  /** The label's DOM node (registered by the overlay), or null if unmounted. */
  el: HTMLDivElement | null;
  /** Last projected screen x (px), for the leader-line / debug. */
  x: number;
  /** Last projected screen y (px). */
  y: number;
  /** Whether the stack is in front of the camera (behind → hidden). */
  visible: boolean;
}

interface AnimusStore {
  /** Selected stack index (0..STACK_COUNT-1). */
  selected: number;
  /** Move selection and kick a render. */
  setSelected: (next: number | ((cur: number) => number)) => void;
  /** menu | screen | diving. */
  mode: AnimusMode;
  setMode: (m: AnimusMode) => void;

  /** Register/lookup the per-stack label slots (imperative; no re-render). */
  labelSlots: React.MutableRefObject<LabelSlot[]>;

  /** Bridge the r3f invalidate() out so React can kick demand-frameloop. */
  registerInvalidate: (fn: () => void) => void;
  /** Kick one render of the persistent canvas (safe no-op before registration). */
  invalidate: () => void;

  /** Trigger a dive into a stack (owned by the provider so it survives nav). */
  requestDive: (index: number) => void;
  /** Whether the dive wipe is currently sweeping (drives MenuWipe + CRT). */
  wipeActive: boolean;
  /** Fresh id per dive so MenuWipe keys a brand-new clip-path node each time. */
  wipeRunId: number;
}

const AnimusContext = createContext<AnimusStore | null>(null);

function makeSlots(): LabelSlot[] {
  return Array.from({ length: STACK_COUNT }, () => ({
    el: null,
    x: 0,
    y: 0,
    visible: false,
  }));
}

export function AnimusProvider({ children }: { children: ReactNode }) {
  const [selected, setSelectedState] = useState(0);
  const [mode, setModeState] = useState<AnimusMode>("menu");
  const [wipeActive, setWipeActive] = useState(false);
  const [wipeRunId, setWipeRunId] = useState(0);
  const navigate = useNavigate();

  const labelSlots = useRef<LabelSlot[]>(makeSlots());
  const invalidateRef = useRef<(() => void) | null>(null);

  // Dive orchestrator state lives HERE (in the provider, above the Routes) so
  // the wipe + its teardown timers OUTLIVE the AnimusMenu → screen navigation:
  // when we navigate() at the cover point, AnimusMenu unmounts, but MenuWipe now
  // renders in Shell and these timers keep running to sweep-off + tear down.
  const divingRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const invalidate = useCallback(() => {
    invalidateRef.current?.();
  }, []);

  const registerInvalidate = useCallback((fn: () => void) => {
    invalidateRef.current = fn;
  }, []);

  const requestDive = useCallback(
    (index: number) => {
      if (divingRef.current) return; // ignore re-entrant dives
      divingRef.current = true;
      // Prune the previous dive's (already-fired) timer ids so the list can't
      // grow unbounded across a long session.
      timers.current.forEach(clearTimeout);
      timers.current = [];

      const route = routeForSelection(index);

      // 1. mode → diving: AnimusScene pulls the selected stack to the lens.
      setModeState("diving");
      invalidateRef.current?.();

      // 2. after a short dolly lead, fire the wipe (fresh runId → fresh node).
      timers.current.push(
        setTimeout(() => {
          setWipeRunId((n) => n + 1);
          setWipeActive(true);
        }, DIVE_DOLLY_LEAD_MS),
      );

      // 3. at the wipe's cover point, navigate + flip to screen mode (freezes
      //    the canvas; the CRT stays suspended until the wipe tears down).
      timers.current.push(
        setTimeout(() => {
          setModeState("screen");
          navigate(route);
        }, DIVE_DOLLY_LEAD_MS + DIVE_NAV_AT_MS),
      );

      // 4. tear down the wipe DOM once it has swept off — this timer survives
      //    the navigation because the provider (not AnimusMenu) owns it.
      timers.current.push(
        setTimeout(() => {
          setWipeActive(false);
          divingRef.current = false;
        }, DIVE_TOTAL_MS),
      );
    },
    [navigate],
  );

  // Clear any in-flight dive timers if the whole provider unmounts.
  useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach(clearTimeout);
    };
  }, []);

  const setSelected = useCallback(
    (next: number | ((cur: number) => number)) => {
      setSelectedState((cur) => {
        const raw = typeof next === "function" ? next(cur) : next;
        return clampSelection(raw);
      });
      // Kick the frameloop so the reshuffle actually animates from idle.
      invalidateRef.current?.();
    },
    [],
  );

  const setMode = useCallback((m: AnimusMode) => {
    setModeState(m);
    invalidateRef.current?.();
  }, []);

  const value = useMemo<AnimusStore>(
    () => ({
      selected,
      setSelected,
      mode,
      setMode,
      labelSlots,
      registerInvalidate,
      invalidate,
      requestDive,
      wipeActive,
      wipeRunId,
    }),
    [
      selected,
      setSelected,
      mode,
      setMode,
      registerInvalidate,
      invalidate,
      requestDive,
      wipeActive,
      wipeRunId,
    ],
  );

  return <AnimusContext.Provider value={value}>{children}</AnimusContext.Provider>;
}

export function useAnimus(): AnimusStore {
  const ctx = useContext(AnimusContext);
  if (!ctx) throw new Error("useAnimus must be used within <AnimusProvider>");
  return ctx;
}
