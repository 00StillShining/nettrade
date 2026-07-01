// Performance-Truth engine — pure maths. See types.ts for the model and
// docs/REBUILD_BRIEF.md for why this split (deposits/withdrawals vs
// realised vs unrealised P/L) is the app's core thesis. Every function
// here is PURE: no I/O, no Date.now(), no Math.random() — callers pass
// `asOfISO` explicitly wherever "now" matters.

import Decimal from "decimal.js";
import type { Position } from "../adapters/trading212";
import type { CashEvent, HoldingRef, PerformanceTruth, Trade } from "./types";

/** Sums cashEvents of a given kind. Pure reduce — no mutation of the input. */
function sumByKind(cashEvents: CashEvent[], kind: CashEvent["kind"]): number {
  let total = 0;
  for (const e of cashEvents) {
    if (e.kind === kind) total += e.amountMinor;
  }
  return total;
}

/** Per-ticker running average-cost state during the realised-P/L replay. */
interface RunningCost {
  qty: number;
  totalCostMinor: number; // running cost basis in the trade's own instrument-currency minor units
}

export interface RealisedResult {
  realisedPlMinor: number;
  perTicker: Record<string, { realisedMinor: number; closedQty: number }>;
}

/**
 * computeRealised — AVERAGE-COST replay of a trade list.
 *
 * WHAT IT COMPUTES: realised profit/loss, i.e. the P/L that is LOCKED IN
 * because shares were actually sold — as opposed to unrealised P/L, which
 * is a live mark-to-market of shares still held. This is the "did I
 * actually bank a gain/loss" half of the Performance-Truth split.
 *
 * METHOD: process trades in chronological order (defensively re-sorted by
 * dateISO — callers should not need to pre-sort, and an out-of-order input
 * must not silently corrupt the replay). Track, per ticker, a running
 * quantity and running total cost:
 *   - BUY: qty += trade.quantity; totalCost += trade.quantity * priceMinor
 *     + feeMinor (fees on the way in are folded into cost basis — a
 *     higher cost basis means a smaller realised gain later, which is the
 *     honest treatment: the fee genuinely cost you basis).
 *   - SELL: avgCostPerShare = totalCost / qty (Decimal, ratio only — never
 *     stored as Money). realised += (sellPrice - avgCostPerShare) *
 *     sellQty - sellFeeMinor (the fee on the way out reduces what you
 *     actually banked). Then qty -= sellQty and totalCost is reduced
 *     PROPORTIONALLY (totalCost *= remainingQty / qtyBeforeSell) so the
 *     average cost of the remaining shares is unchanged — this is the
 *     standard average-cost-basis rule.
 *
 * GUARDS:
 *   - A sell that exceeds the currently-held qty is CLAMPED to the held
 *     qty (you cannot realise P/L on shares you never bought in this
 *     replay — e.g. a trade history that starts mid-position). The
 *     clamped-away portion is silently ignored for THIS replay; a future
 *     adapter that backfills full history should make this a non-issue.
 *   - A sell against zero held qty is a no-op (realises nothing).
 *   - Empty trade list returns all-zero result.
 *
 * CURRENCY CAVEAT: this is computed in each trade's own instrument-currency
 * `priceMinor` terms (see Trade's doc comment in types.ts) — a documented
 * v1 limitation, not a bug, for tickers whose trades span multiple
 * instrument currencies. Note `feeMinor` is account-currency yet is folded
 * directly into the instrument-currency basis/proceeds without conversion,
 * so for a cross-currency trade the realised figure mixes units; it is exact
 * only when instrument currency === account currency (the same v1 limit).
 */
export function computeRealised(trades: Trade[]): RealisedResult {
  // Prototype-free maps: keying a plain object by an arbitrary ticker string
  // risks colliding with an inherited member (e.g. "constructor" is truthy),
  // which would corrupt the replay. Object.create(null) has no prototype.
  const perTicker: Record<string, { realisedMinor: number; closedQty: number }> = Object.create(null);
  if (trades.length === 0) {
    return { realisedPlMinor: 0, perTicker };
  }

  // Defensive chronological sort (codepoint — ISO strings, no locale collation);
  // do not mutate the caller's array.
  const ordered = [...trades].sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));

  const running: Record<string, RunningCost> = Object.create(null);
  let realisedTotal = 0;

  for (const t of ordered) {
    const state = running[t.ticker] ?? { qty: 0, totalCostMinor: 0 };
    if (!perTicker[t.ticker]) perTicker[t.ticker] = { realisedMinor: 0, closedQty: 0 };

    if (t.side === "buy") {
      const cost = new Decimal(t.quantity).times(t.priceMinor).plus(t.feeMinor);
      state.totalCostMinor = new Decimal(state.totalCostMinor).plus(cost).toNumber();
      state.qty += t.quantity;
      running[t.ticker] = state;
      continue;
    }

    // side === "sell"
    if (state.qty <= 0) {
      // Nothing held for this ticker in the replay — cannot realise
      // anything against phantom shares. No-op, not an error: a partial
      // trade history legitimately starts mid-position sometimes.
      running[t.ticker] = state;
      continue;
    }

    // Guard: clamp a sell that exceeds held qty rather than going negative.
    const sellQty = Math.min(t.quantity, state.qty);
    const avgCostPerShare = new Decimal(state.totalCostMinor).dividedBy(state.qty); // ratio only, never stored as Money
    const proceeds = new Decimal(sellQty).times(t.priceMinor);
    const costOfSold = avgCostPerShare.times(sellQty);
    const realised = proceeds.minus(costOfSold).minus(t.feeMinor).toNumber();

    realisedTotal += realised;
    perTicker[t.ticker].realisedMinor += realised;
    perTicker[t.ticker].closedQty += sellQty;

    const remainingQty = state.qty - sellQty;
    // Reduce cost basis proportionally so the average cost of the shares
    // that remain is unchanged (standard average-cost-basis rule).
    state.totalCostMinor =
      remainingQty > 0 ? avgCostPerShare.times(remainingQty).toNumber() : 0;
    state.qty = remainingQty;
    running[t.ticker] = state;
  }

  // Round each per-ticker figure to integer minor units at return time too
  // (Money convention — see types.ts). Because each ticker is rounded
  // independently, the per-ticker values can sum to within ±1 minor unit
  // of the separately-rounded realisedPlMinor total; that discrepancy is
  // an accepted, honest artifact of rounding parts vs. the whole.
  for (const key of Object.keys(perTicker)) {
    perTicker[key].realisedMinor = Math.round(perTicker[key].realisedMinor);
  }

  return { realisedPlMinor: Math.round(realisedTotal), perTicker };
}

/**
 * bestWorstHolding — the best/worst CURRENT holding by unrealized P/L,
 * read straight from live `positions` (already the honest current mark
 * computed upstream by the trading212 adapter). Null-safe: an empty
 * positions array returns { best: null, worst: null } rather than
 * throwing or fabricating a placeholder holding.
 */
export function bestWorstHolding(positions: Position[]): { best: HoldingRef | null; worst: HoldingRef | null } {
  if (positions.length === 0) return { best: null, worst: null };

  let best = positions[0];
  let worst = positions[0];
  for (const p of positions) {
    if (p.unrealizedPlMinor > best.unrealizedPlMinor) best = p;
    if (p.unrealizedPlMinor < worst.unrealizedPlMinor) worst = p;
  }

  const toRef = (p: Position): HoldingRef => ({
    ticker: p.ticker,
    name: p.name,
    unrealizedPlMinor: p.unrealizedPlMinor,
  });

  return { best: toRef(best), worst: toRef(worst) };
}

/**
 * computeTruth — the headline Performance-Truth figure. This is the
 * function the whole app's thesis rests on: it separates "money you put
 * in" from "money you actually made" so a rising balance that's really
 * just fresh deposits can't masquerade as a gain.
 *
 * asOfISO is accepted for interface symmetry with the series functions
 * and for future point-in-time recomputation, but computeTruth itself
 * only consumes the full cashEvents/trades/positions snapshots passed in
 * — it does not filter by date (positions/live P/L are inherently "now").
 *
 * RECONCILIATION CAVEAT (read before trusting totalGain against a raw
 * balance check): the honest, component-summed figure is
 *   totalGain = realisedPl + unrealisedPl + dividends - fees + interest
 * This SHOULD also equal `currentValue - netContributions` whenever the
 * account holds no uninvested cash sitting idle (i.e. every deposited
 * pound is either invested or has been paid back out as a fee/withdrawal
 * accounted for above). In practice a real account often DOES hold some
 * un-invested cash balance, and cash movements can be recorded with
 * timing/rounding differences from when positions were marked — so the
 * two figures can legitimately differ by that idle-cash/timing amount.
 * This function always prefers the COMPONENT-SUM as the honest figure,
 * because it is built entirely from named, auditable pieces rather than
 * a single balance subtraction that could silently hide an error.
 */
export function computeTruth(
  cashEvents: CashEvent[],
  trades: Trade[],
  positions: Position[],
  asOfISO: string,
  currency: string,
): PerformanceTruth {
  void asOfISO; // reserved for future point-in-time filtering; see doc comment above

  const depositsMinor = sumByKind(cashEvents, "deposit");
  const withdrawalsMinor = sumByKind(cashEvents, "withdrawal");
  const dividendsMinor = sumByKind(cashEvents, "dividend");
  const feesMinor = sumByKind(cashEvents, "fee");
  const interestMinor = sumByKind(cashEvents, "interest");

  const netContributionsMinor = depositsMinor - withdrawalsMinor;

  const { realisedPlMinor } = computeRealised(trades);

  let unrealisedPlMinor = 0;
  let currentValueMinor = 0;
  for (const p of positions) {
    unrealisedPlMinor += p.unrealizedPlMinor;
    currentValueMinor += p.currentValueMinor;
  }

  // The honest "what you actually made" — see the reconciliation caveat
  // in this function's doc comment for why component-sum is preferred
  // over currentValue - netContributions.
  const totalGainMinor =
    realisedPlMinor + unrealisedPlMinor + dividendsMinor - feesMinor + interestMinor;

  // Guard: an undefined ratio when the user has contributed nothing net
  // (or withdrawn more than deposited) — never divide by zero or treat a
  // negative denominator as a meaningful percentage base.
  const totalReturnPct =
    netContributionsMinor > 0
      ? new Decimal(totalGainMinor).dividedBy(netContributionsMinor).toNumber()
      : null;

  const { best, worst } = bestWorstHolding(positions);

  return {
    currency,
    depositsMinor,
    withdrawalsMinor,
    netContributionsMinor,
    realisedPlMinor,
    unrealisedPlMinor,
    dividendsMinor,
    feesMinor,
    interestMinor,
    currentValueMinor,
    totalGainMinor,
    totalReturnPct,
    best,
    worst,
  };
}
