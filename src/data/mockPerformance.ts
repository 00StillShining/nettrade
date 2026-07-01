// Placeholder Performance-Truth history for DESIGN ITERATION only (VITE_MOCK
// builds). Lets us build/run the real .app and tune the Performance screen's
// layout without a live Trading 212 history backfill. Values are plausible
// but INVENTED — never presented as real anywhere. Mirrors the header-comment
// convention of src/data/mockPositions.ts and src/data/mockWatchlist.ts.
//
// THE STORY (deliberately illustrates the Performance-Truth thesis): the
// user has deposited £600 and withdrawn £50 (net contributions £550), so a
// naive "current value minus net contributions" reading is NEGATIVE
// (43481 - 55000 = -£115.19 minor units) — it LOOKS like a loss. But the
// honest, component-summed totalGain (realised + unrealised + dividends -
// fees + interest) is a modest POSITIVE +£23.64 (+4.30%): totalGain = 600
// (realised) + 94 (unrealised) + 1560 (dividends) - 200 (fees) + 310
// (interest) = 2364 minor, because the account also realised a net gain
// from closed trades, collected dividends and interest, and only a small
// custody fee was paid. This gap
// is exactly why the engine prefers the component-sum over the raw
// balance subtraction (see computeTruth's doc comment in engine/truth.ts)
// — a portfolio that currently "looks down" against what was put in can
// still represent genuine, actual gains once contributions, withdrawals,
// realised trades, dividends, fees and interest are told apart honestly.
//
// RECONCILIATION WITH MOCK_POSITIONS: the final EquitySnapshot's
// totalValueMinor (43481) is set to exactly match the sum of
// MOCK_POSITIONS[].currentValueMinor, and computeTruth's unrealisedPl for
// this mock story comes straight from MOCK_POSITIONS[].unrealizedPlMinor
// (+94 minor, i.e. +£0.94) — so calling computeTruth(MOCK_CASH_EVENTS,
// MOCK_TRADES, MOCK_POSITIONS, ..., "GBP") produces a self-consistent
// PerformanceTruth for the whole mock app.
//
// Two positions that were fully bought-and-sold before "now" (SHOP_US_EQ,
// a winner; COIN_US_EQ, a loser) are NOT present in MOCK_POSITIONS — they
// were closed out, which is exactly what a realised-P/L history looks like
// (positions that no longer show up as open holdings).

import type { CashEvent, EquitySnapshot, Trade } from "../engine/types";

/** 15 monthly deposits of £40, one £50 withdrawal after the 9th deposit (Dec 2025). */
export const MOCK_CASH_EVENTS: CashEvent[] = [
  { kind: "deposit", dateISO: "2025-04-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2025-05-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2025-06-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2025-07-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2025-08-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2025-09-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2025-10-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2025-11-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2025-12-15", amountMinor: 4000 },
  { kind: "withdrawal", dateISO: "2025-12-18", amountMinor: 5000 },
  { kind: "deposit", dateISO: "2026-01-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2026-02-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2026-03-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2026-04-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2026-05-15", amountMinor: 4000 },
  { kind: "deposit", dateISO: "2026-06-15", amountMinor: 4000 },

  // Dividends — small, plausible payouts from held US megacaps.
  { kind: "dividend", dateISO: "2025-07-20", amountMinor: 320, ticker: "AAPL_US_EQ" },
  { kind: "dividend", dateISO: "2025-10-20", amountMinor: 410, ticker: "MSFT_US_EQ" },
  { kind: "dividend", dateISO: "2026-01-20", amountMinor: 380, ticker: "AAPL_US_EQ" },
  { kind: "dividend", dateISO: "2026-04-20", amountMinor: 450, ticker: "MSFT_US_EQ" },

  // Account-level custody fees (separate from per-trade fees, which are
  // folded into each Trade's own feeMinor and realised-P/L cost basis).
  { kind: "fee", dateISO: "2025-09-05", amountMinor: 100, note: "custody fee" },
  { kind: "fee", dateISO: "2026-03-05", amountMinor: 100, note: "custody fee" },

  // Interest on uninvested cash sitting between deposits and being invested.
  { kind: "interest", dateISO: "2025-08-28", amountMinor: 60 },
  { kind: "interest", dateISO: "2025-11-28", amountMinor: 75 },
  { kind: "interest", dateISO: "2026-02-28", amountMinor: 90 },
  { kind: "interest", dateISO: "2026-05-28", amountMinor: 85 },
];

/**
 * Two fully closed-out positions: SHOP_US_EQ (winner) and COIN_US_EQ
 * (loser). Both are entirely bought-then-sold before "now", so neither
 * appears in MOCK_POSITIONS — this is exactly what realised P/L looks
 * like: money that was made or lost on a position no longer held.
 *
 * SHOP_US_EQ (winner): buy 0.5 @ $65.00 + £0.50 fee, buy 0.3 @ $70.00 +
 * £0.50 fee — buy fees fold into cost basis (see computeRealised's doc
 * comment in engine/truth.ts), so totalCost = 3250+50+2100+50 = 5450
 * minor over 0.8 shares (avg 6812.5/share). Sell all 0.8 @ $95.00 minus
 * £0.50 fee: realised = 7600 - 5450 - 50 = 2100 minor (instrument-ccy
 * terms, i.e. $21.00 — see Trade's currency caveat in engine/types.ts).
 *
 * COIN_US_EQ (loser): buy 0.2 @ $220.00 + £0.50 fee (cost 4450 minor),
 * sell all 0.2 @ $150.00 minus £0.50 fee: realised = 3000 - 4450 - 50 =
 * -1500 minor (i.e. -$15.00).
 *
 * Net realised across both = 2100 - 1500 = 600 minor (i.e. +$6.00 in the
 * instrument-currency-terms convention this v1 engine uses — NOT £, per the
 * same caveat).
 */
export const MOCK_TRADES: Trade[] = [
  // SHOP_US_EQ — winner, fully closed.
  { dateISO: "2025-06-01", ticker: "SHOP_US_EQ", side: "buy", quantity: 0.5, priceMinor: 6500, feeMinor: 50 },
  { dateISO: "2025-07-01", ticker: "SHOP_US_EQ", side: "buy", quantity: 0.3, priceMinor: 7000, feeMinor: 50 },
  { dateISO: "2025-11-01", ticker: "SHOP_US_EQ", side: "sell", quantity: 0.8, priceMinor: 9500, feeMinor: 50 },

  // COIN_US_EQ — loser, fully closed.
  { dateISO: "2025-08-01", ticker: "COIN_US_EQ", side: "buy", quantity: 0.2, priceMinor: 22000, feeMinor: 50 },
  { dateISO: "2025-12-10", ticker: "COIN_US_EQ", side: "sell", quantity: 0.2, priceMinor: 15000, feeMinor: 50 },
];

/**
 * 15 monthly EquitySnapshots (1st of each month, May 2025 -> Jul 2026)
 * forming a plausible, hand-authored, clearly-mock equity curve: gentle
 * early growth, a real drawdown through autumn/winter 2025 (matching the
 * COIN_US_EQ loser's decline and eventual loss-crystallising sell), a
 * recovery through spring 2026, then a genuine pullback in June 2026 —
 * ending EXACTLY at MOCK_POSITIONS's current total value (43481 minor
 * units) so computeTruth/valueSeries stay reconciled with the rest of the
 * mock data. netDepositsMinor at each point is the running net
 * contribution as of that snapshot date (deposits happen on the 15th, so
 * a 1st-of-month snapshot reflects deposits through the PRIOR month's
 * 15th, and the Dec withdrawal takes effect from the Jan 2026 snapshot).
 */
export const MOCK_SNAPSHOTS: EquitySnapshot[] = [
  { atISO: "2025-05-01", totalValueMinor: 4150, netDepositsMinor: 4000 },
  { atISO: "2025-06-01", totalValueMinor: 8300, netDepositsMinor: 8000 },
  { atISO: "2025-07-01", totalValueMinor: 12600, netDepositsMinor: 12000 },
  { atISO: "2025-08-01", totalValueMinor: 16200, netDepositsMinor: 16000 },
  { atISO: "2025-09-01", totalValueMinor: 19100, netDepositsMinor: 20000 },
  { atISO: "2025-10-01", totalValueMinor: 22400, netDepositsMinor: 24000 },
  { atISO: "2025-11-01", totalValueMinor: 26800, netDepositsMinor: 28000 },
  { atISO: "2025-12-01", totalValueMinor: 29600, netDepositsMinor: 32000 },
  { atISO: "2026-01-01", totalValueMinor: 30800, netDepositsMinor: 31000 },
  { atISO: "2026-02-01", totalValueMinor: 35900, netDepositsMinor: 35000 },
  { atISO: "2026-03-01", totalValueMinor: 40200, netDepositsMinor: 39000 },
  { atISO: "2026-04-01", totalValueMinor: 44700, netDepositsMinor: 43000 },
  { atISO: "2026-05-01", totalValueMinor: 49300, netDepositsMinor: 47000 },
  { atISO: "2026-06-01", totalValueMinor: 46100, netDepositsMinor: 51000 },
  { atISO: "2026-07-01", totalValueMinor: 43481, netDepositsMinor: 55000 },
];
