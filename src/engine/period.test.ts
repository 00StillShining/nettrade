// Known-answer unit tests for the period-aware Performance-Truth engine
// (period.ts). Each case states its hand-computed expected result in a
// comment, matching truth.test.ts/series.test.ts's style. Special
// attention to: the exact windowing boundary convention, cost basis
// legitimately carrying in from before a window, snapshot-anchor honesty
// (no anchor -> null + note, never a substituted/interpolated anchor), and
// ALL-period equivalence with the existing computeTruth.

import { describe, expect, it } from "vitest";
import type { CashEvent, EquitySnapshot, Trade } from "./types";
import type { Position } from "../adapters/trading212";
import { computeTruth } from "./truth";
import { computePeriodComponents, computePeriodTruth, periodStartISO } from "./period";

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

describe("periodStartISO", () => {
  const asOf = "2025-07-01T00:00:00.000Z";

  it("returns null for ALL (no window start)", () => {
    expect(periodStartISO("ALL", asOf)).toBeNull();
  });

  it("1M is exactly one calendar month back", () => {
    expect(periodStartISO("1M", asOf)).toBe(new Date(Date.UTC(2025, 5, 1)).toISOString());
  });

  it("3M is exactly three calendar months back", () => {
    expect(periodStartISO("3M", asOf)).toBe(new Date(Date.UTC(2025, 3, 1)).toISOString());
  });

  it("6M is exactly six calendar months back", () => {
    expect(periodStartISO("6M", asOf)).toBe(new Date(Date.UTC(2025, 0, 1)).toISOString());
  });

  it("1Y is exactly twelve calendar months back", () => {
    expect(periodStartISO("1Y", asOf)).toBe(new Date(Date.UTC(2024, 6, 1)).toISOString());
  });

  it("YTD is Jan 1 of the asOf year (UTC)", () => {
    expect(periodStartISO("YTD", asOf)).toBe(new Date(Date.UTC(2025, 0, 1)).toISOString());
  });

  it("1M is month-end clamped, matching filterByPeriod's monthsBackMs (not a raw setMonth roll)", () => {
    // asOf 2026-03-31 minus 1 month must land on the clamped 2026-02-28
    // (Feb has no 31st) — same clamp rule as series.ts's filterByPeriod,
    // reused via the shared periodStartMs helper so the two can never
    // disagree about a window's start.
    const start = periodStartISO("1M", "2026-03-31T00:00:00.000Z");
    expect(start).toBe(new Date(Date.UTC(2026, 1, 28)).toISOString());
  });

  it("YTD at the very start of the year still returns Jan 1 of that year", () => {
    expect(periodStartISO("YTD", "2026-01-01T00:00:00.000Z")).toBe(new Date(Date.UTC(2026, 0, 1)).toISOString());
  });
});

describe("computePeriodComponents — windowed event sums (boundary: startISO < dateISO <= asOfISO)", () => {
  const cashEvents: CashEvent[] = [
    { kind: "deposit", dateISO: "2025-01-01", amountMinor: 10000 }, // before window (excluded)
    { kind: "deposit", dateISO: "2025-06-01", amountMinor: 100 }, // exactly ON the start boundary (excluded — exclusive start)
    { kind: "deposit", dateISO: "2025-06-02", amountMinor: 5000 }, // inside window
    { kind: "withdrawal", dateISO: "2025-06-15", amountMinor: 2000 }, // inside window
    { kind: "dividend", dateISO: "2025-07-01", amountMinor: 150 }, // exactly ON the end boundary (included — inclusive end)
    { kind: "fee", dateISO: "2025-07-02", amountMinor: 50 }, // after window (excluded)
    { kind: "interest", dateISO: "2025-06-20", amountMinor: 30 }, // inside window
  ];
  const startISO = "2025-06-01";
  const asOfISO = "2025-07-01";

  it("sums each kind using the exclusive-start/inclusive-end boundary, excluding events before start and after asOf", () => {
    const result = computePeriodComponents(cashEvents, [], startISO, asOfISO);
    expect(result.depositsMinor).toBe(5000); // only 2025-06-02 (2025-01-01 too early, 2025-06-01 ON the boundary excluded)
    expect(result.withdrawalsMinor).toBe(2000);
    expect(result.netContributionsMinor).toBe(3000); // 5000 - 2000
    expect(result.dividendsMinor).toBe(150); // 2025-07-01 IS included (inclusive end)
    expect(result.feesMinor).toBe(0); // 2025-07-02 is after asOf
    expect(result.interestMinor).toBe(30);
  });

  it("startISO === null (ALL) has no lower bound — every event up to asOfISO counts", () => {
    const result = computePeriodComponents(cashEvents, [], null, asOfISO);
    expect(result.depositsMinor).toBe(10000 + 100 + 5000); // every deposit up to and including asOf
    expect(result.dividendsMinor).toBe(150);
    expect(result.feesMinor).toBe(0); // still after asOf, still excluded
  });

  it("a sell BEFORE the window is excluded from realisedInWindowMinor", () => {
    // Buy 10 @ 100 fee 0 (before window) -> cost 1000, qty 10
    // Sell 10 @ 150 fee 0 on 2025-05-01 (BEFORE window start 2025-06-01) -> realised 500, but excluded
    const trades: Trade[] = [
      { dateISO: "2025-01-01", ticker: "X", side: "buy", quantity: 10, priceMinor: 100, feeMinor: 0 },
      { dateISO: "2025-05-01", ticker: "X", side: "sell", quantity: 10, priceMinor: 150, feeMinor: 0 },
    ];
    const result = computePeriodComponents([], trades, startISO, asOfISO);
    expect(result.realisedInWindowMinor).toBe(0);
  });

  it("a buy BEFORE the window + a sell INSIDE the window realises inside, with cost basis carried in", () => {
    // Buy 10 @ 100 fee 0 on 2025-01-01 (before window) -> cost 1000, qty 10, avgCost 100
    // Sell 10 @ 150 fee 5 on 2025-06-10 (inside window):
    //   proceeds = 1500, costOfSold = 100*10 = 1000, realised = 1500 - 1000 - 5 = 495
    const trades: Trade[] = [
      { dateISO: "2025-01-01", ticker: "X", side: "buy", quantity: 10, priceMinor: 100, feeMinor: 0 },
      { dateISO: "2025-06-10", ticker: "X", side: "sell", quantity: 10, priceMinor: 150, feeMinor: 5 },
    ];
    const result = computePeriodComponents([], trades, startISO, asOfISO);
    expect(result.realisedInWindowMinor).toBe(495);
  });

  it("sells straddling the boundary: only the in-window sell's realised delta is accumulated", () => {
    // Buy 20 @ 100 fee 0 on 2025-01-01 -> cost 2000, qty 20, avgCost 100
    // Sell 5 @ 200 fee 0 on 2025-05-15 (BEFORE window) -> realised 500, EXCLUDED
    //   remaining qty 15, remaining cost 1500 (avgCost still 100)
    // Sell 5 @ 120 fee 0 on 2025-06-01 (ON the start boundary — EXCLUDED, exclusive start)
    //   remaining qty 10, remaining cost 1000
    // Sell 5 @ 130 fee 2 on 2025-06-20 (INSIDE window):
    //   proceeds = 650, costOfSold = 100*5 = 500, realised = 650 - 500 - 2 = 148
    // Sell 5 @ 90 fee 0 on 2025-07-01 (ON the end boundary — INCLUDED, inclusive end)
    //   proceeds = 450, costOfSold = 100*5 = 500, realised = -50
    // realisedInWindowMinor = 148 + (-50) = 98
    const trades: Trade[] = [
      { dateISO: "2025-01-01", ticker: "X", side: "buy", quantity: 20, priceMinor: 100, feeMinor: 0 },
      { dateISO: "2025-05-15", ticker: "X", side: "sell", quantity: 5, priceMinor: 200, feeMinor: 0 },
      { dateISO: "2025-06-01", ticker: "X", side: "sell", quantity: 5, priceMinor: 120, feeMinor: 0 },
      { dateISO: "2025-06-20", ticker: "X", side: "sell", quantity: 5, priceMinor: 130, feeMinor: 2 },
      { dateISO: "2025-07-01", ticker: "X", side: "sell", quantity: 5, priceMinor: 90, feeMinor: 0 },
    ];
    const result = computePeriodComponents([], trades, startISO, asOfISO);
    expect(result.realisedInWindowMinor).toBe(98);
  });

  it("a sell entirely after asOfISO is excluded", () => {
    const trades: Trade[] = [
      { dateISO: "2025-01-01", ticker: "X", side: "buy", quantity: 5, priceMinor: 100, feeMinor: 0 },
      { dateISO: "2025-07-15", ticker: "X", side: "sell", quantity: 5, priceMinor: 200, feeMinor: 0 },
    ];
    const result = computePeriodComponents([], trades, startISO, asOfISO);
    expect(result.realisedInWindowMinor).toBe(0);
  });
});

describe("computePeriodTruth — snapshotGain lens", () => {
  const asOfISO = "2025-07-01";
  const startISO = "2025-06-01"; // matches a hand-picked snapshot below for clean numbers

  it("uses the exact anchor at the period start and computes gain net of window contributions", () => {
    // Anchor snapshot exactly at startISO: value 10000
    // Positions now total: 12000
    // Window deposits: 1000 (single deposit inside window), no withdrawals
    // gain = currentValue(12000) - anchor(10000) - netContributions(1000) = 1000
    const snapshots: EquitySnapshot[] = [
      { atISO: "2025-01-01", totalValueMinor: 5000, netDepositsMinor: 5000 },
      { atISO: startISO, totalValueMinor: 10000, netDepositsMinor: 9500 },
    ];
    const cashEvents: CashEvent[] = [{ kind: "deposit", dateISO: "2025-06-10", amountMinor: 1000 }];
    const positions: Position[] = [makePosition({ currentValueMinor: 12000 })];

    const result = computePeriodTruth(cashEvents, [], positions, snapshots, "YTD", asOfISO, "GBP");
    // YTD start for asOf 2025-07-01 is 2025-01-01, not our hand-picked
    // startISO — recompute using the actual period the function derives.
    // Use a period whose derived start matches our anchor exactly instead:
    // We instead verify via the components' netContributionsMinor and the
    // anchor picked, both of which the function derives internally.
    expect(result.startISO).toBe(new Date(Date.UTC(2025, 0, 1)).toISOString());
    // With YTD (start 2025-01-01), the anchor at-or-before start is the
    // 2025-01-01 snapshot (value 5000), and the window (Jan 1 exclusive ->
    // Jul 1 inclusive) includes the 2025-06-10 deposit of 1000.
    // gain = 12000 - 5000 - 1000 = 6000
    expect(result.snapshotGain.anchor).toEqual(snapshots[0]);
    expect(result.snapshotGain.gainMinor).toBe(6000);
    expect(result.snapshotGain.note).toContain("2025-01-01");
  });

  it("picks the LATEST anchor at or before the window start when multiple snapshots qualify", () => {
    // 1M window ending 2025-07-01 -> start = 2025-06-01.
    // Two candidate anchors before/at start: 2025-05-01 and 2025-06-01
    // itself (exactly on the boundary — anchor selection is inclusive of
    // the start date, per latestSnapshotAtOrBefore's <= rule). The later
    // one (2025-06-01) must be chosen, not the earlier 2025-05-01.
    const snapshots: EquitySnapshot[] = [
      { atISO: "2025-05-01", totalValueMinor: 8000, netDepositsMinor: 8000 },
      { atISO: "2025-06-01", totalValueMinor: 9000, netDepositsMinor: 9000 },
    ];
    const positions: Position[] = [makePosition({ currentValueMinor: 9500 })];

    const result = computePeriodTruth([], [], positions, snapshots, "1M", asOfISO, "GBP");
    expect(result.snapshotGain.anchor).toEqual(snapshots[1]); // the 2025-06-01 one, not the earlier 2025-05-01
    // gain = 9500 - 9000 - 0 (no cash events) = 500
    expect(result.snapshotGain.gainMinor).toBe(500);
  });

  it("no anchor available -> gainMinor null with an honest explanatory note, never a substituted later snapshot", () => {
    // Only a snapshot AFTER the window start exists — must NOT be used.
    const snapshots: EquitySnapshot[] = [{ atISO: "2025-06-15", totalValueMinor: 9000, netDepositsMinor: 9000 }];
    const positions: Position[] = [makePosition({ currentValueMinor: 9500 })];

    const result = computePeriodTruth([], [], positions, snapshots, "1M", asOfISO, "GBP");
    expect(result.snapshotGain.anchor).toBeNull();
    expect(result.snapshotGain.gainMinor).toBeNull();
    expect(result.snapshotGain.note).toMatch(/no recorded snapshot/i);
  });

  it("no snapshots at all -> gainMinor null with the honest note", () => {
    const positions: Position[] = [makePosition({ currentValueMinor: 9500 })];
    const result = computePeriodTruth([], [], positions, [], "3M", asOfISO, "GBP");
    expect(result.snapshotGain.anchor).toBeNull();
    expect(result.snapshotGain.gainMinor).toBeNull();
  });

  it("contributions inside the window REDUCE the reported gain (money added isn't money earned)", () => {
    // Anchor at start: value 10000. Now: value 15000. A 4000 deposit inside
    // the window means only 1000 of the 5000 rise is genuine growth.
    const snapshots: EquitySnapshot[] = [{ atISO: "2025-06-01", totalValueMinor: 10000, netDepositsMinor: 10000 }];
    const cashEvents: CashEvent[] = [{ kind: "deposit", dateISO: "2025-06-15", amountMinor: 4000 }];
    const positions: Position[] = [makePosition({ currentValueMinor: 15000 })];

    const result = computePeriodTruth(cashEvents, [], positions, snapshots, "1M", asOfISO, "GBP");
    expect(result.snapshotGain.gainMinor).toBe(1000); // 15000 - 10000 - 4000
  });

  it("a deposit dated BETWEEN the anchor and the window start is netted out (not reported as growth)", () => {
    // The anchor pre-dates the window start: anchor 2025-05-01 @ 10000.
    // 1M window ending 2025-07-01 -> window start 2025-06-01.
    // A 4000 deposit on 2025-05-15 lands AFTER the anchor but BEFORE the
    // window start — it's inside currentValueMinor (a live "now" mark) but
    // NOT inside anchor.totalValueMinor. Holdings now 14000 (zero real
    // growth). Netting only in-window contributions would report 4000 of
    // growth; netting from the ANCHOR's date must report gainMinor 0.
    const snapshots: EquitySnapshot[] = [{ atISO: "2025-05-01", totalValueMinor: 10000, netDepositsMinor: 10000 }];
    const cashEvents: CashEvent[] = [{ kind: "deposit", dateISO: "2025-05-15", amountMinor: 4000 }];
    const positions: Position[] = [makePosition({ currentValueMinor: 14000 })];

    const result = computePeriodTruth(cashEvents, [], positions, snapshots, "1M", asOfISO, "GBP");
    expect(result.snapshotGain.anchor).toEqual(snapshots[0]);
    // The window's OWN net contributions are 0 (deposit is before the window
    // start) — but the since-anchor net contributions capture the full 4000.
    expect(result.components.netContributionsMinor).toBe(0);
    expect(result.snapshotGain.sinceAnchorNetContributionsMinor).toBe(4000);
    // gain = 14000 - 10000 - 4000 = 0 (honest: no real growth)
    expect(result.snapshotGain.gainMinor).toBe(0);
  });

  it("snapshotGain.returnPct = gain / (anchor value + since-anchor net contributions), decimal-exact", () => {
    // Anchor at start 2025-06-01 @ 10000; now 12000; 1M window.
    // A 1000 deposit on 2025-06-10 is both in-window and since-anchor.
    // gain = 12000 - 10000 - 1000 = 1000
    // denom = anchor(10000) + sinceAnchorNet(1000) = 11000
    // returnPct = 1000 / 11000 = 0.09090909...
    const snapshots: EquitySnapshot[] = [{ atISO: "2025-06-01", totalValueMinor: 10000, netDepositsMinor: 10000 }];
    const cashEvents: CashEvent[] = [{ kind: "deposit", dateISO: "2025-06-10", amountMinor: 1000 }];
    const positions: Position[] = [makePosition({ currentValueMinor: 12000 })];

    const result = computePeriodTruth(cashEvents, [], positions, snapshots, "1M", asOfISO, "GBP");
    expect(result.snapshotGain.gainMinor).toBe(1000);
    expect(result.snapshotGain.sinceAnchorNetContributionsMinor).toBe(1000);
    expect(result.snapshotGain.returnPct).toBeCloseTo(1000 / 11000, 10);
  });

  it("snapshotGain.returnPct is null when the denominator (anchor value + since-anchor net) is <= 0", () => {
    // Anchor value 0 and no contributions -> denom 0 -> undefined ratio.
    const snapshots: EquitySnapshot[] = [{ atISO: "2025-06-01", totalValueMinor: 0, netDepositsMinor: 0 }];
    const positions: Position[] = [makePosition({ currentValueMinor: 500 })];

    const result = computePeriodTruth([], [], positions, snapshots, "1M", asOfISO, "GBP");
    expect(result.snapshotGain.gainMinor).toBe(500);
    expect(result.snapshotGain.returnPct).toBeNull();
  });

  it("no anchor -> sinceAnchorNetContributionsMinor and returnPct are both null", () => {
    const snapshots: EquitySnapshot[] = [{ atISO: "2025-06-15", totalValueMinor: 9000, netDepositsMinor: 9000 }];
    const positions: Position[] = [makePosition({ currentValueMinor: 9500 })];
    const result = computePeriodTruth([], [], positions, snapshots, "1M", asOfISO, "GBP");
    expect(result.snapshotGain.sinceAnchorNetContributionsMinor).toBeNull();
    expect(result.snapshotGain.returnPct).toBeNull();
  });

  it("a withdrawal inside the window INCREASES the reported gain (money taken out isn't a loss of growth)", () => {
    // Anchor at start: value 10000. Now: value 9000. A 2000 withdrawal
    // inside the window means the underlying holdings actually grew by
    // 1000, even though the raw value dropped.
    const snapshots: EquitySnapshot[] = [{ atISO: "2025-06-01", totalValueMinor: 10000, netDepositsMinor: 10000 }];
    const cashEvents: CashEvent[] = [{ kind: "withdrawal", dateISO: "2025-06-15", amountMinor: 2000 }];
    const positions: Position[] = [makePosition({ currentValueMinor: 9000 })];

    const result = computePeriodTruth(cashEvents, [], positions, snapshots, "1M", asOfISO, "GBP");
    // netContributions = 0 - 2000 = -2000; gain = 9000 - 10000 - (-2000) = 1000
    expect(result.snapshotGain.gainMinor).toBe(1000);
  });
});

describe("computePeriodTruth — ALL period equivalence with computeTruth", () => {
  it("ALL's components mirror the all-time computeTruth sums, and snapshotGain is honestly null (no window to anchor)", () => {
    const cashEvents: CashEvent[] = [
      { kind: "deposit", dateISO: "2025-01-01", amountMinor: 10000 },
      { kind: "deposit", dateISO: "2025-02-01", amountMinor: 5000 },
      { kind: "withdrawal", dateISO: "2025-03-01", amountMinor: 2000 },
      { kind: "dividend", dateISO: "2025-03-15", amountMinor: 150 },
      { kind: "fee", dateISO: "2025-03-20", amountMinor: 50 },
      { kind: "interest", dateISO: "2025-03-25", amountMinor: 30 },
    ];
    const trades: Trade[] = [
      { dateISO: "2025-01-05", ticker: "X", side: "buy", quantity: 1, priceMinor: 1000, feeMinor: 0 },
      { dateISO: "2025-01-10", ticker: "X", side: "sell", quantity: 1, priceMinor: 1300, feeMinor: 0 }, // realised +300
    ];
    const positions: Position[] = [makePosition({ unrealizedPlMinor: 400, currentValueMinor: 2000 })];
    const snapshots: EquitySnapshot[] = [{ atISO: "2025-01-01", totalValueMinor: 500, netDepositsMinor: 500 }];
    const asOfISO = "2025-04-01";

    const allTime = computeTruth(cashEvents, trades, positions, asOfISO, "GBP");
    const periodTruth = computePeriodTruth(cashEvents, trades, positions, snapshots, "ALL", asOfISO, "GBP");

    expect(periodTruth.startISO).toBeNull();
    expect(periodTruth.components.depositsMinor).toBe(allTime.depositsMinor);
    expect(periodTruth.components.withdrawalsMinor).toBe(allTime.withdrawalsMinor);
    expect(periodTruth.components.netContributionsMinor).toBe(allTime.netContributionsMinor);
    expect(periodTruth.components.dividendsMinor).toBe(allTime.dividendsMinor);
    expect(periodTruth.components.feesMinor).toBe(allTime.feesMinor);
    expect(periodTruth.components.interestMinor).toBe(allTime.interestMinor);
    expect(periodTruth.components.realisedInWindowMinor).toBe(allTime.realisedPlMinor);

    // The two lenses are never summed together — snapshotGain for ALL is
    // honestly null (no earlier window start exists to anchor against),
    // even though a snapshot happens to be supplied here.
    expect(periodTruth.snapshotGain.anchor).toBeNull();
    expect(periodTruth.snapshotGain.gainMinor).toBeNull();
  });

  it("ALL's realisedInWindowMinor matches computeTruth's realisedPlMinor even with trades straddling many dates", () => {
    const trades: Trade[] = [
      { dateISO: "2025-01-01", ticker: "ABC", side: "buy", quantity: 10, priceMinor: 100, feeMinor: 5 },
      { dateISO: "2025-01-02", ticker: "ABC", side: "buy", quantity: 10, priceMinor: 200, feeMinor: 5 },
      { dateISO: "2025-01-03", ticker: "ABC", side: "sell", quantity: 5, priceMinor: 300, feeMinor: 2 },
      { dateISO: "2025-01-04", ticker: "ABC", side: "sell", quantity: 15, priceMinor: 120, feeMinor: 3 },
    ];
    const asOfISO = "2025-02-01";
    const allTime = computeTruth([], trades, [], asOfISO, "GBP");
    const periodTruth = computePeriodTruth([], trades, [], [], "ALL", asOfISO, "GBP");
    expect(periodTruth.components.realisedInWindowMinor).toBe(allTime.realisedPlMinor);
    expect(allTime.realisedPlMinor).toBe(285); // same hand-computed answer as truth.test.ts's equivalent case
  });
});
