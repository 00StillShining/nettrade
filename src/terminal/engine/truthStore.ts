// truthStore.ts — the phase-2c TRUTH STORE (the core of the phase).
//
// A single module-scoped singleton that holds the computed Performance-Truth
// (the headline realised/unrealised/dividends split), the honest time-series
// bundle, and the raw fill/dividend history the History/Performance/Dividends
// screens read. It mirrors DataEngine's subscribe/notify shape exactly so
// screens re-render on a history-sync landing WITHOUT tearing down their
// canvases — the same calc/render separation the rest of the terminal uses.
//
// HONEST DATA: every field here is derived from REAL persisted history
// (order_history / dividend_history / transaction_history / equity_snapshots)
// or the live account. Nothing is interpolated or fabricated; an empty store is
// the correct, honest state for a user who has not synced yet. The sync itself
// lives in liveHistory.ts (fetch + mapping); this file only holds state.

import type { PerformanceTruth, SeriesBundle } from "../../engine/types";
import type { HistoryOrderFill, HistoryDividend } from "../../adapters/trading212";

// Per the shared contract, `startHistorySync` is part of truthStore.ts's PUBLIC
// surface (screens import it from here). Its IMPLEMENTATION lives in
// liveHistory.ts (the fetch + mapping module) to keep this file state-only; we
// re-export it so the contract's import site resolves. ESM handles this
// re-export cleanly despite liveHistory importing TruthStore back (the binding
// is resolved lazily at call time, and startHistorySync is never invoked during
// module init).
export { startHistorySync } from "./liveHistory";

/** Where the incremental history back-fill/catch-up currently stands. Screens
 *  can show a "syncing…" affordance without blocking first paint. */
export type HistorySyncState = "idle" | "syncing" | "done" | "error";

/** A persisted order fill enriched with its cleaned display ticker
 *  ("AAPL_US_EQ" -> "AAPL"). `fills` on the store are executed-only, newest-first. */
export type FillRow = HistoryOrderFill & { sym: string };

type Listener = () => void;
const listeners = new Set<Listener>();

export const TruthStore: {
  truth: PerformanceTruth | null;
  series: SeriesBundle | null;
  /** Executed fills only, newest-first (the History screen lists in reverse-chron). */
  fills: FillRow[];
  /** Dividends, newest-first. */
  dividends: HistoryDividend[];
  sync: HistorySyncState;
  /** The last sync failure's honest reason (e.g. "…/history/orders failed (403)"),
   *  or null. Carries only the endpoint + status kind — never a secret. Screens
   *  surface it so "BROKER SYNC FAILED" names WHY (a 403 = the T212 key lacks
   *  the history scopes; a 429 = rate-limited). */
  syncError: string | null;
  /** TRUE while the transactions back-fill is known-incomplete (deep pages
   *  blocked, e.g. the T212 pagination 404 bug). NET CONTRIBUTIONS is then
   *  UNDERSTATED and TOTAL GAIN may overstate — the truth deck must say so. */
  txnsPartial: boolean;
  /** When the last successful sync landed (ISO), or null if never. */
  syncedAtISO: string | null;
  /** Earliest recorded equity snapshot (ISO), or null — the honest start of the
   *  value curve; screens use it to caption "recorded since …". */
  firstSnapshotISO: string | null;
  /** Account currency the truth figures are denominated in (from the live
   *  account when known, else "GBP" fallback). */
  ccy: string;
  subscribe(fn: Listener): () => void;
  notify(): void;
} = {
  truth: null,
  series: null,
  fills: [],
  dividends: [],
  sync: "idle",
  syncError: null,
  txnsPartial: false,
  syncedAtISO: null,
  firstSnapshotISO: null,
  ccy: "GBP",

  // Screens subscribe once (in an effect); returns the unsubscribe closure.
  // Mirrors DataEngine.subscribe/notify: a subscriber throw is swallowed so one
  // screen's crash can never stall the others.
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  notify(): void {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.warn("TruthStore subscriber threw (kept alive):", err);
      }
    });
  },
};
