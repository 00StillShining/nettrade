// Placeholder watchlist quotes for DESIGN ITERATION only (VITE_MOCK builds). Lets
// us build/run the real .app and tune the layout without wiring a real
// delayed/EOD market-data feed (Twelve Data / Alpha Vantage free tiers — that
// integration lands with the Watchlist's live container). Values are plausible
// but INVENTED — never presented as real anywhere.
//
// Shape is deliberately honest to what a FREE delayed/EOD quote endpoint
// actually returns: last price, previous close, day high/low, an as-of
// timestamp and a freshness label. NO bid/ask spread (free tiers don't have
// it), NO intraday time-series — those are exactly the fields Watchlist must
// not fabricate (SCREEN_PATTERNS.md §4 honest-data law).
//
// GBP/LSE quotes arrive in GBX (pence) from most feeds — convert to POUNDS-minor
// (pence value == minor value) before storing.

export type Freshness = "D15" | "EOD";

export interface WatchItem {
  ticker: string;
  name: string;
  /** Listing venue, e.g. "NASDAQ" | "NYSE" | "LSE". */
  market: string;
  /** Instrument's native quote currency, e.g. "USD" | "GBP". */
  currency: string;
  priceMinor: number;
  prevCloseMinor: number;
  dayHighMinor: number;
  dayLowMinor: number;
  /** ISO timestamp the quote was last refreshed as-of (delayed/EOD feed). */
  asOfISO: string;
  /** "D15" = 15-minute delayed intraday quote; "EOD" = end-of-day only. */
  freshness: Freshness;
  /** The user's own note — personal voice, never a market claim. */
  note: string;
}

// dayChangeMinor / dayChangePct are DERIVED (price - prevClose) at the use
// site, never stored here — SCREEN_PATTERNS.md "don't store derivables".
export const MOCK_WATCHLIST: WatchItem[] = [
  {
    ticker: "SHOP",
    name: "Shopify",
    market: "NYSE",
    currency: "USD",
    priceMinor: 14820,
    prevCloseMinor: 15005,
    dayHighMinor: 15040,
    dayLowMinor: 14760,
    asOfISO: "2026-07-01T14:35:00Z",
    freshness: "D15",
    note: "waiting for a dip under 130 before adding",
  },
  {
    ticker: "RR",
    name: "Rolls-Royce Holdings",
    market: "LSE",
    currency: "GBP",
    priceMinor: 1083,
    prevCloseMinor: 1054,
    dayHighMinor: 1090,
    dayLowMinor: 1054,
    asOfISO: "2026-06-30T16:35:00Z",
    freshness: "EOD",
    note: "runner since the defence spending story broke — still holding off",
  },
  {
    ticker: "ASTS",
    name: "AST SpaceMobile",
    market: "NASDAQ",
    currency: "USD",
    priceMinor: 4215,
    prevCloseMinor: 4590,
    dayHighMinor: 4610,
    dayLowMinor: 4180,
    asOfISO: "2026-07-01T14:35:00Z",
    freshness: "D15",
    note: "speculative — small position only if it settles down",
  },
  {
    ticker: "ULVR",
    name: "Unilever",
    market: "LSE",
    currency: "GBP",
    priceMinor: 4526,
    prevCloseMinor: 4526,
    dayHighMinor: 4541,
    dayLowMinor: 4508,
    asOfISO: "2026-06-30T16:35:00Z",
    freshness: "EOD",
    note: "steady compounder, just tracking for now",
  },
  {
    ticker: "COIN",
    name: "Coinbase Global",
    market: "NASDAQ",
    currency: "USD",
    priceMinor: 26340,
    prevCloseMinor: 25110,
    dayHighMinor: 26890,
    dayLowMinor: 25050,
    asOfISO: "2026-07-01T14:35:00Z",
    freshness: "D15",
    note: "proxy for crypto sentiment — watching for a pullback",
  },
  {
    ticker: "NVO",
    name: "Novo Nordisk",
    market: "NYSE",
    currency: "USD",
    priceMinor: 8420,
    prevCloseMinor: 8695,
    dayHighMinor: 8710,
    dayLowMinor: 8390,
    asOfISO: "2026-07-01T14:35:00Z",
    freshness: "D15",
    note: "GLP-1 pullback looks overdone, still building conviction",
  },
  {
    ticker: "BATS",
    name: "British American Tobacco",
    market: "LSE",
    currency: "GBP",
    priceMinor: 2894,
    prevCloseMinor: 2859,
    dayHighMinor: 2912,
    dayLowMinor: 2852,
    asOfISO: "2026-06-30T16:35:00Z",
    freshness: "EOD",
    note: "income play — checking the yield holds above 7%",
  },
  {
    ticker: "SOFI",
    name: "SoFi Technologies",
    market: "NASDAQ",
    currency: "USD",
    priceMinor: 1486,
    prevCloseMinor: 1439,
    dayHighMinor: 1502,
    dayLowMinor: 1421,
    asOfISO: "2026-07-01T14:35:00Z",
    freshness: "D15",
    note: "small starter size only, want two more quarters of profit first",
  },
  {
    ticker: "SNOW",
    name: "Snowflake",
    market: "NYSE",
    currency: "USD",
    priceMinor: 17205,
    prevCloseMinor: 17960,
    dayHighMinor: 18010,
    dayLowMinor: 17140,
    asOfISO: "2026-07-01T14:35:00Z",
    freshness: "D15",
    note: "growth slowing, note to self: re-check the next print",
  },
  {
    ticker: "GLEN",
    name: "Glencore",
    market: "LSE",
    currency: "GBP",
    priceMinor: 418,
    prevCloseMinor: 426,
    dayHighMinor: 427,
    dayLowMinor: 417,
    asOfISO: "2026-06-30T16:35:00Z",
    freshness: "EOD",
    note: "commodity cycle bet, sizing kept deliberately small",
  },
];
