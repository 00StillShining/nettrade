/* =========================================================================
   TRADING 212 HISTORY ADAPTER — pure-logic unit tests for the three paginated
   history feeds (orders / dividends / transactions). Covers defensive
   normalization (happy paths, side detection from sign AND explicit field, fee
   summation, minor-unit rounding), opaque-cursor extraction (from a full
   nextPagePath AND from a bare token), unparseable-item skipping, and empty
   pages. A small number of tests drive the real fetchers with a mocked
   @tauri-apps/plugin-http + fake timers so the cursor round-trip and the
   { items, nextPagePath } envelope are exercised WITHOUT paying the 10s pacing.
   No credentials, no real network.
   ========================================================================= */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock the Tauri HTTP plugin BEFORE importing the adapter. Each test seats a
//     queue of Response-likes; the fetcher consumes them in order. ---
const httpFetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => httpFetchMock(...args),
}));

import {
  __historyTest,
  fetchOrderHistoryPage,
  fetchDividendsPage,
  fetchTransactionsPage,
} from "./trading212";

const {
  normalizeOrderFill,
  normalizeDividend,
  normalizeTransaction,
  txnKind,
  extractCursor,
  historyQuery,
  sumFeesMinor,
  toMinor,
  HISTORY_MIN_REQUEST_INTERVAL_MS,
  HISTORY_PAGE_LIMIT,
} = __historyTest;

const CREDS = { apiKey: "k", apiSecret: "s" } as const;

/** A minimal fetch Response stand-in good enough for the adapter's `res.ok`/`res.json()`. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

/* ============================ ORDER NORMALIZER ============================ */

describe("normalizeOrderFill — the REAL nested {order, fill} shape (captured live 2026-07-05)", () => {
  // Field-for-field mirror of a real /equity/history/orders row from the
  // skipped-sample diagnostic (values altered). THE regression test: the flat
  // first-guess normalizer skipped 100% of real rows.
  const REAL = {
    order: {
      id: 53554138761,
      strategy: "VALUE",
      type: "MARKET",
      ticker: "TSM_US_EQ",
      status: "FILLED",
      value: 24.5,
      filledValue: 24.5,
      currency: "GBP",
      extendedHours: false,
      initiatedFrom: "AUTOINVEST",
      side: "BUY",
      createdAt: "2026-07-02T15:35:11.000Z",
      instrument: {
        ticker: "TSM_US_EQ",
        name: "Taiwan Semiconductor Manufacturing",
        isin: "US8740391003",
        currency: "USD",
      },
    },
    fill: {
      id: 53563904197,
      quantity: 0.0734382,
      price: 445.42,
      type: "TRADE",
      tradingMethod: "OTC",
      filledAt: "2026-07-02T15:35:12.000Z",
      walletImpact: {
        currency: "GBP",
        netValue: 24.5,
        fxRate: 1.33731983,
        taxes: [
          { name: "CURRENCY_CONVERSION_FEE", quantity: -0.04, currency: "GBP", chargedAt: "2026-07-02T15:35:12.405Z" },
        ],
      },
    },
  };

  it("parses every field from the nested pair", () => {
    const o = normalizeOrderFill(REAL)!;
    expect(o).not.toBeNull();
    expect(o.id).toBe("53563904197"); // the FILL's own id, stringified (numeric in the feed)
    expect(o.ticker).toBe("TSM_US_EQ");
    expect(o.dateISO).toBe("2026-07-02T15:35:12.000Z"); // filledAt beats createdAt
    expect(o.side).toBe("buy"); // explicit order.side
    expect(o.quantity).toBeCloseTo(0.0734382);
    expect(o.fillPriceMinor).toBe(44542); // instrument-ccy (USD) minor units
    expect(o.filledValueMinor).toBe(2450); // account-ccy (GBP) minor units
    expect(o.feeMinor).toBe(4); // |−0.04| from walletImpact.taxes
    expect(o.status).toBe("FILLED");
    expect(o.raw).toBe(REAL);
  });

  it("a SELL row and a fill-less (cancelled) row behave honestly", () => {
    const sell = normalizeOrderFill({
      order: { ...REAL.order, id: 1, side: "SELL" },
      fill: { ...REAL.fill, id: 2 },
    })!;
    expect(sell.side).toBe("sell");
    // no fill object at all (e.g. a cancelled order in history): still parses
    // via order-level fields, and its non-FILLED status excludes it downstream.
    const cancelled = normalizeOrderFill({
      order: { ...REAL.order, id: 3, status: "CANCELLED", filledValue: 0 },
    })!;
    expect(cancelled).not.toBeNull();
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.id).toMatch(/^ord:3:/); // order-id fallback, disambiguated
  });
});

describe("normalizeOrderFill — happy path", () => {
  it("normalizes a full nested-instrument order and keeps raw", () => {
    const raw = {
      fillId: "F-1",
      id: "O-1",
      dateExecuted: "2026-01-02T10:00:00Z",
      instrument: { ticker: "AAPL_US_EQ" },
      filledQuantity: 3,
      fillPrice: 285.92118846,
      filledValue: 857.76,
      taxes: [{ quantity: 0.5 }],
      status: "FILLED",
    };
    const o = normalizeOrderFill(raw)!;
    expect(o.id).toBe("F-1"); // fillId preferred over order id
    expect(o.dateISO).toBe("2026-01-02T10:00:00Z");
    expect(o.ticker).toBe("AAPL_US_EQ"); // raw ticker; cleaning happens in TruthStore
    expect(o.side).toBe("buy");
    expect(o.quantity).toBe(3);
    expect(o.fillPriceMinor).toBe(28592); // 285.92118846 -> round(28592.11) = 28592
    expect(o.filledValueMinor).toBe(85776);
    expect(o.feeMinor).toBe(50);
    expect(o.status).toBe("FILLED");
    expect(o.raw).toBe(raw);
  });

  it("falls back to a top-level ticker and disambiguates a bare order id with date+qty", () => {
    const o = normalizeOrderFill({
      id: "O-9",
      dateCreated: "2026-02-01T00:00:00Z",
      ticker: "TSLA_US_EQ",
      quantity: 1,
      price: 100,
      value: 100,
    })!;
    // no fillId -> order id + per-row content: one order can produce SEVERAL
    // fills, so a bare `ord:O-9` would collide siblings on the DB primary key
    // and INSERT OR REPLACE would silently drop real executed volume.
    expect(o.id).toBe("ord:O-9:2026-02-01T00:00:00Z:1");
    expect(o.ticker).toBe("TSLA_US_EQ");
    expect(o.dateISO).toBe("2026-02-01T00:00:00Z");
  });

  it("two fills of ONE order (no fillId) get distinct ids — no PK collision", () => {
    const base = { id: "O-9", ticker: "TSLA_US_EQ", price: 100, value: 100 };
    const a = normalizeOrderFill({ ...base, dateCreated: "2026-02-01T00:00:00Z", quantity: 1 })!;
    const b = normalizeOrderFill({ ...base, dateCreated: "2026-02-01T00:05:00Z", quantity: 2 })!;
    expect(a.id).not.toBe(b.id);
  });
});

describe("normalizeOrderFill — side detection", () => {
  it("infers SELL from a negative quantity", () => {
    const o = normalizeOrderFill({
      id: "O-2",
      dateExecuted: "2026-01-03T00:00:00Z",
      ticker: "MSFT_US_EQ",
      filledQuantity: -4,
      fillPrice: 10,
    })!;
    expect(o.side).toBe("sell");
    expect(o.quantity).toBe(4); // returned as absolute value
  });

  it("infers BUY from a positive quantity when no explicit side", () => {
    const o = normalizeOrderFill({
      id: "O-3",
      dateExecuted: "2026-01-03T00:00:00Z",
      ticker: "MSFT_US_EQ",
      filledQuantity: 4,
      fillPrice: 10,
    })!;
    expect(o.side).toBe("buy");
  });

  it("uses an explicit SELL side field even when quantity is positive", () => {
    const o = normalizeOrderFill({
      id: "O-4",
      dateExecuted: "2026-01-03T00:00:00Z",
      ticker: "MSFT_US_EQ",
      direction: "SELL",
      filledQuantity: 4, // positive — explicit field must win
      fillPrice: 10,
    })!;
    expect(o.side).toBe("sell");
    expect(o.quantity).toBe(4);
  });

  it("reads an explicit side from a `type` field containing BUY", () => {
    const o = normalizeOrderFill({
      id: "O-5",
      dateExecuted: "2026-01-03T00:00:00Z",
      ticker: "MSFT_US_EQ",
      type: "MARKET_BUY",
      filledQuantity: -2, // negative — explicit BUY must still win
      fillPrice: 10,
    })!;
    expect(o.side).toBe("buy");
  });
});

describe("normalizeOrderFill — fee summation", () => {
  it("sums taxes[] and fees[] across `quantity`/`amount` legs, always positive", () => {
    const o = normalizeOrderFill({
      id: "O-6",
      dateExecuted: "2026-01-03T00:00:00Z",
      ticker: "AAPL_US_EQ",
      filledQuantity: 1,
      fillPrice: 10,
      taxes: [{ quantity: 0.5 }, { quantity: 0.25 }],
      fees: [{ amount: 0.1 }, { amount: -0.2 }], // signs ignored — fees are positive
    })!;
    // 50 + 25 + 10 + 20 = 105 minor
    expect(o.feeMinor).toBe(105);
  });

  it("treats a missing fee array as zero fees", () => {
    const o = normalizeOrderFill({
      id: "O-7",
      dateExecuted: "2026-01-03T00:00:00Z",
      ticker: "AAPL_US_EQ",
      filledQuantity: 1,
      fillPrice: 10,
    })!;
    expect(o.feeMinor).toBe(0);
  });
});

describe("normalizeOrderFill — non-filled rows are kept, unusable rows skipped", () => {
  it("returns a NON-executed row with its status (does not drop it)", () => {
    const o = normalizeOrderFill({
      id: "O-8",
      dateExecuted: "2026-01-03T00:00:00Z",
      ticker: "AAPL_US_EQ",
      filledQuantity: 0,
      fillPrice: 10,
      status: "REJECTED",
    })!;
    expect(o).not.toBeNull();
    expect(o.status).toBe("REJECTED");
  });

  it("skips a row with no ticker", () => {
    expect(
      normalizeOrderFill({ id: "x", dateExecuted: "2026-01-03T00:00:00Z", filledQuantity: 1 }),
    ).toBeNull();
  });

  it("skips a row with an unparseable date", () => {
    expect(
      normalizeOrderFill({ id: "x", ticker: "AAPL_US_EQ", dateExecuted: "not-a-date", filledQuantity: 1 }),
    ).toBeNull();
  });

  it("skips a row with no usable id", () => {
    expect(
      normalizeOrderFill({ ticker: "AAPL_US_EQ", dateExecuted: "2026-01-03T00:00:00Z", filledQuantity: 1 }),
    ).toBeNull();
  });

  it("skips non-object input", () => {
    expect(normalizeOrderFill(null)).toBeNull();
    expect(normalizeOrderFill(42)).toBeNull();
    expect(normalizeOrderFill("nope")).toBeNull();
  });
});

/* ============================ DIVIDEND NORMALIZER ============================ */

describe("normalizeDividend", () => {
  it("normalizes a full dividend and keeps raw", () => {
    const raw = {
      reference: "D-1",
      paidOn: "2026-03-01T00:00:00Z",
      ticker: "AAPL_US_EQ",
      amount: 12.34,
      quantity: 10,
      grossAmountPerShare: 1.234,
      type: "ORDINARY",
    };
    const d = normalizeDividend(raw)!;
    expect(d.id).toBe("D-1");
    expect(d.dateISO).toBe("2026-03-01T00:00:00Z");
    expect(d.ticker).toBe("AAPL_US_EQ");
    expect(d.amountMinor).toBe(1234);
    expect(d.quantity).toBe(10);
    expect(d.grossPerShareMinor).toBe(123); // 1.234 -> round(123.4) = 123
    expect(d.type).toBe("ORDINARY");
    expect(d.raw).toBe(raw);
  });

  it("falls back to id + date and nulls optional fields when absent", () => {
    const d = normalizeDividend({ id: "D-2", date: "2026-03-02T00:00:00Z", ticker: "MSFT_US_EQ", amount: 1 })!;
    expect(d.id).toBe("D-2");
    expect(d.dateISO).toBe("2026-03-02T00:00:00Z");
    expect(d.quantity).toBeNull();
    expect(d.grossPerShareMinor).toBeNull();
    expect(d.type).toBeNull();
  });

  it("skips on missing ticker / unparseable date / missing id", () => {
    expect(normalizeDividend({ reference: "x", paidOn: "2026-03-01T00:00:00Z", amount: 1 })).toBeNull();
    expect(normalizeDividend({ reference: "x", ticker: "AAPL_US_EQ", paidOn: "nope", amount: 1 })).toBeNull();
    expect(normalizeDividend({ ticker: "AAPL_US_EQ", paidOn: "2026-03-01T00:00:00Z", amount: 1 })).toBeNull();
  });
});

/* ============================ TRANSACTION NORMALIZER ============================ */

describe("txnKind mapping", () => {
  it("maps DEPOSIT/TOP_UP -> deposit", () => {
    expect(txnKind("DEPOSIT")).toBe("deposit");
    expect(txnKind("TOP_UP")).toBe("deposit");
    expect(txnKind("card top_up")).toBe("deposit");
  });
  it("maps WITHDRAW/WITHDRAWAL -> withdrawal", () => {
    expect(txnKind("WITHDRAW")).toBe("withdrawal");
    expect(txnKind("WITHDRAWAL")).toBe("withdrawal");
  });
  it("maps any *INTEREST* -> interest", () => {
    expect(txnKind("INTEREST")).toBe("interest");
    expect(txnKind("INTEREST_ON_CASH")).toBe("interest");
    expect(txnKind("CASH_INTEREST")).toBe("interest");
  });
  it("maps FEE -> fee", () => {
    expect(txnKind("FEE")).toBe("fee");
    expect(txnKind("CURRENCY_CONVERSION_FEE")).toBe("fee");
  });
  it("maps anything else -> other", () => {
    expect(txnKind("DIVIDEND")).toBe("other");
    expect(txnKind(undefined)).toBe("other");
    expect(txnKind("")).toBe("other");
  });
});

describe("normalizeTransaction", () => {
  it("normalizes a deposit, storing amount ABS", () => {
    const raw = { reference: "T-1", dateTime: "2026-01-01T00:00:00Z", type: "DEPOSIT", amount: 500 };
    const t = normalizeTransaction(raw)!;
    expect(t.id).toBe("T-1");
    expect(t.dateISO).toBe("2026-01-01T00:00:00Z");
    expect(t.kind).toBe("deposit");
    expect(t.amountMinor).toBe(50000);
    expect(t.reference).toBe("T-1");
    expect(t.raw).toBe(raw);
  });

  it("stores a negative withdrawal amount as a positive minor value", () => {
    const t = normalizeTransaction({ reference: "T-2", date: "2026-01-02T00:00:00Z", type: "WITHDRAWAL", amount: -250 })!;
    expect(t.kind).toBe("withdrawal");
    expect(t.amountMinor).toBe(25000); // ABS — direction is carried by `kind`
  });

  it("skips on unparseable date / missing id", () => {
    expect(normalizeTransaction({ reference: "x", dateTime: "nope", type: "DEPOSIT", amount: 1 })).toBeNull();
    expect(normalizeTransaction({ dateTime: "2026-01-01T00:00:00Z", type: "DEPOSIT", amount: 1 })).toBeNull();
  });
});

/* ============================ FEE SUMMATION (unit) ============================ */

describe("sumFeesMinor", () => {
  it("returns 0 for non-arrays and empty arrays", () => {
    expect(sumFeesMinor(undefined)).toBe(0);
    expect(sumFeesMinor(null)).toBe(0);
    expect(sumFeesMinor([])).toBe(0);
    expect(sumFeesMinor("nope")).toBe(0);
  });
  it("sums `quantity` legs and ignores unparseable entries", () => {
    expect(sumFeesMinor([{ quantity: 0.5 }, { nope: 1 }, null, { quantity: 0.25 }])).toBe(75);
  });
  it("prefers quantity but falls back to amount, always positive", () => {
    expect(sumFeesMinor([{ amount: -1 }, { quantity: 2 }])).toBe(300);
  });
});

/* ============================ MINOR-UNIT ROUNDING ============================ */

describe("toMinor rounding (shared helper, re-exported for history tests)", () => {
  it("rounds 285.92118846 -> 28592", () => {
    expect(toMinor(285.92118846)).toBe(28592);
  });
  it("half-rounds and handles junk defensively", () => {
    expect(toMinor(1.005)).toBe(101); // decimal.js round of 100.5 -> 101
    expect(toMinor(undefined)).toBe(0);
    expect(toMinor(null)).toBe(0);
    expect(toMinor(NaN)).toBe(0);
  });
});

/* ============================ CURSOR EXTRACTION ============================ */

describe("extractCursor — round-trips the WHOLE query as the opaque token", () => {
  // WHY: some feeds paginate with MORE than a cursor param (transactions carry
  // cursor + time); lifting only `cursor` built a resume token the server
  // rejected, which froze the transactions back-fill at one page.
  it("keeps every query param from a full nextPagePath", () => {
    expect(extractCursor("/equity/history/orders?limit=50&cursor=ABC123")).toBe("limit=50&cursor=ABC123");
  });
  it("keeps every param from an absolute URL form too", () => {
    expect(extractCursor("https://live.trading212.com/api/v0/history/dividends?cursor=XYZ&limit=50")).toBe("cursor=XYZ&limit=50");
  });
  it("preserves MULTI-PARAM pagination (the transactions cursor+time shape)", () => {
    expect(extractCursor("/history/transactions?cursor=123&time=2026-06-07T01:21:07.902Z&limit=50")).toBe(
      "cursor=123&time=2026-06-07T01:21:07.902Z&limit=50",
    );
  });
  it("treats a bare token (no query) as the whole opaque cursor", () => {
    expect(extractCursor("opaque-bare-token-42")).toBe("opaque-bare-token-42");
  });
  it("returns null at end of feed (null / empty / non-string / empty query)", () => {
    expect(extractCursor(null)).toBeNull();
    expect(extractCursor("")).toBeNull();
    expect(extractCursor("   ")).toBeNull();
    expect(extractCursor(undefined)).toBeNull();
    expect(extractCursor(42)).toBeNull();
    expect(extractCursor("/orders?")).toBeNull();
  });
});

/* ============================ QUERY BUILDING ============================ */

describe("historyQuery", () => {
  it("defaults limit to the page max and omits cursor when absent", () => {
    expect(historyQuery(null, undefined)).toBe(`limit=${HISTORY_PAGE_LIMIT}`);
    expect(historyQuery(undefined, undefined)).toBe(`limit=${HISTORY_PAGE_LIMIT}`);
  });
  it("clamps limit into [1, HISTORY_PAGE_LIMIT]", () => {
    expect(historyQuery(null, 0)).toBe("limit=1");
    expect(historyQuery(null, 999)).toBe(`limit=${HISTORY_PAGE_LIMIT}`);
    expect(historyQuery(null, 20)).toBe("limit=20");
  });
  it("replays a full-query token BYTE-FOR-BYTE (no re-encoding — the API 404s on %3A times)", () => {
    // The observed live failure: URLSearchParams re-encoding turned the time
    // param's colons into %3A and /history/transactions returned 404 at page 3.
    const token = "cursor=123&time=2026-06-07T01:21:07.902Z&limit=50";
    expect(historyQuery(token, 50)).toBe(token); // verbatim, colons intact
  });
  it("appends limit only when the token lacks one", () => {
    expect(historyQuery("cursor=123&time=T1", 50)).toBe("cursor=123&time=T1&limit=50");
  });
  it("tolerates a token that is a path?query (keeps the query part verbatim)", () => {
    expect(historyQuery("/orders?cursor=A&time=T1", 50)).toBe("cursor=A&time=T1&limit=50");
  });
  it("treats a LEGACY bare token (persisted by older builds) as the cursor value", () => {
    expect(historyQuery("ABC123", 50)).toBe("limit=50&cursor=ABC123");
  });
});

/* ============================ FETCHERS (mocked http, fake timers) ============================
   These exercise the real fetchHistoryPage path: envelope parsing, per-item
   normalization + skipping, and cursor extraction — without paying the 10s
   pacing (fake timers auto-advance the paceRequest sleep). Because the module's
   pacing clock is shared/global, we advance timers around each awaited call. */

describe("fetchOrderHistoryPage — envelope + cursor round-trip", () => {
  beforeEach(() => {
    httpFetchMock.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses { items, nextPagePath }, skips bad rows, and extracts the cursor", async () => {
    httpFetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            fillId: "F-1",
            dateExecuted: "2026-01-02T10:00:00Z",
            instrument: { ticker: "AAPL_US_EQ" },
            filledQuantity: 3,
            fillPrice: 285.92118846,
            filledValue: 857.76,
            status: "FILLED",
          },
          { garbage: true }, // unparseable -> skipped, not thrown
        ],
        nextPagePath: "/equity/history/orders?limit=50&cursor=NEXT99",
      }),
    );

    const p = fetchOrderHistoryPage(CREDS, "demo", null, 50);
    await vi.runAllTimersAsync(); // flush the paceRequest sleep (if any)
    const page = await p;

    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe("F-1");
    expect(page.items[0].fillPriceMinor).toBe(28592);
    // the WHOLE query round-trips as the opaque token (multi-param pagination)
    expect(page.nextCursor).toBe("limit=50&cursor=NEXT99");

    // The request carried limit + no inbound cursor on the first page.
    const url = httpFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/equity/history/orders?");
    expect(url).toContain("limit=50");
    expect(url).not.toContain("cursor=");
  });

  it("feeds an opaque cursor back into the next request and returns null at feed end", async () => {
    httpFetchMock.mockResolvedValueOnce(jsonResponse({ items: [], nextPagePath: null }));

    const p = fetchOrderHistoryPage(CREDS, "demo", "NEXT99", 50);
    await vi.runAllTimersAsync();
    const page = await p;

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull(); // end of feed

    const url = httpFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("cursor=NEXT99");
  });

  it("tolerates a bare-array body (older shape) as items with no cursor", async () => {
    httpFetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "O-1",
          dateExecuted: "2026-01-02T10:00:00Z",
          ticker: "AAPL_US_EQ",
          filledQuantity: 1,
          fillPrice: 10,
        },
      ]),
    );
    const p = fetchOrderHistoryPage(CREDS, "demo");
    await vi.runAllTimersAsync();
    const page = await p;
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("throws a kind-only error (no key material) on a non-ok response", async () => {
    httpFetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    const p = fetchOrderHistoryPage(CREDS, "demo");
    // Attach the rejection expectation BEFORE flushing timers so the rejection
    // is never momentarily unhandled. The error string carries only the failure
    // kind + status — no key material.
    // the message now includes the QUERY (pagination state only — no secrets)
    // so paging failures self-diagnose from the persisted error.
    const assertion = expect(p).rejects.toThrow(/orders\?limit=50 failed \(500\)/);
    await vi.runAllTimersAsync();
    await assertion;
  });
});

describe("fetchDividendsPage / fetchTransactionsPage — envelope wiring", () => {
  beforeEach(() => {
    httpFetchMock.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dividends: empty page yields no items and a null cursor", async () => {
    httpFetchMock.mockResolvedValueOnce(jsonResponse({ items: [], nextPagePath: null }));
    const p = fetchDividendsPage(CREDS, "demo");
    await vi.runAllTimersAsync();
    const page = await p;
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect((httpFetchMock.mock.calls[0][0] as string)).toContain("/history/dividends?");
  });

  it("transactions: normalizes a deposit and extracts a bare-token cursor", async () => {
    httpFetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [{ reference: "T-1", dateTime: "2026-01-01T00:00:00Z", type: "DEPOSIT", amount: 500 }],
        nextPagePath: "bare-token-77",
      }),
    );
    const p = fetchTransactionsPage(CREDS, "demo");
    await vi.runAllTimersAsync();
    const page = await p;
    expect(page.items).toHaveLength(1);
    expect(page.items[0].kind).toBe("deposit");
    expect(page.items[0].amountMinor).toBe(50000);
    expect(page.nextCursor).toBe("bare-token-77");
    expect((httpFetchMock.mock.calls[0][0] as string)).toContain("/history/transactions?");
  });
});

/* ============================ CONSTANTS SANITY ============================ */

describe("history pacing constants", () => {
  it("enforces the strict 10s history budget and 50-item page max", () => {
    expect(HISTORY_MIN_REQUEST_INTERVAL_MS).toBe(10_000);
    expect(HISTORY_PAGE_LIMIT).toBe(50);
  });
});
