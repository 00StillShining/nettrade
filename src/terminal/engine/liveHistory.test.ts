/* =========================================================================
   LIVE HISTORY — pure mapping unit tests (phase 2c). Covers the exported
   pure functions ONLY (no DB, no network, no Tauri bridge): fill -> Trade
   (side/units/sort), transaction/dividend -> CashEvent kinds, executed-only
   filtering, the snapshot minute-truncation key, and the incremental-stop
   predicate. These are the rules the honest Performance-Truth split rests on.
   ========================================================================= */
import { describe, it, expect } from "vitest";
import type {
  HistoryOrderFill,
  HistoryDividend,
  HistoryTransaction,
} from "../../adapters/trading212";
import {
  cleanTicker,
  isExecutedFill,
  fillToTrade,
  fillsToTrades,
  transactionToCashEvent,
  dividendToCashEvent,
  toCashEvents,
  pageAllKnown,
  snapshotMinuteKey,
} from "./liveHistory";

/* ---- fixtures ---- */

function fill(over: Partial<HistoryOrderFill> = {}): HistoryOrderFill {
  return {
    id: "o1",
    dateISO: "2026-01-10T12:00:00.000Z",
    ticker: "AAPL_US_EQ",
    side: "buy",
    quantity: 10,
    fillPriceMinor: 19000, // $190.00
    filledValueMinor: 190000,
    feeMinor: 100,
    status: "FILLED",
    raw: null,
    ...over,
  };
}

function txn(over: Partial<HistoryTransaction> = {}): HistoryTransaction {
  return {
    id: "t1",
    dateISO: "2026-01-01T00:00:00.000Z",
    kind: "deposit",
    amountMinor: 100000,
    reference: null,
    raw: null,
    ...over,
  };
}

function div(over: Partial<HistoryDividend> = {}): HistoryDividend {
  return {
    id: "d1",
    dateISO: "2026-02-01T00:00:00.000Z",
    ticker: "MSFT_US_EQ",
    amountMinor: 500,
    quantity: 3,
    grossPerShareMinor: 170,
    type: "ORDINARY",
    raw: null,
    ...over,
  };
}

/* ---- cleanTicker ---- */

describe("cleanTicker", () => {
  it("strips the T212 suffix and uppercases", () => {
    expect(cleanTicker("AAPL_US_EQ")).toBe("AAPL");
    expect(cleanTicker("nvda_us_eq")).toBe("NVDA");
  });
  it("passes a bare symbol through, trimmed", () => {
    expect(cleanTicker("  tsla ")).toBe("TSLA");
  });
});

/* ---- isExecutedFill ---- */

describe("isExecutedFill", () => {
  it("accepts FILLED / EXECUTED with positive qty and price", () => {
    expect(isExecutedFill(fill({ status: "FILLED" }))).toBe(true);
    expect(isExecutedFill(fill({ status: "EXECUTED" }))).toBe(true);
    expect(isExecutedFill(fill({ status: "PARTIALLY_FILLED" }))).toBe(true);
  });
  it("rejects pending/cancelled/rejected statuses", () => {
    expect(isExecutedFill(fill({ status: "CANCELLED" }))).toBe(false);
    expect(isExecutedFill(fill({ status: "REJECTED" }))).toBe(false);
    expect(isExecutedFill(fill({ status: "NEW" }))).toBe(false);
  });
  it("rejects a zero/negative quantity or zero price even if filled", () => {
    expect(isExecutedFill(fill({ status: "FILLED", quantity: 0 }))).toBe(false);
    expect(isExecutedFill(fill({ status: "FILLED", fillPriceMinor: 0 }))).toBe(false);
  });
});

/* ---- fillToTrade ---- */

describe("fillToTrade", () => {
  it("maps side, units and cleaned ticker; price stays fillPriceMinor", () => {
    const t = fillToTrade(fill({ side: "sell", quantity: 4, fillPriceMinor: 20500 }));
    expect(t).toMatchObject({
      dateISO: "2026-01-10T12:00:00.000Z",
      ticker: "AAPL",
      side: "sell",
      quantity: 4,
      priceMinor: 20500,
      feeMinor: 100,
    });
  });
  it("prefers filledValueMinor as settledValueMinor when non-zero", () => {
    expect(fillToTrade(fill({ filledValueMinor: 190000 })).settledValueMinor).toBe(190000);
  });
  it("leaves settledValueMinor undefined when filledValueMinor is 0", () => {
    expect(fillToTrade(fill({ filledValueMinor: 0 })).settledValueMinor).toBeUndefined();
  });
});

/* ---- fillsToTrades: executed-only + chronological ---- */

describe("fillsToTrades", () => {
  it("drops non-executed fills and sorts the rest chronologically ASC", () => {
    const fills: HistoryOrderFill[] = [
      fill({ id: "b", dateISO: "2026-03-01T00:00:00.000Z", status: "FILLED" }),
      fill({ id: "cancelled", dateISO: "2026-02-15T00:00:00.000Z", status: "CANCELLED" }),
      fill({ id: "a", dateISO: "2026-01-05T00:00:00.000Z", status: "EXECUTED" }),
    ];
    const trades = fillsToTrades(fills);
    expect(trades.map((t) => t.dateISO)).toEqual([
      "2026-01-05T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    ]);
  });
  it("returns empty for an all-unexecuted list", () => {
    expect(fillsToTrades([fill({ status: "CANCELLED" })])).toEqual([]);
  });
});

/* ---- transaction -> CashEvent kinds ---- */

describe("transactionToCashEvent", () => {
  it("maps deposit/withdrawal/interest with a positive amount", () => {
    expect(transactionToCashEvent(txn({ kind: "deposit", amountMinor: 100000 }))).toEqual({
      kind: "deposit",
      dateISO: "2026-01-01T00:00:00.000Z",
      amountMinor: 100000,
    });
    expect(transactionToCashEvent(txn({ kind: "withdrawal", amountMinor: 5000 }))).toMatchObject({
      kind: "withdrawal",
      amountMinor: 5000,
    });
    expect(transactionToCashEvent(txn({ kind: "interest", amountMinor: 12 }))).toMatchObject({
      kind: "interest",
      amountMinor: 12,
    });
  });
  it("maps fee carrying the reference as note", () => {
    const e = transactionToCashEvent(txn({ kind: "fee", amountMinor: 99, reference: "FX fee" }));
    expect(e).toMatchObject({ kind: "fee", amountMinor: 99, note: "FX fee" });
  });
  it("returns null for the unmodelled 'other' kind", () => {
    expect(transactionToCashEvent(txn({ kind: "other" }))).toBeNull();
  });
});

/* ---- dividend -> CashEvent ---- */

describe("dividendToCashEvent", () => {
  it("maps to a dividend event with the ticker cleaned and a positive amount", () => {
    expect(dividendToCashEvent(div({ ticker: "MSFT_US_EQ", amountMinor: 500 }))).toEqual({
      kind: "dividend",
      dateISO: "2026-02-01T00:00:00.000Z",
      amountMinor: 500,
      ticker: "MSFT",
    });
  });
});

/* ---- toCashEvents: aggregation + skipped-other count ---- */

describe("toCashEvents", () => {
  it("aggregates transactions + dividends and counts skipped 'other'", () => {
    const { events, skippedOther } = toCashEvents(
      [txn({ kind: "deposit" }), txn({ id: "t2", kind: "other" }), txn({ id: "t3", kind: "fee" })],
      [div()],
    );
    expect(skippedOther).toBe(1);
    // deposit + fee + dividend survive; the 'other' is dropped (counted, not silent)
    expect(events.map((e) => e.kind).sort()).toEqual(["deposit", "dividend", "fee"]);
  });
  it("keeps dividend amounts positive (engine applies sign by kind)", () => {
    const { events } = toCashEvents([], [div({ amountMinor: 500 })]);
    expect(events[0]).toMatchObject({ kind: "dividend", amountMinor: 500 });
  });
});

/* ---- pageAllKnown: the incremental-stop predicate ---- */

describe("pageAllKnown", () => {
  it("first run (empty table) never stops on a non-empty page -> keeps back-filling", () => {
    expect(pageAllKnown(["a", "b"], new Set<string>(), false)).toBe(false);
  });
  it("catch-up: a fully-known page on a non-empty table stops", () => {
    expect(pageAllKnown(["a", "b"], new Set(["a", "b", "c"]), true)).toBe(true);
  });
  it("catch-up: a page with ANY new id keeps paginating", () => {
    expect(pageAllKnown(["a", "z"], new Set(["a", "b"]), true)).toBe(false);
  });
  it("an empty page always stops (nothing new to persist)", () => {
    expect(pageAllKnown([], new Set<string>(), false)).toBe(true);
    expect(pageAllKnown([], new Set(["a"]), true)).toBe(true);
  });
});

/* ---- snapshotMinuteKey: minute truncation dedupe ---- */

describe("snapshotMinuteKey", () => {
  it("truncates to the minute (seconds + ms zeroed) so two syncs in one minute collide", () => {
    const a = snapshotMinuteKey("2026-01-10T12:34:15.123Z");
    const b = snapshotMinuteKey("2026-01-10T12:34:58.900Z");
    expect(a).toBe("2026-01-10T12:34:00.000Z");
    expect(a).toBe(b);
  });
  it("different minutes produce different keys", () => {
    expect(snapshotMinuteKey("2026-01-10T12:34:15.000Z")).not.toBe(
      snapshotMinuteKey("2026-01-10T12:35:15.000Z"),
    );
  });
  it("an unparsable input falls back to the raw string (never throws)", () => {
    expect(snapshotMinuteKey("not-a-date")).toBe("not-a-date");
  });
});
