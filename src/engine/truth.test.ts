// Known-answer unit tests for the Performance-Truth engine's core maths
// (truth.ts). Each case states its hand-computed expected result in a
// comment so the assertion is checkable independently of the code under
// test — this is the correctness backbone for the app's core thesis.

import { describe, expect, it } from "vitest";
import type { CashEvent, Trade } from "./types";
import type { Position } from "../adapters/trading212";
import { bestWorstHolding, computeRealised, computeTruth } from "./truth";

function makePosition(overrides: Partial<Position>): Position {
  return {
    ticker: "TEST",
    isin: null,
    name: "Test Co",
    instrumentCurrency: "USD",
    quantity: 1,
    avgPriceMinor: 1000,
    currentPriceMinor: 1000,
    accountCurrency: "GBP",
    currentValueMinor: 1000,
    unrealizedPlMinor: 0,
    fxImpactMinor: 0,
    totalCostMinor: 1000,
    raw: null,
    ...overrides,
  };
}

describe("computeRealised", () => {
  it("returns all-zero result for an empty trade list", () => {
    const result = computeRealised([]);
    expect(result).toEqual({ realisedPlMinor: 0, perTicker: {} });
  });

  it("average-cost across multiple buys then a partial sell then a full sell", () => {
    // Buy 10 @ 100 (cost 1000) + fee 5  -> totalCost 1005, qty 10
    // Buy 10 @ 200 (cost 2000) + fee 5  -> totalCost 3010, qty 20
    // avgCost = 3010 / 20 = 150.5 per share
    //
    // Partial sell 5 @ 300, fee 2:
    //   proceeds = 1500, costOfSold = 150.5*5 = 752.5
    //   realised = 1500 - 752.5 - 2 = 745.5 -> summed as float, rounded at the end
    //   remaining qty = 15, remaining cost = 150.5*15 = 2257.5
    //
    // Full sell (remaining) 15 @ 120, fee 3:
    //   avgCost still 150.5 (unchanged by proportional reduction)
    //   proceeds = 1800, costOfSold = 150.5*15 = 2257.5
    //   realised = 1800 - 2257.5 - 3 = -460.5
    //
    // total realised = 745.5 + (-460.5) = 285, rounded -> 285
    const trades: Trade[] = [
      { dateISO: "2025-01-01", ticker: "ABC", side: "buy", quantity: 10, priceMinor: 100, feeMinor: 5 },
      { dateISO: "2025-01-02", ticker: "ABC", side: "buy", quantity: 10, priceMinor: 200, feeMinor: 5 },
      { dateISO: "2025-01-03", ticker: "ABC", side: "sell", quantity: 5, priceMinor: 300, feeMinor: 2 },
      { dateISO: "2025-01-04", ticker: "ABC", side: "sell", quantity: 15, priceMinor: 120, feeMinor: 3 },
    ];

    const result = computeRealised(trades);
    expect(result.realisedPlMinor).toBe(285);
    expect(result.perTicker.ABC.closedQty).toBe(20);
    // 745.5 + (-460.5) = 285 exactly (no fractional remainder in this case)
    expect(result.perTicker.ABC.realisedMinor).toBe(285);
  });

  it("a straightforward losing sell", () => {
    // Buy 1 @ 1000 fee 0 -> cost 1000, qty 1
    // Sell 1 @ 700 fee 10 -> proceeds 700, costOfSold 1000, realised = 700 - 1000 - 10 = -310
    const trades: Trade[] = [
      { dateISO: "2025-02-01", ticker: "LOSS", side: "buy", quantity: 1, priceMinor: 1000, feeMinor: 0 },
      { dateISO: "2025-02-15", ticker: "LOSS", side: "sell", quantity: 1, priceMinor: 700, feeMinor: 10 },
    ];
    const result = computeRealised(trades);
    expect(result.realisedPlMinor).toBe(-310);
    expect(result.perTicker.LOSS.realisedMinor).toBe(-310);
  });

  it("clamps a sell that exceeds held quantity rather than going negative", () => {
    // Buy 5 @ 100 fee 0 -> cost 500, qty 5
    // Sell 8 (only 5 held) @ 200 fee 0 -> clamp sellQty to 5
    //   proceeds = 1000, costOfSold = 500, realised = 500
    const trades: Trade[] = [
      { dateISO: "2025-03-01", ticker: "CLAMP", side: "buy", quantity: 5, priceMinor: 100, feeMinor: 0 },
      { dateISO: "2025-03-02", ticker: "CLAMP", side: "sell", quantity: 8, priceMinor: 200, feeMinor: 0 },
    ];
    const result = computeRealised(trades);
    expect(result.realisedPlMinor).toBe(500);
    expect(result.perTicker.CLAMP.closedQty).toBe(5);
  });

  it("a sell against zero held quantity is a no-op", () => {
    const trades: Trade[] = [{ dateISO: "2025-04-01", ticker: "GHOST", side: "sell", quantity: 3, priceMinor: 100, feeMinor: 0 }];
    const result = computeRealised(trades);
    expect(result.realisedPlMinor).toBe(0);
    expect(result.perTicker.GHOST).toEqual({ realisedMinor: 0, closedQty: 0 });
  });

  it("a buy-only ticker still appears in perTicker as a zero entry (never sold)", () => {
    // HELD is bought but never sold — it realises nothing, yet the public
    // perTicker surface must still list it as { realisedMinor: 0, closedQty:
    // 0 } (pre-seeded per trade's ticker), the same behaviour as the loop
    // before the replay refactor.
    const trades: Trade[] = [{ dateISO: "2025-05-01", ticker: "HELD", side: "buy", quantity: 4, priceMinor: 100, feeMinor: 0 }];
    const result = computeRealised(trades);
    expect(result.realisedPlMinor).toBe(0);
    expect(result.perTicker.HELD).toEqual({ realisedMinor: 0, closedQty: 0 });
  });

  it("re-sorts out-of-order trades chronologically before replaying", () => {
    // Same as the losing-sell case but supplied sell-before-buy in the array.
    const trades: Trade[] = [
      { dateISO: "2025-02-15", ticker: "ORDER", side: "sell", quantity: 1, priceMinor: 700, feeMinor: 10 },
      { dateISO: "2025-02-01", ticker: "ORDER", side: "buy", quantity: 1, priceMinor: 1000, feeMinor: 0 },
    ];
    const result = computeRealised(trades);
    expect(result.realisedPlMinor).toBe(-310);
  });

  it("does not mutate the caller's trades array", () => {
    const trades: Trade[] = [
      { dateISO: "2025-02-15", ticker: "ORDER", side: "sell", quantity: 1, priceMinor: 700, feeMinor: 10 },
      { dateISO: "2025-02-01", ticker: "ORDER", side: "buy", quantity: 1, priceMinor: 1000, feeMinor: 0 },
    ];
    const copy = [...trades];
    computeRealised(trades);
    expect(trades).toEqual(copy);
  });
});

describe("bestWorstHolding", () => {
  it("is null-safe on an empty positions array", () => {
    expect(bestWorstHolding([])).toEqual({ best: null, worst: null });
  });

  it("picks the highest and lowest unrealizedPlMinor", () => {
    const positions = [
      makePosition({ ticker: "MID", unrealizedPlMinor: 0 }),
      makePosition({ ticker: "WIN", unrealizedPlMinor: 500, name: "Winner Co" }),
      makePosition({ ticker: "LOSE", unrealizedPlMinor: -300, name: "Loser Co" }),
    ];
    const { best, worst } = bestWorstHolding(positions);
    expect(best).toEqual({ ticker: "WIN", name: "Winner Co", unrealizedPlMinor: 500 });
    expect(worst).toEqual({ ticker: "LOSE", name: "Loser Co", unrealizedPlMinor: -300 });
  });

  it("a single position is both best and worst", () => {
    const positions = [makePosition({ ticker: "ONLY", unrealizedPlMinor: 42 })];
    const { best, worst } = bestWorstHolding(positions);
    expect(best?.ticker).toBe("ONLY");
    expect(worst?.ticker).toBe("ONLY");
  });
});

describe("computeTruth", () => {
  it("sums deposits/withdrawals/dividends/fees/interest by kind and nets contributions", () => {
    const cashEvents: CashEvent[] = [
      { kind: "deposit", dateISO: "2025-01-01", amountMinor: 10000 },
      { kind: "deposit", dateISO: "2025-02-01", amountMinor: 5000 },
      { kind: "withdrawal", dateISO: "2025-03-01", amountMinor: 2000 },
      { kind: "dividend", dateISO: "2025-03-15", amountMinor: 150, ticker: "AAPL" },
      { kind: "fee", dateISO: "2025-03-20", amountMinor: 50 },
      { kind: "interest", dateISO: "2025-03-25", amountMinor: 30 },
    ];
    const result = computeTruth(cashEvents, [], [], "2025-04-01", "GBP");

    expect(result.depositsMinor).toBe(15000);
    expect(result.withdrawalsMinor).toBe(2000);
    expect(result.netContributionsMinor).toBe(13000); // 15000 - 2000
    expect(result.dividendsMinor).toBe(150);
    expect(result.feesMinor).toBe(50);
    expect(result.interestMinor).toBe(30);
  });

  it("totalGain is the honest component sum: realised + unrealised + dividends - fees + interest", () => {
    const cashEvents: CashEvent[] = [
      { kind: "deposit", dateISO: "2025-01-01", amountMinor: 100000 },
      { kind: "dividend", dateISO: "2025-02-01", amountMinor: 200 },
      { kind: "fee", dateISO: "2025-02-05", amountMinor: 50 },
      { kind: "interest", dateISO: "2025-02-10", amountMinor: 25 },
    ];
    const trades: Trade[] = [
      { dateISO: "2025-01-05", ticker: "X", side: "buy", quantity: 1, priceMinor: 1000, feeMinor: 0 },
      { dateISO: "2025-01-10", ticker: "X", side: "sell", quantity: 1, priceMinor: 1300, feeMinor: 0 }, // realised +300
    ];
    const positions: Position[] = [makePosition({ ticker: "Y", unrealizedPlMinor: 400, currentValueMinor: 2000 })];

    const result = computeTruth(cashEvents, trades, positions, "2025-03-01", "GBP");

    // realised 300 + unrealised 400 + dividends 200 - fees 50 + interest 25 = 875
    expect(result.realisedPlMinor).toBe(300);
    expect(result.unrealisedPlMinor).toBe(400);
    expect(result.currentValueMinor).toBe(2000);
    expect(result.totalGainMinor).toBe(875);
  });

  it("totalReturnPct is null when netContributions is zero (divide-by-zero guard)", () => {
    const result = computeTruth([], [], [], "2025-01-01", "GBP");
    expect(result.netContributionsMinor).toBe(0);
    expect(result.totalReturnPct).toBeNull();
  });

  it("totalReturnPct is null when netContributions is negative (withdrew more than deposited)", () => {
    const cashEvents: CashEvent[] = [
      { kind: "deposit", dateISO: "2025-01-01", amountMinor: 1000 },
      { kind: "withdrawal", dateISO: "2025-01-02", amountMinor: 5000 },
    ];
    const result = computeTruth(cashEvents, [], [], "2025-01-03", "GBP");
    expect(result.netContributionsMinor).toBe(-4000);
    expect(result.totalReturnPct).toBeNull();
  });

  it("totalReturnPct computes totalGain / netContributions when netContributions > 0", () => {
    const cashEvents: CashEvent[] = [{ kind: "deposit", dateISO: "2025-01-01", amountMinor: 10000 }];
    const positions: Position[] = [makePosition({ unrealizedPlMinor: 1000, currentValueMinor: 11000 })];
    const result = computeTruth(cashEvents, [], positions, "2025-02-01", "GBP");
    // totalGain = 0 (realised) + 1000 (unrealised) + 0 - 0 + 0 = 1000; netContrib = 10000 -> 0.1
    expect(result.totalGainMinor).toBe(1000);
    expect(result.totalReturnPct).toBeCloseTo(0.1, 10);
  });

  it("best/worst are null when positions is empty", () => {
    const result = computeTruth([], [], [], "2025-01-01", "GBP");
    expect(result.best).toBeNull();
    expect(result.worst).toBeNull();
  });

  it("passes through the given currency", () => {
    const result = computeTruth([], [], [], "2025-01-01", "USD");
    expect(result.currency).toBe("USD");
  });
});
