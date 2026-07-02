// Performance-Truth engine — PERIOD-AWARE truth. Extends truth.ts/series.ts
// so the user can compare an honest gain figure FOR A SPECIFIC WINDOW
// (YTD/1M/3M/6M/1Y) against their broker's own period figure (e.g.
// Trading 212's "+£59.90 YTD"), instead of only ever seeing the all-time
// True Gain. See types.ts's `PeriodTruth`/`PeriodComponents` doc comments
// for the TWO-LENS model this module produces — read those before reading
// this file's functions, they explain WHY there are two separate figures
// and why they must never be summed.
//
// Every function here is PURE: no I/O, no Date.now() — callers pass
// `asOfISO` explicitly, exactly like truth.ts/series.ts.

import Decimal from "decimal.js";
import type { Position } from "../adapters/trading212";
import type { CashEvent, EquitySnapshot, Period, PeriodComponents, PeriodTruth, Trade } from "./types";
import { replayRealisedEvents } from "./truth";
import { __periodStartMsForPeriodModule as periodStartMs } from "./series";

/**
 * periodStartISO — the window start for a period, as an ISO date string, or
 * `null` for "ALL" (no window — all-time). Reuses the EXACT SAME UTC
 * month-arithmetic as series.ts's `filterByPeriod` via the shared
 * `periodStartMs` helper — this function and `filterByPeriod` can never
 * disagree about where a period's window begins, because they are both
 * thin wrappers around the one calculation.
 *
 * ALL-UTC, deterministic: no Date.now(), no local-time getters (see
 * series.ts's monthsBackMs doc comment for why local time would break
 * reproducibility). Returns `null` for an unparsable `asOfISO` OR for
 * "ALL" — callers distinguish "ALL" from "unparsable" by checking `period`
 * themselves if that distinction matters; here both honestly mean "no
 * window start to report."
 */
export function periodStartISO(period: Period, asOfISO: string): string | null {
  if (period === "ALL") return null;
  const startMs = periodStartMs(period, asOfISO);
  if (startMs === null || Number.isNaN(startMs)) return null;
  return new Date(startMs).toISOString();
}

/**
 * sumByKindInWindow — sums cashEvents of a given kind whose dateISO falls
 * inside the window `(startISO, asOfISO]` — i.e. STRICTLY AFTER startISO,
 * up to and including asOfISO. This boundary convention (exclusive start,
 * inclusive end) is used EVERYWHERE in this module and mirrors how a
 * calendar period is normally read ("since the start of the window, as of
 * today" — the instant AT the boundary belongs to the period that is
 * ENDING there, not the one beginning there, which matters most for
 * snapshot anchors: see computePeriodTruth's anchor-selection doc comment,
 * which deliberately allows `atISO <= startISO` for the OPPOSITE boundary
 * for the same reason — the anchor is "the last known truth before this
 * window opened").
 *
 * `startISO === null` (the "ALL" case) means no lower bound — every event
 * up to asOfISO counts.
 */
function sumByKindInWindow(
  cashEvents: CashEvent[],
  kind: CashEvent["kind"],
  startISO: string | null,
  asOfISO: string,
): number {
  let total = 0;
  for (const e of cashEvents) {
    if (e.kind !== kind) continue;
    if (e.dateISO > asOfISO) continue;
    if (startISO !== null && e.dateISO <= startISO) continue;
    total += e.amountMinor;
  }
  return total;
}

/**
 * computePeriodComponents — the EXACTLY-computable windowed sums for a
 * period. See `PeriodComponents`'s doc comment in types.ts for the overall
 * "component lens" framing (and its limitation: no unrealised change).
 *
 * BOUNDARY CONVENTION (kept consistent across every sum in this function,
 * and reused by computePeriodTruth for the whole PeriodTruth): an event
 * counts in the window when `startISO < event.dateISO <= asOfISO`. `null`
 * startISO (the "ALL" case) means no lower bound.
 *
 * REALISED P/L — the one sum that is NOT a plain "is the date in range"
 * filter: `realisedInWindowMinor` replays ALL trades chronologically from
 * the very beginning (not just trades dated inside the window), because
 * cost basis legitimately CARRIES IN from before the window — e.g. shares
 * bought last year and sold this year realise a gain/loss THIS year, and
 * that realisation is only correct if the replay knew the true average
 * cost built up over the position's whole history, not just the window.
 * The replay itself is NOT duplicated here: `replayRealisedEvents` (in
 * truth.ts) is the single source of truth for the average-cost/clamping/fee
 * rules; this function only decides, per SELL event the replay yields,
 * whether that sell's date falls inside the window, and if so accumulates
 * its (raw, unrounded) realised delta — rounding to integer minor units
 * happens once, at the end, exactly like computeRealised's whole-total
 * rounding.
 *
 * CURRENCY CAVEAT: realisedInWindowMinor inherits the v1
 * instrument-currency limitation documented on Trade/computeRealised in
 * types.ts/truth.ts — exact only for single-currency accounts.
 */
export function computePeriodComponents(
  cashEvents: CashEvent[],
  trades: Trade[],
  startISO: string | null,
  asOfISO: string,
): PeriodComponents {
  const depositsMinor = sumByKindInWindow(cashEvents, "deposit", startISO, asOfISO);
  const withdrawalsMinor = sumByKindInWindow(cashEvents, "withdrawal", startISO, asOfISO);
  const dividendsMinor = sumByKindInWindow(cashEvents, "dividend", startISO, asOfISO);
  const feesMinor = sumByKindInWindow(cashEvents, "fee", startISO, asOfISO);
  const interestMinor = sumByKindInWindow(cashEvents, "interest", startISO, asOfISO);

  // Replay every trade (full history, not just the window — see doc
  // comment above) and accumulate only the sells whose date falls inside
  // the window, using the SAME boundary convention as the cash-event sums.
  let realisedInWindowTotal = new Decimal(0);
  for (const e of replayRealisedEvents(trades)) {
    if (e.dateISO > asOfISO) continue;
    if (startISO !== null && e.dateISO <= startISO) continue;
    realisedInWindowTotal = realisedInWindowTotal.plus(e.realisedMinor);
  }

  return {
    depositsMinor,
    withdrawalsMinor,
    netContributionsMinor: depositsMinor - withdrawalsMinor,
    dividendsMinor,
    feesMinor,
    interestMinor,
    realisedInWindowMinor: Math.round(realisedInWindowTotal.toNumber()),
  };
}

/**
 * latestSnapshotAtOrBefore — the LATEST EquitySnapshot with `atISO <=
 * cutoffISO`, or `null` if none exists. NEVER substitutes a later snapshot
 * — a missing anchor is reported as null, not silently papered over with
 * the nearest-available point (that would fabricate a value that was never
 * actually recorded at the window start, violating the same honesty law
 * valueSeries follows in series.ts).
 */
function latestSnapshotAtOrBefore(snapshots: EquitySnapshot[], cutoffISO: string): EquitySnapshot | null {
  let best: EquitySnapshot | null = null;
  for (const s of snapshots) {
    if (s.atISO > cutoffISO) continue;
    if (best === null || s.atISO > best.atISO) best = s;
  }
  return best;
}

/**
 * computePeriodTruth — the period-aware Performance-Truth output. Produces
 * BOTH lenses described in `PeriodTruth`'s doc comment (types.ts) — read
 * that first. This function itself does not choose which lens a screen
 * should show; it hands back both, honestly, and the screen decides (see
 * Performance.tsx: it prefers the snapshot lens when an anchor exists,
 * because that is the only lens that is a COMPLETE gain figure —
 * component-lens alone is missing unrealised change).
 *
 * period === "ALL": `startISO` is null (no window). `components` is built
 * from computePeriodComponents with startISO=null (no lower bound), which
 * sums the exact same events the all-time `computeTruth` does — so the two
 * component sums (deposits/withdrawals/dividends/fees/interest) are IDENTICAL
 * by construction, and `realisedInWindowMinor` equals computeTruth's
 * `realisedPlMinor` for the same reason (the whole-history replay with no
 * window start excludes nothing). That equivalence is ASSERTED by the
 * ALL-equivalence tests in period.test.ts, not recomputed here.
 * `snapshotGain.anchor` is null with a note explaining that ALL uses the
 * all-time truth instead of a snapshot delta — there is no "period start" to
 * anchor against for all-time.
 *
 * period !== "ALL": `startISO` = periodStartISO(period, asOfISO).
 * `components` = computePeriodComponents(cashEvents, trades, startISO,
 * asOfISO). `snapshotGain.anchor` = latestSnapshotAtOrBefore(snapshots,
 * startISO) — the last recorded mark-to-market AT OR BEFORE the window
 * opened. When an anchor exists:
 *   gainMinor = currentValueMinor − anchor.totalValueMinor − sinceAnchorNetContributions
 * where currentValueMinor is summed fresh from live `positions` (the honest
 * "now" mark, same source computeTruth uses) and sinceAnchorNetContributions
 * is deposits minus withdrawals from the ANCHOR's own date up to asOfISO —
 * NOT the window's own net contributions. The anchor can pre-date the window
 * start, and any contribution made between the anchor and the window start is
 * already in currentValueMinor but not in anchor.totalValueMinor; netting
 * only in-window contributions would report that money as growth (see
 * snapshotGain's doc comment in types.ts for the full masquerade argument).
 * Same (exclusive-start, inclusive-end] convention as the component lens, so
 * money added is money added, not money earned. `returnPct` divides gainMinor
 * by (anchor value + sinceAnchorNetContributions) via decimal.js, null when
 * that base is <= 0.
 * When no anchor exists, `gainMinor` is null and `note` explains honestly
 * that Actuality has no recorded snapshot at/before the period start yet
 * (one snapshot is persisted per sync, so this fills in over time as the
 * user keeps syncing) — never a later snapshot substituted, never
 * interpolated.
 */
export function computePeriodTruth(
  cashEvents: CashEvent[],
  trades: Trade[],
  positions: Position[],
  snapshots: EquitySnapshot[],
  period: Period,
  asOfISO: string,
  currency: string,
): PeriodTruth {
  // `currency` is part of this function's public signature for symmetry with
  // computeTruth and future currency-aware formatting, but no figure here is
  // currency-tagged (every *Minor field is already account-currency minor
  // units); reserved, same idiom as computeTruth's `void asOfISO`.
  void currency;

  if (period === "ALL") {
    // ALL is NOT recomputed here from computeTruth: `components` built with
    // startISO=null (no lower bound) sums the EXACT SAME events computeTruth
    // does, so components.realisedInWindowMinor === computeTruth(...)
    // .realisedPlMinor by construction, and the
    // deposit/withdrawal/dividend/fee/interest sums match likewise — that
    // equivalence is asserted by the ALL-equivalence tests in period.test.ts
    // rather than recomputed (and discarded) on every call here.
    const components = computePeriodComponents(cashEvents, trades, null, asOfISO);
    return {
      period,
      startISO: null,
      components,
      snapshotGain: {
        anchor: null,
        gainMinor: null,
        sinceAnchorNetContributionsMinor: null,
        returnPct: null,
        note:
          "ALL mirrors the all-time True Gain above (component sum since the account opened) — " +
          "there is no earlier window start to anchor a holdings-growth reading against.",
      },
    };
  }

  const startISO = periodStartISO(period, asOfISO);
  const components = computePeriodComponents(cashEvents, trades, startISO, asOfISO);

  let currentValueMinor = 0;
  for (const p of positions) currentValueMinor += p.currentValueMinor;

  const anchor = startISO === null ? null : latestSnapshotAtOrBefore(snapshots, startISO);

  if (anchor === null) {
    return {
      period,
      startISO,
      components,
      snapshotGain: {
        anchor: null,
        gainMinor: null,
        sinceAnchorNetContributionsMinor: null,
        returnPct: null,
        note:
          "No recorded snapshot at the period start — Actuality records one equity snapshot per sync, " +
          "so this fills in over time as you keep syncing.",
      },
    };
  }

  // Contributions must be netted from the ANCHOR's own date, not the window
  // start: the anchor may pre-date the window, and a deposit made between the
  // anchor and the window start is inside currentValueMinor but not inside
  // anchor.totalValueMinor — netting only in-window contributions would report
  // that deposit as growth (the exact masquerade this app exists to prevent).
  // Same (exclusive-start, inclusive-end] convention as every other sum here.
  const depositsSinceAnchor = sumByKindInWindow(cashEvents, "deposit", anchor.atISO, asOfISO);
  const withdrawalsSinceAnchor = sumByKindInWindow(cashEvents, "withdrawal", anchor.atISO, asOfISO);
  const sinceAnchorNetContributionsMinor = depositsSinceAnchor - withdrawalsSinceAnchor;
  const gainMinor = currentValueMinor - anchor.totalValueMinor - sinceAnchorNetContributionsMinor;

  // Snapshot-lens return %: gain over "what was actually at risk from the
  // anchor onward" (anchor value + everything added since). decimal.js ratio
  // (engine convention). Null when the denominator is <= 0 — an undefined /
  // meaningless base, same divide-by-zero guard as computeTruth's
  // totalReturnPct.
  const denom = anchor.totalValueMinor + sinceAnchorNetContributionsMinor;
  const returnPct = denom <= 0 ? null : new Decimal(gainMinor).dividedBy(denom).toNumber();

  return {
    period,
    startISO,
    components,
    snapshotGain: {
      anchor,
      gainMinor,
      sinceAnchorNetContributionsMinor,
      returnPct,
      note: `Value change minus what you added, since the ${anchor.atISO.slice(0, 10)} snapshot.`,
    },
  };
}
