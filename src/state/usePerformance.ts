// Performance-Truth state hook — composes the (already-built, untouched)
// engine in src/engine/** for the Performance screen. Mirrors usePositions'
// shape (status/error/lastSync/refresh) so the screen wires up the same way
// as every other data screen. This hook does NOT reimplement any engine
// maths — it only calls computeTruth + the series functions and applies
// filterByPeriod to the curve series for the active period selector.
//
// MOCK path (VITE_MOCK): MOCK_CASH_EVENTS/MOCK_TRADES/MOCK_SNAPSHOTS +
// MOCK_POSITIONS + a FIXED asOfISO (matching the "now" the mock data was
// hand-authored against — see mockPerformance.ts's header comment: the
// final snapshot reconciles exactly with MOCK_POSITIONS' total value),
// exactly like MOCK_POSITIONS itself is a fixed placeholder rather than a
// Date.now()-derived one.
//
// LIVE path: history endpoints (statement/dividends/interest export) and
// snapshot-on-sync persistence are NOT wired yet — that is a later task
// (see docs/CHART_CRAFT.md's ValueChart data contract + REBUILD_BRIEF.md's
// money section on why the app persists one EquitySnapshot per sync). Until
// then this hook is honest about what it can and can't tell the user: it
// reuses usePositions (no new network calls) for the CURRENT positions
// snapshot, and derives what that alone allows — current value and
// unrealised P/L, via computeTruth with EMPTY cashEvents/trades/snapshots.
// Deposits, realised P/L, dividends, fees, interest and the whole equity
// curve are honestly flagged as "pending history sync" via `historyPending`
// rather than presented as confirmed zeros (an empty cashEvents list makes
// computeTruth report net contributions of literally £0, which reads as a
// real fact rather than "not yet known" unless the caller flags it).
//
// FULL LIVE WIRING IS A LATER TASK: a Trading 212 history adapter that maps
// raw statement/dividend/interest data into CashEvent[]/Trade[], plus
// snapshot persistence (one EquitySnapshot per sync, see EquitySnapshot's
// doc comment in engine/types.ts) to build value[]/netDeposits[] over time.

import { useMemo, useState } from "react";
import { usePositions } from "./usePositions";
import type { Position } from "../adapters/trading212";
import { computeTruth } from "../engine/truth";
import { netDepositsSeries, realisedSeries, valueSeries, filterByPeriod } from "../engine/series";
import type { CashEvent, EquitySnapshot, PerformanceTruth, Period, SeriesBundle, Trade } from "../engine/types";
import { MOCK_CASH_EVENTS, MOCK_TRADES, MOCK_SNAPSHOTS } from "../data/mockPerformance";
import { MOCK_POSITIONS } from "../data/mockPositions";

/** Fixed "now" the mock cash events/trades/snapshots were hand-authored
 * against (see mockPerformance.ts's header comment — the final snapshot is
 * dated 2026-07-01 and reconciles exactly with MOCK_POSITIONS). Never
 * Date.now() for mock data — a fixed constant keeps the mock story
 * reproducible and self-consistent, matching MOCK_POSITIONS' convention. */
const MOCK_AS_OF_ISO = "2026-07-01";

export type PerformanceStatus = "idle" | "loading" | "ok" | "no-key" | "error" | "history-pending";

export interface UsePerformanceResult {
  truth: PerformanceTruth | null;
  series: SeriesBundle;
  status: PerformanceStatus;
  error: string | null;
  lastSync: string | null;
  period: Period;
  setPeriod: (p: Period) => void;
  refresh: () => Promise<void>;
  /** True on the live path until history endpoints + snapshot persistence
   * are wired — the screen uses this to show the honest "connect + sync to
   * build your performance history" state instead of a fabricated curve. */
  historyPending: boolean;
}

/** Shared composition: engine calls only, no I/O. Exposed separately so the
 * mock/live hooks below both drive it from their own cashEvents/trades/
 * snapshots/positions without duplicating the computeTruth + series wiring. */
function buildPerformance(
  cashEvents: CashEvent[],
  trades: Trade[],
  positions: Position[],
  snapshots: EquitySnapshot[],
  asOfISO: string,
  currency: string,
  period: Period,
): { truth: PerformanceTruth; series: SeriesBundle } {
  const truth = computeTruth(cashEvents, trades, positions, asOfISO, currency);
  const fullSeries: SeriesBundle = {
    netDeposits: netDepositsSeries(cashEvents, asOfISO),
    realised: realisedSeries(trades, asOfISO),
    value: valueSeries(snapshots),
  };
  return {
    truth,
    series: {
      netDeposits: filterByPeriod(fullSeries.netDeposits, period, asOfISO),
      realised: filterByPeriod(fullSeries.realised, period, asOfISO),
      value: filterByPeriod(fullSeries.value, period, asOfISO),
    },
  };
}

/** MOCK path — placeholder engine inputs, zero I/O (mirrors MOCK_POSITIONS'
 * "design iteration only" convention). Used by Performance.tsx's mock
 * container only, under `import.meta.env.VITE_MOCK`. */
export function useMockPerformance(): UsePerformanceResult {
  const [period, setPeriod] = useState<Period>("ALL");
  const [lastSync] = useState(() => new Date(Date.now() - 90_000).toISOString());

  const { truth, series } = useMemo(
    () =>
      buildPerformance(
        MOCK_CASH_EVENTS,
        MOCK_TRADES,
        MOCK_POSITIONS,
        MOCK_SNAPSHOTS,
        MOCK_AS_OF_ISO,
        "GBP",
        period,
      ),
    [period],
  );

  return {
    truth,
    series,
    status: "ok",
    error: null,
    lastSync,
    period,
    setPeriod,
    refresh: async () => {},
    historyPending: false,
  };
}

/**
 * LIVE path — reuses the EXISTING usePositions("default", "live") hook for
 * the current positions snapshot (no new network calls beyond it). History
 * (cash events, trades, past equity snapshots) is not wired yet, so this
 * computes computeTruth with EMPTY cashEvents/trades/snapshots — which
 * honestly yields £0 deposits/realised/dividends/fees/interest and an empty
 * curve — and flags the result via `historyPending` so the screen can tell
 * the user plainly ("connect + sync to build your performance history")
 * rather than presenting those honest zeros as confirmed figures. Used by
 * Performance.tsx's live container only, when VITE_MOCK is unset.
 */
export function useLivePerformance(): UsePerformanceResult {
  const [period, setPeriod] = useState<Period>("ALL");
  const { positions, status: posStatus, error, lastSync, refresh } = usePositions("default", "live");

  const currency = positions[0]?.accountCurrency ?? "GBP";

  const { truth, series } = useMemo(() => {
    const asOfISO = new Date().toISOString();
    return buildPerformance([], [], positions, [], asOfISO, currency, period);
  }, [positions, currency, period]);

  const status: PerformanceStatus =
    posStatus === "ok"
      ? "history-pending" // positions loaded, but history/curve are honestly not available yet
      : posStatus === "loading" || posStatus === "idle"
        ? "loading"
        : posStatus === "no-key"
          ? "no-key"
          : "error";

  return {
    truth,
    series,
    status,
    error,
    lastSync,
    period,
    setPeriod,
    refresh,
    historyPending: true,
  };
}

// NOTE: no combined usePerformance() switch is exported here — Performance.tsx
// picks useMockPerformance() vs useLivePerformance() at its Mock/Live
// CONTAINER-COMPONENT level (mirroring Positions.tsx/Dashboard.tsx's
// MockPositions/LivePositions split), so neither hook is ever called
// conditionally at runtime inside one component.
