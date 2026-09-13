// Performance-Truth engine — pure maths. See types.ts for the model and
// docs/REBUILD_BRIEF.md for why this split (deposits/withdrawals vs
// realised vs unrealised P/L) is the app's core thesis. Every function
// here is PURE: no I/O, no Date.now(), no Math.random() — callers pass
// `asOfISO` explicitly wherever "now" matters.

import Decimal from "decimal.js";
import type { Position } from "../adapters/trading212";
import type { CashEvent, HoldingRef, PerformanceTruth, RealisedBasis, Trade } from "./types";

export type { RealisedBasis };

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
  /** Running cost basis. In the SETTLED basis this is exact account-currency
   * minor units; in the INSTRUMENT (fallback) basis it is the trade's own
   * instrument-currency minor units (the documented v1 approximation). */
  totalCostMinor: number;
}

export interface RealisedResult {
  realisedPlMinor: number;
  perTicker: Record<string, { realisedMinor: number; closedQty: number }>;
  /** The account-level basis of realisedPlMinor — see RealisedBasis. */
  realisedBasis: RealisedBasis;
}

/** One SELL's realised contribution, dated, as produced mid-replay by
 * `replayRealisedEvents`. `realisedMinor` here is the RAW (unrounded)
 * per-sell delta — callers accumulate/round at their own boundary (see
 * computeRealised's whole-total rounding vs. a windowed caller that only
 * wants to accumulate a subset of these events). */
export interface RealisedSellEvent {
  dateISO: string;
  ticker: string;
  sellQty: number;
  realisedMinor: number;
}

/**
 * A fill carries a usable settled value when settledValueMinor is present and
 * strictly positive (the adapter stores it as an ABSOLUTE account-currency
 * magnitude — see fillToTrade/normalizeOrderFill in the T212 adapter — so a
 * 0/undefined value is "no settled value supplied", never a real zero fill).
 */
function hasSettled(t: Trade): boolean {
  return typeof t.settledValueMinor === "number" && t.settledValueMinor > 0;
}

/**
 * settledBasisTickers — the set of tickers whose EVERY executed fill (buy AND
 * sell) carries a positive settledValueMinor. Only these tickers may use the
 * exact account-currency settled-value basis; a ticker with ANY missing
 * settled value falls back WHOLLY to the instrument-currency replay, because
 * mixing a settled proceed against an instrument-ccy cost basis (or vice
 * versa) within one ticker would fabricate a figure in neither currency.
 *
 * Pure, prototype-free map. Exported for computeRealised's account-level
 * basis label and for tests; callers should not otherwise depend on it.
 */
export function settledBasisTickers(trades: Trade[]): Set<string> {
  const anyMissing: Record<string, boolean> = Object.create(null);
  const seen: Record<string, boolean> = Object.create(null);
  for (const t of trades) {
    seen[t.ticker] = true;
    if (!hasSettled(t)) anyMissing[t.ticker] = true;
  }
  const result = new Set<string>();
  for (const ticker of Object.keys(seen)) {
    if (!anyMissing[ticker]) result.add(ticker);
  }
  return result;
}

/**
 * replayRealisedEvents — the SINGLE SOURCE OF TRUTH for the average-cost
 * replay's core loop. Walks `trades` in chronological order (defensively
 * re-sorted; input array never mutated) and yields one `RealisedSellEvent`
 * per SELL (including no-op/clamped sells, so a caller can see every dated
 * event even when it realises 0). BUYS silently update the running
 * per-ticker cost basis and produce no event.
 *
 * COST BASIS — PER TICKER (item 1, docs/IMPROVEMENTS.md): before the walk it
 * decides, per ticker, whether to use the EXACT account-currency SETTLED
 * basis (chosen when every one of that ticker's executed fills carries a
 * positive settledValueMinor — the broker's own walletImpact cash value) or
 * to fall back WHOLLY to the v1 INSTRUMENT-currency priceMinor basis. A
 * ticker never mixes the two bases (that would fabricate a figure in neither
 * currency). The two branches are IDENTICAL average-cost/clamping/fee maths;
 * they differ only in the "line value" of a fill:
 *   - INSTRUMENT: line value = quantity * priceMinor (per-share instrument ccy).
 *   - SETTLED:    line value = settledValueMinor (whole-fill account ccy). A
 *                 clamped sell scales its settled proceeds by sellQty/quantity
 *                 so a partial close banks a proportional part of the cash.
 * FEES differ per basis — VERIFIED against a real captured T212 fill
 * (2026-07-05: qty 0.0734382 × $445.42 = $32.71 ÷ fxRate 1.33732 = £24.46
 * market value, walletImpact.netValue = £24.50 = 24.46 + the £0.04
 * CURRENCY_CONVERSION_FEE): the broker's settled netValue is the ALL-IN cash
 * impact, fee INCLUDED. So:
 *   - INSTRUMENT: feeMinor (account ccy) folds in exactly as v1 — added to
 *     cost on a buy, subtracted from proceeds on a sell.
 *   - SETTLED:    settledValueMinor IS the complete cash movement; folding
 *     feeMinor in AGAIN would double-count every fill's fee (~4p × 440 fills
 *     on the reference account). No separate fee adjustment.
 *
 * This function holds the ONLY copy of the average-cost/clamping/fee rules
 * (see computeRealised's doc comment for the full rule explanation) so that
 * computeRealised, realisedSeries (series.ts), and computePeriodComponents
 * (period.ts) can never drift out of sync with each other — they all
 * replay through this one loop and differ only in how they aggregate the
 * resulting events (sum everything vs. stamp cumulative points vs. sum only
 * sells inside a date window).
 */
export function replayRealisedEvents(trades: Trade[]): RealisedSellEvent[] {
  if (trades.length === 0) return [];

  // Defensive chronological sort (codepoint — ISO strings, no locale collation);
  // do not mutate the caller's array.
  const ordered = [...trades].sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));

  // Decide the per-ticker basis ONCE, up front, from the whole trade set — a
  // late fill with no settled value must demote the WHOLE ticker to
  // instrument basis, including earlier fills that did carry one.
  const settledTickers = settledBasisTickers(ordered);

  const running: Record<string, RunningCost> = Object.create(null);
  const events: RealisedSellEvent[] = [];

  for (const t of ordered) {
    const state = running[t.ticker] ?? { qty: 0, totalCostMinor: 0 };
    const useSettled = settledTickers.has(t.ticker);

    if (t.side === "buy") {
      // Line value: exact account-ccy settled magnitude (fee ALREADY inside —
      // see the netValue proof in the doc comment; adding feeMinor again would
      // double-count), or the instrument-ccy quantity*price fallback where the
      // account-ccy fee folds into cost separately.
      const cost = useSettled
        ? new Decimal(t.settledValueMinor as number)
        : new Decimal(t.quantity).times(t.priceMinor).plus(t.feeMinor);
      state.totalCostMinor = new Decimal(state.totalCostMinor).plus(cost).toNumber();
      state.qty += t.quantity;
      running[t.ticker] = state;
      continue;
    }

    // side === "sell"
    if (state.qty <= 0) {
      // Nothing held for this ticker in the replay — cannot realise
      // anything against phantom shares. No-op, not an error: a partial
      // trade history legitimately starts mid-position sometimes. Still a
      // real dated event (0 realised, 0 closedQty) — callers that stamp a
      // point per sell (e.g. realisedSeries) rely on seeing it.
      running[t.ticker] = state;
      events.push({ dateISO: t.dateISO, ticker: t.ticker, sellQty: 0, realisedMinor: 0 });
      continue;
    }

    // Guard: clamp a sell that exceeds held qty rather than going negative.
    const sellQty = Math.min(t.quantity, state.qty);
    const avgCostPerShare = new Decimal(state.totalCostMinor).dividedBy(state.qty); // ratio only, never stored as Money
    // Proceeds line value: settled magnitude for the WHOLE fill, scaled to the
    // (possibly clamped) sold fraction; or the instrument-ccy sellQty*price.
    // t.quantity > 0 is guaranteed for executed fills (isExecutedFill), but
    // guard defensively so a malformed 0-qty settled sell can't divide by zero.
    // Settled proceeds are already NET of the fee (netValue = all-in cash
    // movement — see the doc-comment proof); subtracting feeMinor again would
    // double-count. The instrument branch keeps the v1 explicit fee subtraction.
    const proceeds = useSettled
      ? new Decimal(t.settledValueMinor as number).times(
          t.quantity > 0 ? new Decimal(sellQty).dividedBy(t.quantity) : 0,
        )
      : new Decimal(sellQty).times(t.priceMinor).minus(t.feeMinor);
    const costOfSold = avgCostPerShare.times(sellQty);
    const realised = proceeds.minus(costOfSold).toNumber();

    events.push({ dateISO: t.dateISO, ticker: t.ticker, sellQty, realisedMinor: realised });

    const remainingQty = state.qty - sellQty;
    // Reduce cost basis proportionally so the average cost of the shares
    // that remain is unchanged (standard average-cost-basis rule).
    state.totalCostMinor = remainingQty > 0 ? avgCostPerShare.times(remainingQty).toNumber() : 0;
    state.qty = remainingQty;
    running[t.ticker] = state;
  }

  return events;
}

/**
 * accountRealisedBasis — the account-level RealisedBasis label for a trade
 * set, defined at the FILL level per the contract: "settled" when EVERY
 * executed fill carried a positive settledValueMinor (so every ticker used the
 * exact account-ccy basis), "instrument" when NONE did (every ticker fell
 * back), "mixed" otherwise.
 *
 * Note the cautious edge: a SINGLE ticker whose fills are inconsistent (some
 * carry a settled value, some don't) is demoted WHOLLY to instrument basis in
 * the replay, yet this label reports "mixed" — because at least one fill did
 * and at least one didn't carry a settled value. That is deliberate: "mixed"
 * is a caution flag about the DATA's consistency, and flagging it is the
 * honest, conservative choice even when the arithmetic happened to fall back
 * uniformly. Pure; empty input is "settled" by vacuous truth (no fill lacked a
 * settled value) — a caller with no realised P/L to label can ignore it. Kept
 * adjacent to the replay so the label can never drift from the branch the
 * replay actually took.
 */
export function accountRealisedBasis(trades: Trade[]): RealisedBasis {
  if (trades.length === 0) return "settled";
  let sawSettled = false;
  let sawInstrument = false;
  for (const t of trades) {
    if (hasSettled(t)) sawSettled = true;
    else sawInstrument = true;
  }
  if (sawSettled && sawInstrument) return "mixed";
  return sawSettled ? "settled" : "instrument";
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
 *   - Empty trade list returns all-zero result (basis "settled" by vacuous
 *     truth — no fill lacked a settled value; nothing to caveat).
 *
 * COST BASIS (item 1): PER TICKER, prefers the EXACT account-currency SETTLED
 * basis (from each fill's settledValueMinor) when every one of that ticker's
 * fills carries one, else falls back WHOLLY to the INSTRUMENT-currency
 * priceMinor replay described above — see replayRealisedEvents for the branch
 * detail. `realisedBasis` on the result reports which basis the account-level
 * total drew on ("settled" / "instrument" / "mixed" — see RealisedBasis).
 *
 * CURRENCY CAVEAT (applies to the INSTRUMENT-basis fallback only): that branch
 * is computed in each trade's own instrument-currency `priceMinor` terms (see
 * Trade's doc comment in types.ts) — a documented v1 limitation, not a bug,
 * for tickers whose trades span multiple instrument currencies. Note
 * `feeMinor` is account-currency yet is folded directly into the
 * instrument-currency basis/proceeds without conversion, so for a
 * cross-currency trade the realised figure mixes units; it is exact only when
 * instrument currency === account currency (the same v1 limit). The SETTLED
 * basis has no such caveat — it is already exact account-currency.
 */
export function computeRealised(trades: Trade[]): RealisedResult {
  // Prototype-free maps: keying a plain object by an arbitrary ticker string
  // risks colliding with an inherited member (e.g. "constructor" is truthy),
  // which would corrupt the replay. Object.create(null) has no prototype.
  const perTicker: Record<string, { realisedMinor: number; closedQty: number }> = Object.create(null);
  if (trades.length === 0) {
    return { realisedPlMinor: 0, perTicker, realisedBasis: "settled" };
  }

  // Pre-seed a zero entry for EVERY trade's ticker (including buy-only
  // tickers that produce no sell event) so perTicker's public surface is
  // unchanged from the pre-refactor loop, which created an entry per trade's
  // ticker: a buy-only ticker still appears as { realisedMinor: 0,
  // closedQty: 0 } rather than being absent.
  for (const t of trades) {
    if (!perTicker[t.ticker]) perTicker[t.ticker] = { realisedMinor: 0, closedQty: 0 };
  }

  const events = replayRealisedEvents(trades);
  let realisedTotal = 0;

  for (const e of events) {
    if (!perTicker[e.ticker]) perTicker[e.ticker] = { realisedMinor: 0, closedQty: 0 };
    realisedTotal += e.realisedMinor;
    perTicker[e.ticker].realisedMinor += e.realisedMinor;
    perTicker[e.ticker].closedQty += e.sellQty;
  }

  // Round each per-ticker figure to integer minor units at return time too
  // (Money convention — see types.ts). Because each ticker is rounded
  // independently, the per-ticker values can sum to within ±1 minor unit
  // of the separately-rounded realisedPlMinor total; that discrepancy is
  // an accepted, honest artifact of rounding parts vs. the whole.
  for (const key of Object.keys(perTicker)) {
    perTicker[key].realisedMinor = Math.round(perTicker[key].realisedMinor);
  }

  return { realisedPlMinor: Math.round(realisedTotal), perTicker, realisedBasis: accountRealisedBasis(trades) };
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

  const { realisedPlMinor, realisedBasis } = computeRealised(trades);

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
    realisedBasis,
    best,
    worst,
  };
}
