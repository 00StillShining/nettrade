// Known-answer unit tests for the Performance-Truth engine's honest time
// series (series.ts). Each case states its hand-computed expected result
// in a comment. Special attention to the HONESTY laws: sparse/empty input
// must produce sparse/empty output, never fabricated/interpolated points.

import { describe, expect, it } from "vitest";
import type { CashEvent, EquitySnapshot, Trade } from "./types";
import { filterByPeriod, netDepositsSeries, realisedSeries, valueSeries } from "./series";

describe("netDepositsSeries", () => {
  it("returns an empty array for an empty cashEvents list (honest, not faked)", () => {
    expect(netDepositsSeries([], "2025-01-01")).toEqual([]);
  });

  it("steps cumulative deposits-minus-withdrawals at each real event date, then appends asOf", () => {
    // +1000 (2025-01-01) -> 1000
    // +500  (2025-01-15) -> 1500
    // -200  (2025-02-01) -> 1300
    // final point at asOf (2025-03-01) carries 1300 forward
    const cashEvents: CashEvent[] = [
      { kind: "deposit", dateISO: "2025-01-01", amountMinor: 1000 },
      { kind: "deposit", dateISO: "2025-01-15", amountMinor: 500 },
      { kind: "withdrawal", dateISO: "2025-02-01", amountMinor: 200 },
    ];
    const points = netDepositsSeries(cashEvents, "2025-03-01");
    expect(points).toEqual([
      { atISO: "2025-01-01", valueMinor: 1000 },
      { atISO: "2025-01-15", valueMinor: 1500 },
      { atISO: "2025-02-01", valueMinor: 1300 },
      { atISO: "2025-03-01", valueMinor: 1300 },
    ]);
  });

  it("ignores dividend/fee/interest events (they are not contributions)", () => {
    const cashEvents: CashEvent[] = [
      { kind: "deposit", dateISO: "2025-01-01", amountMinor: 1000 },
      { kind: "dividend", dateISO: "2025-01-02", amountMinor: 50 },
      { kind: "fee", dateISO: "2025-01-03", amountMinor: 20 },
      { kind: "interest", dateISO: "2025-01-04", amountMinor: 10 },
    ];
    const points = netDepositsSeries(cashEvents, "2025-01-05");
    expect(points).toEqual([
      { atISO: "2025-01-01", valueMinor: 1000 },
      { atISO: "2025-01-05", valueMinor: 1000 },
    ]);
  });

  it("does not duplicate the final point when the last event already lands on asOfISO", () => {
    const cashEvents: CashEvent[] = [{ kind: "deposit", dateISO: "2025-01-01", amountMinor: 1000 }];
    const points = netDepositsSeries(cashEvents, "2025-01-01");
    expect(points).toEqual([{ atISO: "2025-01-01", valueMinor: 1000 }]);
  });

  it("defensively sorts out-of-order events before stepping", () => {
    const cashEvents: CashEvent[] = [
      { kind: "deposit", dateISO: "2025-01-15", amountMinor: 500 },
      { kind: "deposit", dateISO: "2025-01-01", amountMinor: 1000 },
    ];
    const points = netDepositsSeries(cashEvents, "2025-02-01");
    expect(points[0]).toEqual({ atISO: "2025-01-01", valueMinor: 1000 });
    expect(points[1]).toEqual({ atISO: "2025-01-15", valueMinor: 1500 });
  });
});

describe("realisedSeries", () => {
  it("returns an empty array when there are no sells (honest: nothing realised yet)", () => {
    const trades: Trade[] = [{ dateISO: "2025-01-01", ticker: "X", side: "buy", quantity: 1, priceMinor: 100, feeMinor: 0 }];
    expect(realisedSeries(trades, "2025-02-01")).toEqual([]);
  });

  it("returns an empty array for an empty trade list", () => {
    expect(realisedSeries([], "2025-01-01")).toEqual([]);
  });

  it("stamps cumulative realised P/L at each sell date, then appends asOf", () => {
    // Buy 10 @ 100 fee 0 -> cost 1000, qty 10, avgCost 100
    // Sell 4 @ 150 fee 0 on 2025-01-10 -> realised = 4*(150-100) = 200
    // Sell 6 @ 80  fee 0 on 2025-01-20 -> realised = 6*(80-100) = -120; cumulative 80
    const trades: Trade[] = [
      { dateISO: "2025-01-01", ticker: "X", side: "buy", quantity: 10, priceMinor: 100, feeMinor: 0 },
      { dateISO: "2025-01-10", ticker: "X", side: "sell", quantity: 4, priceMinor: 150, feeMinor: 0 },
      { dateISO: "2025-01-20", ticker: "X", side: "sell", quantity: 6, priceMinor: 80, feeMinor: 0 },
    ];
    const points = realisedSeries(trades, "2025-02-01");
    expect(points).toEqual([
      { atISO: "2025-01-10", valueMinor: 200 },
      { atISO: "2025-01-20", valueMinor: 80 },
      { atISO: "2025-02-01", valueMinor: 80 },
    ]);
  });

  it("does not duplicate the final point when the last sell already lands on asOfISO", () => {
    const trades: Trade[] = [
      { dateISO: "2025-01-01", ticker: "X", side: "buy", quantity: 1, priceMinor: 100, feeMinor: 0 },
      { dateISO: "2025-01-10", ticker: "X", side: "sell", quantity: 1, priceMinor: 150, feeMinor: 0 },
    ];
    const points = realisedSeries(trades, "2025-01-10");
    expect(points).toEqual([{ atISO: "2025-01-10", valueMinor: 50 }]);
  });
});

describe("valueSeries", () => {
  it("returns an empty array for empty snapshots — honest, not faked", () => {
    expect(valueSeries([])).toEqual([]);
  });

  it("is a straight passthrough of recorded snapshots, sorted chronologically", () => {
    const snapshots: EquitySnapshot[] = [
      { atISO: "2025-02-01", totalValueMinor: 2000, netDepositsMinor: 1800 },
      { atISO: "2025-01-01", totalValueMinor: 1000, netDepositsMinor: 1000 },
    ];
    const points = valueSeries(snapshots);
    expect(points).toEqual([
      { atISO: "2025-01-01", valueMinor: 1000 },
      { atISO: "2025-02-01", valueMinor: 2000 },
    ]);
  });

  it("a single snapshot produces a single-point series (sparse is honest)", () => {
    const snapshots: EquitySnapshot[] = [{ atISO: "2025-01-01", totalValueMinor: 500, netDepositsMinor: 500 }];
    expect(valueSeries(snapshots)).toEqual([{ atISO: "2025-01-01", valueMinor: 500 }]);
  });
});

describe("filterByPeriod", () => {
  const points = [
    { atISO: "2024-01-01", valueMinor: 1 },
    { atISO: "2024-06-01", valueMinor: 2 },
    { atISO: "2024-12-01", valueMinor: 3 },
    { atISO: "2025-01-01", valueMinor: 4 },
    { atISO: "2025-06-15", valueMinor: 5 },
    { atISO: "2025-07-01", valueMinor: 6 }, // asOf
  ];
  const asOf = "2025-07-01";

  it("ALL returns every point unchanged", () => {
    expect(filterByPeriod(points, "ALL", asOf)).toEqual(points);
  });

  it("1M keeps only points within the trailing month", () => {
    const result = filterByPeriod(points, "1M", asOf);
    expect(result).toEqual([
      { atISO: "2025-06-15", valueMinor: 5 },
      { atISO: "2025-07-01", valueMinor: 6 },
    ]);
  });

  it("YTD keeps points from Jan 1 of the asOf year onward", () => {
    const result = filterByPeriod(points, "YTD", asOf);
    expect(result).toEqual([
      { atISO: "2025-01-01", valueMinor: 4 },
      { atISO: "2025-06-15", valueMinor: 5 },
      { atISO: "2025-07-01", valueMinor: 6 },
    ]);
  });

  it("1Y keeps points within the trailing year", () => {
    const result = filterByPeriod(points, "1Y", asOf);
    expect(result).toEqual([
      { atISO: "2024-12-01", valueMinor: 3 },
      { atISO: "2025-01-01", valueMinor: 4 },
      { atISO: "2025-06-15", valueMinor: 5 },
      { atISO: "2025-07-01", valueMinor: 6 },
    ]);
  });

  it("returns an empty array when no points fall in the window (honest, not padded)", () => {
    const result = filterByPeriod(points, "1M", "2020-01-01");
    expect(result).toEqual([]);
  });

  it("an empty input series returns an empty array regardless of period", () => {
    expect(filterByPeriod([], "1Y", asOf)).toEqual([]);
  });

  it("1M does not overflow past month-end (day-clamped, not a raw setMonth roll)", () => {
    // asOf 2026-03-31 minus 1 month must land on the clamped 2026-02-28
    // (Feb has no 31st), not roll forward into March — a point at
    // 2026-03-01 must still be included in the window.
    const monthEndPoints = [
      { atISO: "2026-02-27", valueMinor: 1 },
      { atISO: "2026-03-01", valueMinor: 2 },
      { atISO: "2026-03-31", valueMinor: 3 },
    ];
    const result = filterByPeriod(monthEndPoints, "1M", "2026-03-31");
    expect(result).toEqual([
      { atISO: "2026-03-01", valueMinor: 2 },
      { atISO: "2026-03-31", valueMinor: 3 },
    ]);
  });
});
