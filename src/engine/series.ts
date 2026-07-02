// Performance-Truth engine — honest time series. Every series here is
// built strictly from REAL dated events (cash movements, trades, recorded
// snapshots). NONE of these functions interpolate an unobserved value —
// a sparse or empty series is the CORRECT, honest output for a user with
// little history, never something to pad with fabricated points. This
// mirrors docs/CHART_CRAFT.md §9's honesty contract: the future
// ValueChart renders only caller-supplied numbers.

import type { CashEvent, EquitySnapshot, Period, Trade, TimeSeriesPoint } from "./types";
import { computeRealised } from "./truth";

/**
 * netDepositsSeries — cumulative (deposits - withdrawals), STEPPED at each
 * real cash-event date (never smoothed/interpolated between them — a
 * deposit is a step, not a ramp). Events are defensively sorted
 * chronologically first. A final point is appended at `asOfISO` carrying
 * the running total forward, UNLESS a point already exists exactly at
 * asOfISO, so the series always reaches "now" for charting without
 * duplicating a timestamp.
 *
 * Empty cashEvents -> empty series (honest: no history yet).
 */
export function netDepositsSeries(cashEvents: CashEvent[], asOfISO: string): TimeSeriesPoint[] {
  // Drop any event dated AFTER asOfISO first — otherwise an earlier as-of
  // would fold future movements into the "now" figure (a wrong point-in-time
  // value). Codepoint sort: ISO-8601 strings order correctly by codepoint, so
  // locale collation is both unnecessary and (across locales) non-deterministic.
  const ordered = [...cashEvents]
    .filter((e) => e.dateISO <= asOfISO)
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
  if (ordered.length === 0) return [];

  const points: TimeSeriesPoint[] = [];
  let running = 0;
  for (const e of ordered) {
    if (e.kind === "deposit") running += e.amountMinor;
    else if (e.kind === "withdrawal") running -= e.amountMinor;
    // dividends/fees/interest are NOT contributions — they don't move the
    // net-deposits benchmark line, only the P/L side of the truth split.
    else continue;
    points.push({ atISO: e.dateISO, valueMinor: running });
  }

  const last = points[points.length - 1];
  if (!last || last.atISO !== asOfISO) {
    points.push({ atISO: asOfISO, valueMinor: running });
  }

  return points;
}

/**
 * realisedSeries — cumulative realised P/L, stamped at each SELL date (the
 * only dates realised P/L can honestly change — buys don't realise
 * anything). Reuses `computeRealised`'s average-cost replay logic by
 * re-running it incrementally trade-by-trade in chronological order so
 * each sell's individual contribution is captured at its own date; this
 * keeps the replay rules (average-cost, clamping, fee treatment) in
 * exactly one place (truth.ts) rather than duplicating them here.
 *
 * A final point is appended at `asOfISO` carrying the running total
 * forward, unless a sell already landed exactly on asOfISO.
 *
 * Empty/no-sell trade list -> empty series (honest: nothing realised yet).
 */
export function realisedSeries(trades: Trade[], asOfISO: string): TimeSeriesPoint[] {
  // Window to trades on/before asOfISO (see netDepositsSeries), THEN derive
  // sells from the windowed set — a future sell must not stamp a point now.
  // Codepoint sort of ISO strings.
  const ordered = [...trades]
    .filter((t) => t.dateISO <= asOfISO)
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
  if (!ordered.some((t) => t.side === "sell")) return [];

  const points: TimeSeriesPoint[] = [];
  let prevRealised = 0;
  const prefix: Trade[] = [];
  for (const t of ordered) {
    prefix.push(t);
    if (t.side !== "sell") continue;
    // Re-replay the prefix up to and including this sell. This is O(n^2)
    // in trade count, which is fine for the realistic scale of a personal
    // account's history (hundreds, not millions, of trades) and keeps the
    // single source of truth for the replay rules in computeRealised.
    const { realisedPlMinor } = computeRealised(prefix);
    // Every sell is a real dated event worth stamping, even when the
    // running total doesn't move (e.g. a clamped no-op sell).
    points.push({ atISO: t.dateISO, valueMinor: realisedPlMinor });
    prevRealised = realisedPlMinor;
  }

  const last = points[points.length - 1];
  if (!last || last.atISO !== asOfISO) {
    points.push({ atISO: asOfISO, valueMinor: prevRealised });
  }

  return points;
}

/**
 * valueSeries — straight PASSTHROUGH of the recorded EquitySnapshot
 * points, sorted chronologically. This is the ONLY honest source of past
 * mark-to-market: the app persists one snapshot per sync, so this series
 * is exactly as dense as the user's actual sync history — nothing more.
 *
 * A sparse or EMPTY series (a brand-new user with zero/one syncs) is
 * CORRECT and honest. It must NEVER be padded with fake points, smoothed,
 * or backfilled — that would fabricate a value history that never
 * happened, which is precisely what the Performance-Truth engine exists
 * to avoid doing.
 */
export function valueSeries(snapshots: EquitySnapshot[]): TimeSeriesPoint[] {
  return [...snapshots]
    .sort((a, b) => (a.atISO < b.atISO ? -1 : a.atISO > b.atISO ? 1 : 0))
    .map((s) => ({ atISO: s.atISO, valueMinor: s.totalValueMinor }));
}

/** Milliseconds-since-epoch helper; returns NaN for an unparsable ISO string. */
function toMs(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * monthsBackMs — `months` calendar-months before `asOf`, with the day
 * CLAMPED to the last valid day of the target month. Plain
 * `d.setMonth(d.getMonth() - n)` overflows at month-end (e.g. 1 month back
 * from Mar 31 rolls past Feb into Mar 3), which would silently and
 * wrongly exclude real points that fall in that overflow gap. Also used
 * for the 1Y case (via months=12) so the Feb-29 leap-year edge is clamped
 * the same way instead of rolling from Feb 29 to Mar 1.
 */
function monthsBackMs(asOf: Date, months: number): number {
  // ALL-UTC arithmetic: toMs() parses ISO date-only strings as UTC and the YTD
  // branch uses Date.UTC, so this must too — mixing local-time getters here
  // would shift the window start by up to a day depending on the machine's
  // timezone, making the same inputs filter differently on different machines
  // (a purity/determinism break).
  const d = new Date(asOf);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const daysInTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInTarget));
  return d.getTime();
}

/**
 * periodStartMs — the single source of truth for "when does this period's
 * window begin" (milliseconds since epoch), shared by `filterByPeriod`
 * here and by `periodStartISO` in period.ts so the two never drift apart.
 * Returns `null` for "ALL" (no window start — the whole history). Returns
 * `NaN` for an unparsable `asOfISO` (callers already guard this before
 * calling — see filterByPeriod/periodStartISO — so this is defensive only).
 *
 * ALL-UTC, deterministic: never reads Date.now() or a local-time getter
 * (see monthsBackMs's doc comment on why local time would break
 * reproducibility across machines/timezones).
 */
function periodStartMs(period: Period, asOfISO: string): number | null {
  if (period === "ALL") return null;

  const asOfDate = new Date(asOfISO);

  switch (period) {
    case "1M":
      return monthsBackMs(asOfDate, 1);
    case "3M":
      return monthsBackMs(asOfDate, 3);
    case "6M":
      return monthsBackMs(asOfDate, 6);
    case "1Y":
      return monthsBackMs(asOfDate, 12);
    case "YTD":
      return new Date(Date.UTC(asOfDate.getUTCFullYear(), 0, 1)).getTime();
  }
}

/**
 * filterByPeriod — clips an already-computed series to a period window
 * ending at `asOfISO`. This is a pure windowing/subsetting operation: it
 * never invents points at the window edges, it just keeps whichever real
 * points already fall inside [start, asOfISO]. "ALL" returns every point
 * unchanged (still sorted by the caller's series functions).
 */
export function filterByPeriod(points: TimeSeriesPoint[], period: Period, asOfISO: string): TimeSeriesPoint[] {
  if (period === "ALL") return points;

  const asOfMs = toMs(asOfISO);
  if (Number.isNaN(asOfMs)) return points; // defensive: unparsable asOf — don't silently drop everything

  const startMs = periodStartMs(period, asOfISO);
  // periodStartMs only returns null for "ALL", already handled above, so
  // startMs is a number here; the `?? -Infinity` is a defensive fallback only.
  const startMsSafe = startMs ?? -Infinity;

  return points.filter((p) => {
    const ms = toMs(p.atISO);
    return !Number.isNaN(ms) && ms >= startMsSafe && ms <= asOfMs;
  });
}

/**
 * periodStartMsExported — internal re-export point for period.ts. Not part
 * of the public series.ts API surface used by screens; period.ts imports
 * this single function so periodStartISO can never compute a different
 * window boundary than filterByPeriod does for the same (period, asOfISO).
 */
export { periodStartMs as __periodStartMsForPeriodModule };
