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
  bookSym,
  reconcile,
  RECON_EPSILON,
  buildXirrFlows,
} from "./liveHistory";
import {
  pickSnapshotPair,
  netContributionsBetween,
  computeLiveDaySummary,
} from "../../animus/daySummary";
import type { EquitySnapshotRow } from "../../db/history";

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

/* ---- bookSym: the live-book key derivation (clean + crypto pair) ---- */

describe("bookSym", () => {
  it("cleans an equity suffix to the display symbol", () => {
    expect(bookSym("AAPL_US_EQ")).toBe("AAPL");
    expect(bookSym("nvda_us_eq")).toBe("NVDA");
  });
  it("maps a crypto base to the pair the live book uses", () => {
    // live.ts writes State.positions under CRYPTO_PAIR ("BTC" -> "BTC-USD"); a
    // BTC fill must net under the SAME key or every crypto holding reads as a
    // phantom mismatch.
    expect(bookSym("BTC_EUR")).toBe("BTC-USD");
    expect(bookSym("ETH")).toBe("ETH-USD");
  });
});

/* ---- reconcile: ledger-vs-book cross-check (item 2) ---- */

describe("reconcile", () => {
  it("matches when replayed net qty equals the live held qty", () => {
    const fills: HistoryOrderFill[] = [
      fill({ id: "b1", ticker: "AAPL_US_EQ", side: "buy", quantity: 10 }),
      fill({ id: "b2", ticker: "AAPL_US_EQ", side: "buy", quantity: 5 }),
      fill({ id: "s1", ticker: "AAPL_US_EQ", side: "sell", quantity: 3 }),
    ];
    const r = reconcile(fills, { AAPL: { qty: 12 } }); // 10 + 5 - 3 = 12
    expect(r.mismatches).toBe(0);
    expect(r.perTicker).toEqual([{ sym: "AAPL", ledgerQty: 12, liveQty: 12, ok: true }]);
  });

  it("flags a quantity drift between ledger and book", () => {
    const fills: HistoryOrderFill[] = [fill({ ticker: "AAPL_US_EQ", side: "buy", quantity: 10 })];
    const r = reconcile(fills, { AAPL: { qty: 8 } });
    expect(r.mismatches).toBe(1);
    expect(r.perTicker[0]).toMatchObject({ sym: "AAPL", ledgerQty: 10, liveQty: 8, ok: false });
  });

  it("flags a symbol HELD live with NO fills in history (missing fills)", () => {
    const r = reconcile([], { TSLA: { qty: 4 } });
    expect(r.mismatches).toBe(1);
    expect(r.perTicker[0]).toMatchObject({ sym: "TSLA", ledgerQty: 0, liveQty: 4, ok: false });
  });

  it("flags fills that net to a position with NO live holding", () => {
    const fills: HistoryOrderFill[] = [fill({ ticker: "MSFT_US_EQ", side: "buy", quantity: 7 })];
    const r = reconcile(fills, {}); // netted to 7 held, but book has none
    expect(r.mismatches).toBe(1);
    expect(r.perTicker[0]).toMatchObject({ sym: "MSFT", ledgerQty: 7, liveQty: 0, ok: false });
  });

  it("treats a fully-closed ledger position (net 0) with no holding as OK", () => {
    const fills: HistoryOrderFill[] = [
      fill({ id: "b", ticker: "AAPL_US_EQ", side: "buy", quantity: 5 }),
      fill({ id: "s", ticker: "AAPL_US_EQ", side: "sell", quantity: 5 }),
    ];
    const r = reconcile(fills, {}); // net 0, no holding -> agree at 0
    expect(r.mismatches).toBe(0);
    expect(r.perTicker[0]).toMatchObject({ sym: "AAPL", ledgerQty: 5 - 5, liveQty: 0, ok: true });
  });

  it("respects the fractional-share epsilon (dust agrees, a real gap does not)", () => {
    // a difference well UNDER epsilon is rounding dust and agrees...
    const under = reconcile([fill({ ticker: "AAPL_US_EQ", side: "buy", quantity: 10 })], {
      AAPL: { qty: 10 + RECON_EPSILON / 2 },
    });
    expect(under.mismatches).toBe(0);
    // ...a difference clearly OVER epsilon is a genuine mismatch.
    const over = reconcile([fill({ ticker: "AAPL_US_EQ", side: "buy", quantity: 10 })], {
      AAPL: { qty: 10 + RECON_EPSILON * 2 },
    });
    expect(over.mismatches).toBe(1);
  });

  it("ignores non-executed fills in the ledger replay", () => {
    const fills: HistoryOrderFill[] = [
      fill({ id: "ok", ticker: "AAPL_US_EQ", side: "buy", quantity: 10, status: "FILLED" }),
      fill({ id: "no", ticker: "AAPL_US_EQ", side: "buy", quantity: 99, status: "CANCELLED" }),
    ];
    const r = reconcile(fills, { AAPL: { qty: 10 } });
    expect(r.mismatches).toBe(0);
    expect(r.perTicker[0].ledgerQty).toBe(10); // the cancelled 99 never counted
  });

  it("nets a crypto fill under the pair key the book uses", () => {
    const fills: HistoryOrderFill[] = [fill({ ticker: "BTC_EUR", side: "buy", quantity: 0.5 })];
    const r = reconcile(fills, { "BTC-USD": { qty: 0.5 } });
    expect(r.mismatches).toBe(0);
    expect(r.perTicker[0]).toMatchObject({ sym: "BTC-USD", ok: true });
  });

  it("orders mismatches first, then alphabetically", () => {
    const fills: HistoryOrderFill[] = [
      fill({ id: "z", ticker: "ZZZ_US_EQ", side: "buy", quantity: 5 }), // ok
      fill({ id: "a", ticker: "AAA_US_EQ", side: "buy", quantity: 5 }), // mismatch
    ];
    const r = reconcile(fills, { ZZZ: { qty: 5 }, AAA: { qty: 1 } });
    expect(r.perTicker.map((p) => p.sym)).toEqual(["AAA", "ZZZ"]); // AAA (not ok) first
  });
});

/* ---- buildXirrFlows: investor-convention flow list ---- */

describe("buildXirrFlows", () => {
  const NOW = "2026-07-05T00:00:00.000Z";

  it("makes deposits NEGATIVE and withdrawals POSITIVE, terminal appended last", () => {
    const flows = buildXirrFlows(
      [
        { kind: "deposit", dateISO: "2026-01-01T00:00:00.000Z", amountMinor: 100000 },
        { kind: "withdrawal", dateISO: "2026-03-01T00:00:00.000Z", amountMinor: 20000 },
      ],
      130000, // live terminal value
      NOW,
    );
    expect(flows).toEqual([
      { dateISO: "2026-01-01T00:00:00.000Z", amountMinor: -100000 },
      { dateISO: "2026-03-01T00:00:00.000Z", amountMinor: 20000 },
      { dateISO: NOW, amountMinor: 130000 }, // terminal is last, positive
    ]);
  });

  it("excludes interest, fees and dividends (internal, not external flows)", () => {
    const flows = buildXirrFlows(
      [
        { kind: "deposit", dateISO: "2026-01-01T00:00:00.000Z", amountMinor: 100000 },
        { kind: "interest", dateISO: "2026-02-01T00:00:00.000Z", amountMinor: 50 },
        { kind: "fee", dateISO: "2026-02-02T00:00:00.000Z", amountMinor: 30 },
        { kind: "dividend", dateISO: "2026-02-03T00:00:00.000Z", amountMinor: 200, ticker: "AAPL" },
      ],
      110000,
      NOW,
    );
    // only the deposit + terminal survive
    expect(flows).toEqual([
      { dateISO: "2026-01-01T00:00:00.000Z", amountMinor: -100000 },
      { dateISO: NOW, amountMinor: 110000 },
    ]);
  });

  it("always appends exactly one terminal flow even with no cash events", () => {
    const flows = buildXirrFlows([], 5000, NOW);
    expect(flows).toEqual([{ dateISO: NOW, amountMinor: 5000 }]);
  });
});

/* ============================================================================
   ANIMUS 24H DAY SUMMARY — pure helpers (item 5). The card's live branch reads
   snapshots + transactions and diffs the latest snapshot against the latest one
   at least 24h older, netting out contributions in the window. These test that
   maths directly (no DB / no Animus mount).
   ============================================================================ */

function snap(atISO: string, totalValueMinor: number, netDepositsMinor = 0): EquitySnapshotRow {
  return { atISO, totalValueMinor, netDepositsMinor, ccy: "GBP" };
}

describe("pickSnapshotPair", () => {
  it("returns null with fewer than two snapshots", () => {
    expect(pickSnapshotPair([])).toBeNull();
    expect(pickSnapshotPair([snap("2026-07-05T00:00:00.000Z", 10000)])).toBeNull();
  });

  it("returns null when every earlier snapshot is inside the last 24h", () => {
    // three points, all within a few hours — no 24h+ span exists yet
    const pair = pickSnapshotPair([
      snap("2026-07-05T09:00:00.000Z", 10000),
      snap("2026-07-05T12:00:00.000Z", 10100),
      snap("2026-07-05T15:00:00.000Z", 10200),
    ]);
    expect(pair).toBeNull();
  });

  it("picks the latest, and the NEWEST snapshot at least 24h older", () => {
    const older = snap("2026-07-03T12:00:00.000Z", 9000); // 2 days back
    const dayBack = snap("2026-07-04T09:00:00.000Z", 9500); // ~27h back — newest that clears 24h
    const inside = snap("2026-07-05T06:00:00.000Z", 9800); // ~6h back — too recent
    const latest = snap("2026-07-05T12:00:00.000Z", 10000);
    // pass unsorted to prove the helper sorts
    const pair = pickSnapshotPair([inside, latest, older, dayBack]);
    expect(pair).not.toBeNull();
    expect(pair!.latest.atISO).toBe(latest.atISO);
    expect(pair!.prior.atISO).toBe(dayBack.atISO); // the tightest honest 24h+ point
  });
});

describe("netContributionsBetween", () => {
  const from = "2026-07-04T09:00:00.000Z";
  const to = "2026-07-05T12:00:00.000Z";

  it("sums deposits minus withdrawals inside (from, to]", () => {
    const net = netContributionsBetween(
      [
        txn({ id: "d", kind: "deposit", amountMinor: 5000, dateISO: "2026-07-04T12:00:00.000Z" }),
        txn({ id: "w", kind: "withdrawal", amountMinor: 2000, dateISO: "2026-07-05T08:00:00.000Z" }),
      ],
      from,
      to,
    );
    expect(net).toBe(3000);
  });

  it("excludes events at/before the start (exclusive) and after the end", () => {
    const net = netContributionsBetween(
      [
        txn({ id: "atStart", kind: "deposit", amountMinor: 999, dateISO: from }), // == from -> excluded
        txn({ id: "after", kind: "deposit", amountMinor: 999, dateISO: "2026-07-06T00:00:00.000Z" }),
        txn({ id: "in", kind: "deposit", amountMinor: 100, dateISO: "2026-07-04T20:00:00.000Z" }),
      ],
      from,
      to,
    );
    expect(net).toBe(100);
  });

  it("includes an event dated exactly at the end (inclusive)", () => {
    const net = netContributionsBetween(
      [txn({ id: "atEnd", kind: "deposit", amountMinor: 100, dateISO: to })],
      from,
      to,
    );
    expect(net).toBe(100);
  });

  it("ignores interest / fee / other kinds", () => {
    const net = netContributionsBetween(
      [
        txn({ id: "i", kind: "interest", amountMinor: 50, dateISO: "2026-07-04T20:00:00.000Z" }),
        txn({ id: "f", kind: "fee", amountMinor: 20, dateISO: "2026-07-04T21:00:00.000Z" }),
        txn({ id: "o", kind: "other", amountMinor: 99, dateISO: "2026-07-04T22:00:00.000Z" }),
      ],
      from,
      to,
    );
    expect(net).toBe(0);
  });
});

describe("computeLiveDaySummary", () => {
  it("returns null without a 24h+ snapshot pair (card stays SYNC PENDING)", () => {
    expect(computeLiveDaySummary([snap("2026-07-05T12:00:00.000Z", 10000)], [])).toBeNull();
  });

  it("delta is the value change with in-window contributions netted out", () => {
    const prior = snap("2026-07-04T09:00:00.000Z", 10000);
    const latest = snap("2026-07-05T12:00:00.000Z", 10800);
    // +£8.00 raw value change, but £5.00 of it was a deposit — real gain is £3.00
    const day = computeLiveDaySummary(
      [prior, latest],
      [txn({ id: "d", kind: "deposit", amountMinor: 500, dateISO: "2026-07-04T20:00:00.000Z" })],
    );
    expect(day).not.toBeNull();
    expect(day!.deltaMinor).toBe(300); // 10800 - 10000 - 500
    // pct over the at-risk base: prior (10000) + contributions (500) = 10500
    expect(day!.pct).toBeCloseTo(300 / 10500, 10);
  });

  it("a pure top-up with no market move reads flat, not a gain", () => {
    const day = computeLiveDaySummary(
      [snap("2026-07-04T09:00:00.000Z", 10000), snap("2026-07-05T12:00:00.000Z", 12000)],
      [txn({ id: "d", kind: "deposit", amountMinor: 2000, dateISO: "2026-07-05T08:00:00.000Z" })],
    );
    expect(day!.deltaMinor).toBe(0); // 12000 - 10000 - 2000 -> the whole rise was the deposit
  });

  it("a withdrawal inside the window is added back so it isn't read as a loss", () => {
    const day = computeLiveDaySummary(
      [snap("2026-07-04T09:00:00.000Z", 10000), snap("2026-07-05T12:00:00.000Z", 9500)],
      [txn({ id: "w", kind: "withdrawal", amountMinor: 500, dateISO: "2026-07-05T08:00:00.000Z" })],
    );
    // value fell 500 but that WAS the withdrawal -> genuine move is 0
    expect(day!.deltaMinor).toBe(0); // 9500 - 10000 - (-500)
  });

  it("guards a non-positive base with pct 0 (never divides by zero)", () => {
    // prior value 0 and no contributions -> base 0
    const day = computeLiveDaySummary(
      [snap("2026-07-04T09:00:00.000Z", 0), snap("2026-07-05T12:00:00.000Z", 100)],
      [],
    );
    expect(day!.deltaMinor).toBe(100);
    expect(day!.pct).toBe(0);
  });
});
