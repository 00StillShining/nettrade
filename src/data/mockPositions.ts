// Placeholder positions for DESIGN ITERATION only (VITE_MOCK builds). Lets us
// build/run the real .app and tune the layout without touching the Keychain or
// the Trading 212 API (no password prompts). NOT bundled into production builds
// — screens only mount the mock container when import.meta.env.VITE_MOCK is
// set. Values are plausible but INVENTED — never presented as real anywhere.
//
// Shared across data screens (Dashboard + Positions) — the single source of
// truth for placeholder Position[] data so no screen duplicates it.

import type { Position } from "../adapters/trading212";

// [ ticker, name, qty, avgPriceUSD, currentPriceUSD, valueGBP, unrealisedGBP,
//   fxGbp? ] — fxGbp is OPTIONAL (GBP major units), maps to fxImpactMinor
// (defaults to 0 when absent). Where present it's a plausible slice of that
// seed's unrealisedGBP, both signs represented, so the P/L-anatomy panel and
// the price-pure gauge on PositionDetailModal have real divergent cases to
// render honestly — including one seed where price is up but FX drag flips
// the account-ccy total negative (FB/Meta below), which is exactly the case the
// price-pure gauge fix (SCREEN_PATTERNS honest-data law) exists to show
// correctly instead of colouring the gauge by the blended P/L sign.
type Seed = [string, string, number, number, number, number, number, number?];

const SEEDS: Seed[] = [
  ["NVDA_US_EQ", "Nvidia", 0.3023, 199.73, 194.25, 44.29, -1.35],
  ["AAPL_US_EQ", "Apple", 0.1518, 285.57, 291.95, 33.44, 0.67, -0.2],
  ["TSM_US_EQ", "Taiwan Semiconductor Mfg", 0.0947, 457.55, 458.75, 32.77, 0.02],
  ["QNT_US_EQ", "Quantinuum", 0.5527, 71.69, 75.83, 31.61, 1.66, 0.35],
  ["DMYI_US_EQ", "IonQ", 0.7668, 51.61, 52.6, 30.43, 0.48],
  ["MSFT_US_EQ", "Microsoft", 0.1025, 370.76, 378.04, 29.22, 0.5, -0.12],
  ["GOOGL_US_EQ", "Alphabet (Class A)", 0.0976, 351.71, 360.9, 26.56, 0.62],
  ["AMZN_US_EQ", "Amazon", 0.1356, 240.49, 238.62, 24.41, -0.25, -0.1],
  ["ASML_US_EQ", "ASML Holding", 0.0168, 1935.87, 1891.55, 24.01, -0.62],
  // Price is UP (current > avg) but FX drag is negative and large enough to
  // flip the blended total negative — the case that exercises gauge-vs-hero
  // divergence: the gauge should read a green "price up" marker even though
  // the hero's Unrealised P/L reads red.
  ["FB_US_EQ", "Meta Platforms", 0.0488, 556.83, 609.99, 22.43, -1.35, -3.25],
  ["IBM_US_EQ", "IBM", 0.1027, 273.21, 282.96, 21.93, 0.72, 0.15],
  ["AMD_US_EQ", "Advanced Micro Devices", 0.0467, 553.82, 551.0, 19.43, -0.15],
  ["MU_US_EQ", "Micron Technology", 0.0228, 1135.89, 1075.81, 18.5, -1.08, -0.22],
  ["GEV_US_EQ", "GE Vernova", 0.0214, 1108.66, 1122.17, 18.14, 0.17],
  ["TSLA_US_EQ", "Tesla", 0.045, 410.0, 425.5, 15.1, 0.55, 0.08],
  ["PLTR_US_EQ", "Palantir", 0.18, 82.5, 88.2, 12.6, 0.82],
  ["AVGO_US_EQ", "Broadcom", 0.006, 1650.0, 1701.0, 8.1, 0.24],
  ["ORCL_US_EQ", "Oracle", 0.04, 195.0, 189.4, 6.05, -0.18],
  ["NFLX_US_EQ", "Netflix", 0.006, 920.0, 935.0, 4.45, 0.07],
  ["ARM_US_EQ", "Arm Holdings", 0.03, 148.0, 139.5, 3.3, -0.2],
  ["CRM_US_EQ", "Salesforce", 0.012, 330.0, 341.0, 3.25, 0.1],
  ["INTC_US_EQ", "Intel", 0.09, 42.0, 39.8, 2.85, -0.16],
  ["SMCI_US_EQ", "Super Micro Computer", 0.02, 58.0, 61.5, 0.98, 0.06],
  ["SUN_US_EQ", "Sunrun", 0.08, 18.0, 15.2, 0.96, -0.4],
];

function toPosition([ticker, name, qty, avgUsd, curUsd, valGbp, plGbp, fxGbp]: Seed): Position {
  const round = (n: number) => Math.round(n * 100);
  return {
    ticker,
    isin: null,
    name,
    instrumentCurrency: "USD",
    quantity: qty,
    avgPriceMinor: round(avgUsd),
    currentPriceMinor: round(curUsd),
    accountCurrency: "GBP",
    currentValueMinor: round(valGbp),
    unrealizedPlMinor: round(plGbp),
    fxImpactMinor: round(fxGbp ?? 0),
    totalCostMinor: round(valGbp - plGbp),
    raw: null,
  };
}

export const MOCK_POSITIONS: Position[] = SEEDS.map(toPosition);
