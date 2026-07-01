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
 * it, is the actual account-currency cash impact of the trade and should
 * be preferred by any FUTURE cross-currency-aware maths.
 *
 * v1 keeps this SIMPLE and does NOT invent an FX rate: `computeRealised`
 * replays trades and computes realised P/L purely in the trade's own
 * `priceMinor` terms via average-cost, and exposes that figure as-is. For
 * a single-currency account (or when every trade for a ticker shares one
 * instrument currency) this is exact. For a multi-currency account where a
 * ticker's trades span more than one instrument currency, or where FX
 * moved between the buy and the sell, the summed `realisedPlMinor` is a
 * same-currency-terms approximation and is NOT reconciled against account
 * currency. This is a KNOWN, DOCUMENTED v1 limitation — a later task can
 * add a real FX-aware adapter; this engine must not fabricate a rate to
 * paper over it.
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
  /** Optional: actual account-currency cash impact, if the source supplies it. */
  settledValueMinor?: Money;
}

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
  /** Realised P/L from computeRealised — v1: in each trade's own instrument-currency minor-unit terms, NOT FX-converted to account currency (see Trade's doc comment). Exact only for single-currency accounts. totalGainMinor inherits this caveat. */
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
   * CURRENCY CAVEAT: inherits realisedPlMinor's v1 instrument-currency
   * limitation — NOT FX-converted to account currency; exact only for
   * single-currency accounts (see realisedPlMinor and Trade's doc comment).
   */
  totalGainMinor: Money;
  /** totalGain / netContributions, or null when netContributions <= 0 (undefined ratio — never divide by zero or a negative base). */
  totalReturnPct: number | null;
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
