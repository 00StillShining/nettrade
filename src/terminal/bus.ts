/* =========================================================================
   TERMINAL 77 — SHELL BUS (small, deliberate glue; NOT in the original brief
   file list, added so Terminal.tsx and the 10 screen files never import each
   other — parallel screen agents depend only on this file + state.ts + the
   engine, so replacing a stub can never create an import cycle with the shell)

   What lives here and WHY:
   • the alerts MARQUEE store — the prototype's alertMsgs/pushAlert lived at
     page scope because the marquee is rendered by the Dashboard but written
     by CONFIRM on Positions (and by watch triggers). Same shape here: any
     screen (or the shell's ENTER key) pushes; the Dashboard subscribes.
   • the KEY-EXTRAS registry — the prototype's single keydown handler could
     reach into any screen's DOM ($('#alLevel').focus() etc). In the port the
     shell owns the global map but a few keys need the ACTIVE screen's DOM
     (A focuses the alerts level input, N/W focus/toggle the newest journal
     card). Screens register a handler; the shell consults it FIRST.
   • the REDRAW registry — the prototype's redrawActiveCharts() switch. The
     shell calls it mid power-off (after the route swap) and at settle; each
     screen registers its own "re-fit + redraw canvases" closure on mount.
   • the gotoScreen DELEGATE — screens' esc-back / icon affordances navigate
     through the shell's power-off transition without importing Terminal.tsx.
   • prefersReduced — the prototype's page-scoped matchMedia, shared.
   ========================================================================= */

import { setAlertOrder, notifyState, type ScreenId } from "./state";
import { DEFAULT_ROSTER } from "./engine/dataEngine";

/* ---------------- reduced-motion (page-scoped in the prototype) ---------------- */
export const prefersReduced: boolean =
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;

/* ================= ALERTS MARQUEE (prototype: ALERT_SEED / pushAlert) ================= */
const ALERT_SEED = [
  "▸ 09:31 VOLUME SPIKE: NVDA +3.2%",
  "▸ FED MINUTES 14:00 EST",
  "▸ 09:44 UNUSUAL OPTIONS FLOW: TSLA",
  "▸ CRYPTO: BTC RECLAIMS 97K",
  "▸ 10:02 AMD ANALYST UPGRADE — OUTPERFORM",
  "▸ GME SHORT INTEREST 21.4%",
  "▸ SPY VWAP HOLDING · BREADTH POSITIVE",
];
let alertMsgs = ALERT_SEED.slice();
let flashingAlert: string | null = null; // the one freshly-triggered message currently flashing orange

type Fn = () => void;
const marqListeners = new Set<Fn>();
export function subscribeMarquee(fn: Fn): () => void {
  marqListeners.add(fn);
  return () => { marqListeners.delete(fn); };
}
function notifyMarquee(): void { marqListeners.forEach((fn) => { try { fn(); } catch { /* keep the loop alive */ } }); }

/** Current messages + which one is mid-flash (brief §3.4: a triggered alert
    flashes orange ONCE, then settles to paper-on-ink). */
export function marqueeState(): { msgs: string[]; flashing: string | null } {
  return { msgs: alertMsgs, flashing: flashingAlert };
}

/** Prototype pushAlert(msg, flash) verbatim, minus the direct renderRoster()
    call (setAlertOrder + notifyState() repaints every subscribed roster). */
export function pushMarquee(msg: string, flash?: boolean): void {
  alertMsgs.unshift(msg);
  if (alertMsgs.length > 10) alertMsgs.pop();
  if (flash) {
    flashingAlert = msg;
    setTimeout(() => { if (flashingAlert === msg) { flashingAlert = null; notifyMarquee(); } }, 1500);
  }
  notifyMarquee();
  if (flash) {
    // triggered alert raises the orange star on the affected roster card
    const m = msg.match(/\b(NVDA|AAPL|TSLA|SPY|BTC|ETH|AMD|GME)[\w-]*\b/);
    if (m) {
      const sym = DEFAULT_ROSTER.find((s) => s.startsWith(m[1]));
      if (sym) { setAlertOrder(sym, true); notifyState(); }
    }
  }
}

/* ================= KEY-EXTRAS REGISTRY ================= */
/** A screen's handler for keys that need ITS DOM (focus/select). Return true
    to consume the event (the shell then skips its own map for that key).
    `editing` = an INPUT/TEXTAREA currently holds focus (already computed by
    the shell so every handler gates identically). */
export type KeyExtra = (e: KeyboardEvent, editing: boolean) => boolean;

const keyExtras = new Set<KeyExtra>();
export function registerKeyExtra(fn: KeyExtra): () => void {
  keyExtras.add(fn);
  return () => { keyExtras.delete(fn); };
}
export function runKeyExtras(e: KeyboardEvent, editing: boolean): boolean {
  for (const fn of keyExtras) { try { if (fn(e, editing)) return true; } catch { /* a broken screen must not eat the keyboard */ } }
  return false;
}

/* ================= REDRAW REGISTRY (prototype: redrawActiveCharts) ================= */
const redraws = new Set<Fn>();
/** Screens register "re-fit + redraw my canvases" on mount (cleanup on unmount).
    The shell invokes all of them right after the power-off route swap (while
    #screen is collapsed — fitCanvas's offsetWidth fallback is transform-immune)
    and again once the tube settles at true size. */
export function registerRedraw(fn: Fn): () => void {
  redraws.add(fn);
  return () => { redraws.delete(fn); };
}
export function runRedraws(): void { redraws.forEach((fn) => { try { fn(); } catch { /* one bad canvas must not kill the transition */ } }); }

/* ================= gotoScreen DELEGATE ================= */
/* Terminal.tsx installs its power-off navigator here on mount; screens call
   gotoScreen('dash') from esc-back affordances without importing the shell. */
let gotoImpl: ((id: ScreenId) => void) | null = null;
export function setGotoScreenImpl(fn: ((id: ScreenId) => void) | null): void { gotoImpl = fn; }
export function gotoScreen(id: ScreenId): void { if (gotoImpl) gotoImpl(id); }
