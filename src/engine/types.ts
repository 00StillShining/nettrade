// Performance-Truth engine — internal model. This is the app's core thesis:
// separate deposits/withdrawals from realised vs unrealised P/L so the user
// can tell whether they are ACTUALLY making money, not just watching a
// balance move because they topped up. See docs/REBUILD_BRIEF.md §5 and
// CLAUDE.md "Performance-Truth".
//
// DESIGN PRINCIPLE — this module is ADAPTER-AGNOSTIC. It defines a clean
// internal model that a future Trading 212 history adapter maps INTO; it
// must never import or shape itself around T212's raw JSON. The only
// existing coupling is `Position` from ../adapters/trading212, which is
// ALREADY the normalized (minor-units) shape produced by that adapter.
//
// MONEY CONVENTION (mirrors src/adapters/trading212.ts): every `Money` field
// is an INTEGER MINOR UNITS number (e.g. pennies for GBP, cents for USD).
// Never store money as a float. decimal.js is used only for intermediate
// ratio/percentage maths inside engine functions — never to represent a
// money value that gets persisted or returned. Rounding happens only at
// display time (in the screens' formatters), never inside this engine.

/**
 * Money — an INTEGER MINOR UNITS amount (e.g. pennies for GBP, cents for
 * USD). Always a whole number produced by summing/subtracting other minor
 * unit integers; never a float division result stored directly. Ratios and
 * percentages are computed via decimal.js and returned as plain `number`
 * (not `Money`) so callers never mistake a ratio for an amount.
 */
export type Money = number;

/**
 * A cash movement into/out of the account, in ACCOUNT CURRENCY minor units.
 *
 * ASSUMPTION (documented per the task brief): Trading 212 reports cash
 * events (deposits, withdrawals, dividends, fees, interest) in the
 * account's base currency already — i.e. no per-event FX conversion is
 * needed for this union. If a future data source reports these in another
 * currency, that adapter is responsible for converting to account currency
 * BEFORE constructing a CashEvent; this engine never invents an FX rate.
 *
 * `amountMinor` is always stored POSITIVE regardless of direction — the
 * `kind` discriminant carries the sign semantics, and `computeTruth`/the
 * series functions apply the sign explicitly. This keeps "how much did I
 * withdraw" a simple non-negative sum rather than a double-negative trap.
 */
export type CashEvent =
  | { kind: "deposit"; dateISO: string; amountMinor: Money }
  | { kind: "withdrawal"; dateISO: string; amountMinor: Money }
  | { kind: "dividend"; dateISO: string; amountMinor: Money; ticker?: string }
  | { kind: "fee"; dateISO: string; amountMinor: Money; note?: string }
  | { kind: "interest"; dateISO: string; amountMinor: Money };

export type TradeSide = "buy" | "sell";

/**
 * A single buy/sell fill.
 *
 * CURRENCY ASSUMPTION (v1 LIMITATION — documented per the task brief):
 * `priceMinor` is in the TRADE'S OWN instrument-currency minor units (e.g.
 * USD cents for a US stock), exactly like `Position.avgPriceMinor` /
 * `currentPriceMinor` in src/adapters/trading212.ts. `feeMinor` is in
 * ACCOUNT currency minor units (fees are typically charged in account
 * currency by the broker). `settledValueMinor`, when the source provides
 * it, is the actual account-currency cash impact of the trade — and IS now
 * the PREFERRED basis: `computeRealised` uses it (item 1, docs/IMPROVEMENTS.md)
 * to compute EXACT account-currency realised P/L for any ticker whose every
 * fill carries one (see the two-basis note below and RealisedBasis).
 *
 * TWO BASES, PER TICKER (item 1):
 *  - SETTLED (preferred, EXACT account-ccy) — when EVERY one of a ticker's
 *    fills carries a positive `settledValueMinor`, realised P/L for that
 *    ticker is derived from those broker cash values directly, so it is exact
 *    account currency with NO FX assumption. This is the honest ideal.
 *  - INSTRUMENT (the v1 fallback) — for a ticker with ANY missing settled
 *    value, `computeRealised` falls back WHOLLY to the trade's own
 *    `priceMinor` terms via average-cost and exposes that figure as-is. A
 *    ticker never mixes the two bases (that would fabricate a figure in
 *    neither currency). This fallback keeps the ORIGINAL v1 limitation: for a
 *    single-currency account (or when every trade for a ticker shares one
 *    instrument currency) it is exact; for a multi-currency account where a
 *    ticker's trades span more than one instrument currency, or where FX moved
 *    between the buy and the sell, the summed `realisedPlMinor` is a
 *    same-currency-terms approximation NOT reconciled against account
 *    currency. This is a KNOWN, DOCUMENTED limitation — this engine must not
 *    fabricate an FX rate to paper over it. The account-level `realisedBasis`
 *    (on RealisedResult/PerformanceTruth) reports which basis the total drew
 *    on so a screen can label it honestly.
 */
export interface Trade {
  dateISO: string;
  ticker: string;
  side: TradeSide;
  /** Fractional share count — not money. */
  quantity: number;
  /** Per-share price, INSTRUMENT currency minor units. */
  priceMinor: Money;
  /** Trading fee/commission, ACCOUNT currency minor units, stored positive. */
  feeMinor: Money;
  /**
   * Optional: the actual account-currency cash MAGNITUDE of the fill (the
   * broker's walletImpact.netValue, stored positive for both buys and sells —
   * see fillToTrade/normalizeOrderFill in the T212 adapter). When present and
   * > 0 on EVERY fill of a ticker, it is the PREFERRED, exact realised-P/L
   * basis (item 1); a missing/zero value on any fill demotes that whole ticker
   * to the instrument-currency fallback. See this interface's doc comment.
   */
  settledValueMinor?: Money;
}

/**
 * Which cost basis the realised P/L was computed on (item 1,
 * docs/IMPROVEMENTS.md; see the settled-value branch in
 * replayRealisedEvents in truth.ts):
 *   - "settled"    — EVERY executed fill replayed carried a positive
 *                    settledValueMinor, so realised P/L is the EXACT
 *                    account-currency (e.g. GBP) figure derived from the
 *                    broker's own walletImpact cash values. The honest ideal.
 *   - "instrument" — NO fill carried a settled value, so every ticker fell
 *                    back to the v1 average-cost replay in each trade's own
 *                    instrument-currency priceMinor terms (exact only for a
 *                    single-currency account — see Trade's doc comment).
 *   - "mixed"      — some fills carried a settled value and some did not.
 *                    Each ticker still uses ONE basis WHOLLY (bases are never
 *                    mixed within a ticker, which would fabricate a figure),
 *                    but the account total draws on both and/or the data is
 *                    inconsistent, so the label stays cautious.
 */
export type RealisedBasis = "settled" | "instrument" | "mixed";

/**
 * One honestly-RECORDED mark-to-market point. The app persists one of
 * these per sync (see docs/REBUILD_BRIEF.md money section) — this is what
 * makes the value curve honest rather than fabricated: `valueSeries` in
 * series.ts is a strict passthrough of these points, never an
 * interpolation or a fabricated fill between them.
 */
export interface EquitySnapshot {
  atISO: string;
  totalValueMinor: Money;
  netDepositsMinor: Money;
}

/** A reference to a holding used for best/worst-performer call-outs. */
export interface HoldingRef {
  ticker: string;
  name: string | null;
  unrealizedPlMinor: Money;
}

/**
 * The headline Performance-Truth output for a point in time (`asOfISO`).
 * Every *Minor field is exact integer minor units; `totalReturnPct` is the
 * only ratio, guarded against a divide-by-zero when the user has
 * contributed nothing net (see computeTruth doc for the guard rule).
 */
export interface PerformanceTruth {
  /** Account currency the figures are denominated in, e.g. "GBP". */
  currency: string;
  depositsMinor: Money;
  withdrawalsMinor: Money;
  /** deposits - withdrawals. The honest "money you put in, net of what you took out". */
  netContributionsMinor: Money;
  /** Realised P/L from computeRealised. Its currency basis is reported by `realisedBasis`: EXACT account-currency for the settled basis; for the instrument fallback it is in each trade's own instrument-currency minor-unit terms, NOT FX-converted (see Trade's doc comment), exact only for single-currency accounts. totalGainMinor inherits whatever caveat `realisedBasis` implies. */
  realisedPlMinor: Money;
  unrealisedPlMinor: Money;
  dividendsMinor: Money;
  feesMinor: Money;
  interestMinor: Money;
  currentValueMinor: Money;
  /**
   * The honest "what you actually made": realised + unrealised + dividends
   * - fees + interest. See computeTruth's doc comment for the full
   * reconciliation caveat against currentValue - netContributions.
   *
   * CURRENCY CAVEAT: inherits realisedPlMinor's basis (see `realisedBasis`) —
   * EXACT account currency when "settled"; for the "instrument"/"mixed" basis
   * the realised component is NOT FX-converted, exact only for single-currency
   * accounts (see realisedPlMinor and Trade's doc comment).
   */
  totalGainMinor: Money;
  /** totalGain / netContributions, or null when netContributions <= 0 (undefined ratio — never divide by zero or a negative base). */
  totalReturnPct: number | null;
  /**
   * Which basis realisedPlMinor (and hence totalGainMinor's realised
   * component) was computed on — "settled" (exact account-ccy), "instrument"
   * (v1 same-currency approximation), or "mixed". See RealisedBasis. A screen
   * should label the True Gain figure accordingly (e.g. only claim "exact"
   * when this is "settled").
   */
  realisedBasis: RealisedBasis;
  best: HoldingRef | null;
  worst: HoldingRef | null;
}

/** A single (timestamp, value) sample in one of the honest time series. */
export interface TimeSeriesPoint {
  atISO: string;
  valueMinor: Money;
}

/**
 * The three series the future ValueChart/Performance screen will consume
 * (see docs/CHART_CRAFT.md §7/§9's ValueChart data contract: `value[]` +
 * `netDeposits[]` plus a derived `stats` object). `realised` is exposed
 * too so a future screen can plot a realised-P/L sub-line without
 * recomputing the average-cost replay itself.
 */
export interface SeriesBundle {
  netDeposits: TimeSeriesPoint[];
  realised: TimeSeriesPoint[];
  value: TimeSeriesPoint[];
}

export type Period = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";

/**
 * The EXACTLY-computable windowed sums for a period — see
 * `computePeriodComponents` in period.ts for the full method + boundary
 * convention. This is the "component lens": named, auditable pieces summed
 * only from events that actually fall inside the window. It is NOT a full
 * gain figure on its own (see `PeriodTruth`'s doc comment) — most notably it
 * omits any unrealised (mark-to-market) change, which this lens cannot see.
 *
 * CURRENCY CAVEAT: `realisedInWindowMinor` inherits computeRealised's v1
 * instrument-currency limitation (see Trade's doc comment in this file) —
 * exact only for single-currency accounts.
 */
export interface PeriodComponents {
  depositsMinor: Money;
  withdrawalsMinor: Money;
  /** deposits - withdrawals, windowed. */
  netContributionsMinor: Money;
  dividendsMinor: Money;
  feesMinor: Money;
  interestMinor: Money;
  /** Realised P/L for SELLS that fall inside the window, cost basis legitimately
   * carried in from before the window (see computePeriodComponents' doc comment). */
  realisedInWindowMinor: Money;
}

/**
 * PeriodTruth — the period-aware Performance-Truth output. See period.ts's
 * `computePeriodTruth` for the full method.
 *
 * ⚠️ TWO LENSES — NEVER SUM THEM:
 *   1. THE COMPONENT LENS (`components`) — exactly-computable windowed sums
 *      (realised + dividends + fees + interest + net contributions) from
 *      named, dated events that fall inside the window. It CANNOT see
 *      unrealised (mark-to-market) change, because that requires knowing the
 *      value of still-held positions at the window's start, which this lens
 *      does not attempt.
 *   2. THE SNAPSHOT LENS (`snapshotGain`) — "holdings growth": how much your
 *      total holdings value grew, net of what you contributed, since the
 *      last recorded snapshot AT OR BEFORE the window start. This lens DOES
 *      capture unrealised swings (it's a value delta), but it does NOT
 *      separately itemise realised/dividends/fees/interest — a dividend
 *      paid out as cash, for instance, raises the component lens (it's
 *      counted directly) but does NOT raise holdings value (the cash left
 *      the invested pot), so it barely moves the snapshot lens.
 * These measure DIFFERENT, overlapping-but-not-identical things and must
 * NEVER be added together into one number — that would double-count (or
 * miss-count) pieces that appear in one lens but not the other. The screen
 * must present them as distinct, separately labelled readings.
 */
export interface PeriodTruth {
  period: Period;
  /** Window start (see periodStartISO). Null for "ALL" (no window — all-time). */
  startISO: string | null;
  components: PeriodComponents;
  /**
   * The "holdings growth" lens. `gainMinor` = currentValue (from live
   * positions) − anchor.totalValueMinor − `sinceAnchorNetContributionsMinor`.
   * `anchor` is the LATEST EquitySnapshot with atISO <= startISO (never a
   * later snapshot substituted silently, never interpolated). If no such
   * snapshot exists, `anchor`, `gainMinor`, `sinceAnchorNetContributionsMinor`
   * and `returnPct` are all null and `note` explains why in plain language —
   * an honest gap, not a bug to paper over.
   *
   * WHY `sinceAnchorNetContributionsMinor` AND NOT the window's own net
   * contributions: the anchor may PRE-DATE the window start (it is the last
   * recorded snapshot at or before it). A deposit/withdrawal dated between
   * the anchor and the window start is already baked into `currentValueMinor`
   * (a live "now" mark) but NOT into `anchor.totalValueMinor` — so netting
   * only in-window contributions would report that money as holdings growth,
   * the exact masquerade this app exists to prevent. This figure therefore
   * nets contributions from the ANCHOR's own date (exclusive-start,
   * inclusive-end, same convention as every other windowed sum), and is
   * exposed so the screen can reuse it as the return-% denominator base.
   */
  snapshotGain: {
    anchor: EquitySnapshot | null;
    gainMinor: Money | null;
    /**
     * Net contributions (deposits − withdrawals) from the anchor's date up to
     * asOfISO — the exact figure netted out of `gainMinor` (null when no
     * anchor). See the WHY note above for why this spans anchor→now, not just
     * the window.
     */
    sinceAnchorNetContributionsMinor: Money | null;
    /**
     * Snapshot-lens return: `gainMinor` over
     * (anchor.totalValueMinor + sinceAnchorNetContributionsMinor) — "what was
     * actually at risk from the anchor onward: the starting holdings value
     * plus everything added since." Computed via decimal.js (engine ratio
     * convention). Null when there is no anchor OR the denominator is <= 0
     * (an undefined/meaningless ratio — same divide-by-zero discipline as
     * computeTruth's totalReturnPct).
     */
    returnPct: number | null;
    note: string;
  };
}
