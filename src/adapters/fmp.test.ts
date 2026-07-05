/* =========================================================================
   FMP ADAPTER — pure-logic unit tests: cache keying + freshness, HTTP-200
   body-error classification (bad key / rate-limit / paid-endpoint), defensive
   quote normalization, and the exported cache controls. The network path is
   NOT exercised here (no key, no fetch) — this covers the code that decides how
   the app stays honest and under-budget.
   ========================================================================= */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __test,
  fmpCache,
  TTL,
  FmpAuthError,
  FmpRateLimitError,
  FmpEndpointUnavailable,
  FmpError,
} from "./fmp";

const { cacheKey, classifyBodyError, normalizeQuote, num, str } = __test;

beforeEach(() => {
  fmpCache.clear();
});

describe("cacheKey", () => {
  it("is order-independent in args (sorted keys)", () => {
    expect(cacheKey("quote", { b: 2, a: 1 })).toBe(cacheKey("quote", { a: 1, b: 2 }));
  });
  it("distinguishes endpoints and arg values", () => {
    expect(cacheKey("quote", { symbols: "AAPL" })).not.toBe(cacheKey("quote", { symbols: "MSFT" }));
    expect(cacheKey("profile", { symbol: "AAPL" })).not.toBe(cacheKey("quote", { symbol: "AAPL" }));
  });
  it("has no args form", () => {
    expect(cacheKey("economic_calendar", {})).toBe("economic_calendar");
  });
});

describe("classifyBodyError", () => {
  it("maps the free-tier Limit Reach note to a rate-limit error", () => {
    const err = classifyBodyError({ "Error Message": "Limit Reach. Please upgrade your plan." }, "quote");
    // "upgrade" also matches endpoint-unavailable, but rate-limit is checked first
    expect(err).toBeInstanceOf(FmpRateLimitError);
  });
  it("maps an invalid-key note to an auth error", () => {
    const err = classifyBodyError({ "Error Message": "Invalid API KEY." }, "quote");
    expect(err).toBeInstanceOf(FmpAuthError);
  });
  it("maps an exclusive/premium-endpoint note to endpoint-unavailable", () => {
    const err = classifyBodyError(
      { "Error Message": "This is an Exclusive Endpoint, please upgrade." },
      "economic_calendar",
    );
    // "upgrade" is present but "exclusive endpoint" resolves to unavailable only
    // when rate/auth patterns don't match first — here neither does.
    expect(err).toBeInstanceOf(FmpEndpointUnavailable);
    expect((err as FmpEndpointUnavailable).endpoint).toBe("economic_calendar");
  });
  it("returns a generic FmpError for an unclassified message", () => {
    const err = classifyBodyError({ "Error Message": "Something odd happened" }, "quote");
    expect(err).toBeInstanceOf(FmpError);
    expect(err?.message).toContain("Something odd happened");
    expect(err).not.toBeInstanceOf(FmpAuthError);
  });
  it("returns null for a clean body (array or object with no error field)", () => {
    expect(classifyBodyError([{ symbol: "AAPL" }], "quote")).toBeNull();
    expect(classifyBodyError({ symbol: "AAPL", price: 100 }, "quote")).toBeNull();
    expect(classifyBodyError(null, "quote")).toBeNull();
  });
});

describe("defensive field parsers", () => {
  it("num coerces numeric strings and rejects junk", () => {
    expect(num(12.5)).toBe(12.5);
    expect(num("12.5")).toBe(12.5);
    expect(num("")).toBeNull();
    expect(num("abc")).toBeNull();
    expect(num(NaN)).toBeNull();
    expect(num(undefined)).toBeNull();
  });
  it("str keeps non-empty strings only", () => {
    expect(str("AAPL")).toBe("AAPL");
    expect(str("  ")).toBeNull();
    expect(str(42)).toBeNull();
  });
});

describe("normalizeQuote", () => {
  it("normalizes a full quote and keeps raw", () => {
    const raw = { symbol: "AAPL", price: 190.1, changesPercentage: 1.2, name: "Apple Inc." };
    const q = normalizeQuote(raw);
    expect(q.symbol).toBe("AAPL");
    expect(q.price).toBe(190.1);
    expect(q.changesPercentage).toBe(1.2);
    expect(q.name).toBe("Apple Inc.");
    expect(q.raw).toBe(raw);
  });
  it("tolerates a sparse/garbage payload without throwing", () => {
    const q = normalizeQuote({ symbol: "X" });
    expect(q.symbol).toBe("X");
    expect(q.price).toBeNull();
    expect(q.marketCap).toBeNull();
    // completely empty
    const empty = normalizeQuote({});
    expect(empty.symbol).toBe("");
    expect(empty.price).toBeNull();
  });
});

describe("fmpCache (in-memory path — node has no localStorage)", () => {
  it("peekFresh returns undefined before any write", () => {
    expect(fmpCache.peekFresh("quote", { symbols: "AAPL" })).toBeUndefined();
  });
  it("ttl constants are sane (5 min quotes, 24 h day-cache)", () => {
    expect(TTL.QUOTE_MS).toBe(5 * 60 * 1000);
    expect(TTL.DAY_MS).toBe(24 * 60 * 60 * 1000);
  });
  it("clear() empties the cache", () => {
    // peek on a missing key is undefined; clear must not throw
    expect(() => fmpCache.clear()).not.toThrow();
    expect(fmpCache.peek("quote", { symbols: "AAPL" })).toBeUndefined();
    expect(fmpCache.ageMs("quote", { symbols: "AAPL" })).toBeNull();
  });
});
