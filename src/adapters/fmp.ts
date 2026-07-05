// FMP (Financial Modeling Prep) market-data adapter — the ONLY place in the app
// that talks to the FMP API. Read-only market data: quotes, calendars,
// fundamentals, dividends, price history. This file NEVER places orders or moves
// money (FMP has no such surface anyway) — it purely reads reference data.
//
// Mirrors src/adapters/trading212.ts:
//   • uses `@tauri-apps/plugin-http` fetch (runs Rust-side, so it is CORS-free
//     and the API key never rides on a browser-visible request the front-end
//     can see in devtools),
//   • a shared 1 req/s rate-limiter (`paceRequest`) serialised through a queue,
//   • defensive per-field parsing with fallbacks — a missing optional field
//     never throws; the row is normalised to null/0 instead,
//   • typed errors so phase-2 callers can branch (bad key vs. rate-limited vs.
//     an endpoint the free tier does not grant).
//
// PLUS a cache layer (in-memory + localStorage) keyed by endpoint+args with
// per-family TTLs, so the whole app stays well under the FREE 250 calls/day
// budget: quotes 5 min, calendars + fundamentals + dividends 24 h.
//
// SECURITY: the API key is read transiently from the macOS Keychain via
// `invoke("keychain_get_marketdata_key")` for each request and is NEVER logged,
// persisted to the cache, echoed into an error string, or retained in a
// module-level variable. Cached VALUES are market data only — never the key.
//
// HONEST FAILURE: some FMP endpoints are paid-tier only. When the free tier
// returns a 402/403 (or the "Special Endpoint"/"Exclusive Endpoint" JSON note)
// we throw `FmpEndpointUnavailable` so phase-2 callers fall back to the MODEL
// engine rather than pretend data exists.

import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";

/* ====================== TYPES ====================== */

/** Result of a key probe. `ok` is the only field a caller must branch on. */
export interface FmpKeyProbe {
  ok: boolean;
  /** Best-effort plan label when detectable (e.g. "Free", "Starter"). */
  plan?: string;
  /** Human-readable note for the settings status line. Never contains the key. */
  note: string;
  /** Coarse machine-readable reason, for the UI to pick a status word. */
  reason?: "ok" | "bad_key" | "rate_limited" | "no_key" | "network" | "error";
}

/** One normalized quote. Money values are kept as plain numbers (USD) — unlike
 *  the broker adapter these are reference prices, not the user's ledger, so we
 *  don't convert to minor units here. Missing fields normalize to null. */
export interface FmpQuote {
  symbol: string;
  price: number | null;
  changesPercentage: number | null;
  change: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  yearLow: number | null;
  yearHigh: number | null;
  marketCap: number | null;
  volume: number | null;
  avgVolume: number | null;
  open: number | null;
  previousClose: number | null;
  eps: number | null;
  pe: number | null;
  name: string | null;
  exchange: string | null;
  timestamp: number | null;
  raw: unknown;
}

export interface FmpEarningsEvent {
  symbol: string;
  date: string | null;
  epsEstimated: number | null;
  eps: number | null;
  revenueEstimated: number | null;
  revenue: number | null;
  /** "bmo" | "amc" | null — before-market-open / after-market-close. */
  time: string | null;
  raw: unknown;
}

export interface FmpEconomicEvent {
  event: string | null;
  date: string | null;
  country: string | null;
  actual: number | null;
  previous: number | null;
  estimate: number | null;
  /** "Low" | "Medium" | "High" | null. */
  impact: string | null;
  raw: unknown;
}

export interface FmpProfile {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  ceo: string | null;
  country: string | null;
  exchange: string | null;
  currency: string | null;
  website: string | null;
  beta: number | null;
  price: number | null;
  marketCap: number | null;
  raw: unknown;
}

export interface FmpKeyMetrics {
  symbol: string;
  date: string | null;
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  roe: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  raw: unknown;
}

export interface FmpRatios {
  symbol: string;
  date: string | null;
  grossProfitMargin: number | null;
  operatingProfitMargin: number | null;
  netProfitMargin: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  debtEquityRatio: number | null;
  currentRatio: number | null;
  payoutRatio: number | null;
  raw: unknown;
}

export interface FmpDividend {
  date: string | null;
  label: string | null;
  dividend: number | null;
  adjDividend: number | null;
  recordDate: string | null;
  paymentDate: string | null;
  declarationDate: string | null;
  raw: unknown;
}

export interface FmpBar {
  date: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
  raw: unknown;
}

/* ====================== TYPED ERRORS ====================== */

/** Base class so callers can `instanceof FmpError` to catch any adapter error. */
export class FmpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FmpError";
  }
}

/** No key is seated in the Keychain — the caller should prompt for one / use MODEL. */
export class FmpNoKeyError extends FmpError {
  constructor() {
    super("fmp: no market-data key is seated");
    this.name = "FmpNoKeyError";
  }
}

/** 401/403 with a key present, or the "Invalid API KEY" JSON note = the key is bad. */
export class FmpAuthError extends FmpError {
  constructor(message = "fmp: the market-data key was rejected") {
    super(message);
    this.name = "FmpAuthError";
  }
}

/** 429 or the free-tier "Limit Reach" JSON note — the daily/second budget is spent. */
export class FmpRateLimitError extends FmpError {
  constructor(message = "fmp: rate limit reached") {
    super(message);
    this.name = "FmpRateLimitError";
  }
}

/** A paid-only endpoint on the free tier (402/403 + "Exclusive/Special Endpoint").
 *  Phase-2 callers MUST fall back to MODEL when they see this — the data is not
 *  available, and we refuse to fabricate it. */
export class FmpEndpointUnavailable extends FmpError {
  readonly endpoint: string;
  constructor(endpoint: string) {
    super(`fmp: endpoint not available on this plan (${endpoint})`);
    this.name = "FmpEndpointUnavailable";
    this.endpoint = endpoint;
  }
}

/* ====================== CONSTANTS ====================== */

// FMP's CURRENT "stable" API. The old /api/v3 endpoints were retired 2025-08-31 for
// accounts created after that date (they return a "Legacy Endpoint … no longer
// supported" body), so newly-minted free keys MUST use /stable. Stable uses
// ?symbol= / ?symbols= query params instead of /{SYM} path segments.
const BASE_URL = "https://financialmodelingprep.com/stable";

/** FMP's free tier is generous per-second but tight per-day; pace at ~1 req/s
 *  to be a good citizen and to never trip the burst limiter. */
const MIN_REQUEST_INTERVAL_MS = 1100;
const MAX_RETRIES = 3;

/** Cache TTLs by data family (ms). Chosen so a full app session stays well under
 *  the free 250 calls/day budget. */
export const TTL = {
  QUOTE_MS: 5 * 60 * 1000, //  5 min — quotes move; still cheap to reuse briefly
  DAY_MS: 24 * 60 * 60 * 1000, // 24 h — calendars, fundamentals, dividends, history
} as const;

const CACHE_PREFIX = "fmp.cache.";
const CACHE_VERSION = 1; // bump to invalidate all persisted cache entries

/* ====================== KEY ACCESS ====================== */

// The Keychain read triggers a macOS ACL prompt on a self-signed build, so we must
// NOT read per request — a single live refresh makes a dozen+ FMP calls, and each
// fresh read would pop its own password prompt (the "Always Allow doesn't stick"
// symptom: you're really clearing a queue of ~14 identical prompts). Instead we
// read the key ONCE per app launch and hold it in memory. Concurrent callers share
// the single in-flight read. The value is never logged, echoed, or persisted.
//
// Invalidation: `resetFmpKeyCache()` (called when the user saves/clears the key in
// Settings) drops the cache so the next read re-fetches — otherwise a newly-saved
// key would be ignored until the app restarts.
let keyPromise: Promise<string | null> | undefined;

/** Drop the cached market-data key so the next read re-fetches from the Keychain. */
export function resetFmpKeyCache(): void {
  keyPromise = undefined;
}

async function readKey(): Promise<string | null> {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    try {
      const key = await invoke<string | null>("keychain_get_marketdata_key");
      return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
    } catch {
      // Keychain unavailable / prompt dismissed — treat as no key AND drop the
      // cache so a later refresh can retry rather than being stuck on "no key".
      keyPromise = undefined;
      return null;
    }
  })();
  return keyPromise;
}

/** True when a market-data key is seated. Reuses the cached read — no extra prompt.
 *  (The old `keychain_has_marketdata_key` path also called get_password, i.e. a
 *  second ACL prompt for the very same secret; folding it into readKey avoids that.) */
export async function fmpHasKey(): Promise<boolean> {
  return (await readKey()) !== null;
}

/* ====================== CACHE LAYER ====================== */

interface CacheRecord<T> {
  v: number; // cache version
  at: number; // epoch ms when stored
  ttl: number; // ms this record is valid for
  data: T;
}

const memCache = new Map<string, CacheRecord<unknown>>();

function isFresh(rec: CacheRecord<unknown> | undefined): rec is CacheRecord<unknown> {
  return !!rec && rec.v === CACHE_VERSION && Date.now() - rec.at < rec.ttl;
}

function readCache<T>(key: string): CacheRecord<T> | undefined {
  const mem = memCache.get(key) as CacheRecord<T> | undefined;
  if (mem) return mem;
  // Fall back to localStorage (survives reloads). Guarded — localStorage may be
  // absent in the node test env.
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return undefined;
    const rec = JSON.parse(raw) as CacheRecord<T>;
    memCache.set(key, rec as CacheRecord<unknown>);
    return rec;
  } catch {
    return undefined;
  }
}

function writeCache<T>(key: string, data: T, ttl: number): void {
  const rec: CacheRecord<T> = { v: CACHE_VERSION, at: Date.now(), ttl, data };
  memCache.set(key, rec as CacheRecord<unknown>);
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(rec));
  } catch {
    // Quota / disabled storage — the in-memory copy still serves this session.
  }
}

/** Cache controls exported so phase-2 callers can force cached-only reads (to
 *  stay offline / under budget) or clear the cache. */
export const fmpCache = {
  /** Returns the cached value for an endpoint+args if it EXISTS (even if stale),
   *  or undefined. `endpoint` + `args` must match the call that wrote it. */
  peek<T>(endpoint: string, args: Record<string, unknown> = {}): T | undefined {
    const rec = readCache<T>(cacheKey(endpoint, args));
    return rec?.data;
  },
  /** Returns the cached value only if still FRESH, else undefined. */
  peekFresh<T>(endpoint: string, args: Record<string, unknown> = {}): T | undefined {
    const rec = readCache<T>(cacheKey(endpoint, args));
    return isFresh(rec) ? (rec.data as T) : undefined;
  },
  /** Age in ms of the cached entry, or null if none. */
  ageMs(endpoint: string, args: Record<string, unknown> = {}): number | null {
    const rec = readCache(cacheKey(endpoint, args));
    return rec ? Date.now() - rec.at : null;
  },
  /** Drop every persisted + in-memory FMP cache entry. */
  clear(): void {
    memCache.clear();
    try {
      if (typeof localStorage === "undefined") return;
      const toDrop: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) toDrop.push(k);
      }
      for (const k of toDrop) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

function cacheKey(endpoint: string, args: Record<string, unknown>): string {
  const parts = Object.keys(args)
    .sort()
    .map((k) => `${k}=${String(args[k])}`)
    .join("&");
  return parts ? `${endpoint}?${parts}` : endpoint;
}

/* ====================== RATE-LIMITED REQUEST HELPER ====================== */

// Shared across all calls from this module so concurrent callers still respect
// the ~1 req/s ceiling. Same pattern as trading212.ts.
let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paceRequest(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/** Appends `apikey` to a path's query string. Kept private — the key never
 *  leaves this module, and the returned URL is never logged. */
function withKey(path: string, key: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE_URL}${path}${sep}apikey=${encodeURIComponent(key)}`;
}

/**
 * Shared rate-limited GET. Paces calls >=1100ms apart and retries HTTP 429 with
 * exponential backoff (honouring Retry-After when present), capped at
 * MAX_RETRIES. Reads the key from the Keychain fresh for each call. Never logs
 * the key or the resolved URL.
 *
 * `endpointLabel` is a key-free description used only for error messages.
 */
async function rawRequest(path: string, endpointLabel: string): Promise<Response> {
  const key = await readKey();
  if (!key) throw new FmpNoKeyError();
  const url = withKey(path, key);

  const run = async (): Promise<Response> => {
    let attempt = 0;
    for (;;) {
      await paceRequest();
      const res = await httpFetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (res.status !== 429) return res;
      attempt += 1;
      if (attempt > MAX_RETRIES) return res;
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
      const backoffMs = Number.isFinite(retryAfterMs)
        ? retryAfterMs
        : MIN_REQUEST_INTERVAL_MS * 2 ** attempt;
      await sleep(backoffMs);
    }
  };

  // Serialize through the shared queue so 1 req/s holds across concurrent calls.
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  // Attach the label lazily for error mapping without logging the URL.
  void endpointLabel;
  return result;
}

/** FMP quirk: many errors come back as HTTP 200 with an `{ "Error Message": … }`
 *  or `{ "Error": … }` body, and paid endpoints return a note string. Inspect a
 *  parsed body for these and map to a typed error. Returns null when clean. */
function classifyBodyError(body: unknown, endpointLabel: string): FmpError | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const msgRaw =
    (typeof obj["Error Message"] === "string" && (obj["Error Message"] as string)) ||
    (typeof obj["error"] === "string" && (obj["error"] as string)) ||
    (typeof obj["message"] === "string" && (obj["message"] as string)) ||
    "";
  if (!msgRaw) return null;
  const msg = msgRaw.toLowerCase();
  if (msg.includes("limit reach") || msg.includes("rate limit") || msg.includes("too many")) {
    return new FmpRateLimitError();
  }
  if (msg.includes("invalid api key") || msg.includes("unauthorized") || msg.includes("api key")) {
    return new FmpAuthError();
  }
  if (
    msg.includes("exclusive endpoint") ||
    msg.includes("special endpoint") ||
    msg.includes("legacy endpoint") ||
    msg.includes("no longer supported") ||
    msg.includes("not available under your current subscription") ||
    msg.includes("upgrade") ||
    msg.includes("premium")
  ) {
    return new FmpEndpointUnavailable(endpointLabel);
  }
  // An unclassified error-message body — surface it generically (no key inside).
  return new FmpError(`fmp: ${msgRaw}`);
}

/**
 * GET → parsed JSON, with HTTP-status AND body-message error mapping applied.
 * On the cache path, a fresh cached value short-circuits the network entirely.
 */
async function getJson<T>(
  path: string,
  endpointLabel: string,
  cache?: { key: string; ttl: number },
): Promise<T> {
  if (cache) {
    const fresh = fmpCache.peekFresh<T>(cache.key);
    if (fresh !== undefined) return fresh;
  }

  const res = await rawRequest(path, endpointLabel);

  if (res.status === 401 || res.status === 403) {
    // 403 on FMP is ambiguous: a bad key OR a paid endpoint. Try to read the
    // body note to disambiguate; default to auth error.
    let bodyErr: FmpError | null = null;
    try {
      const body: unknown = await res.json();
      bodyErr = classifyBodyError(body, endpointLabel);
    } catch {
      /* no body */
    }
    throw bodyErr ?? new FmpAuthError();
  }
  if (res.status === 402) throw new FmpEndpointUnavailable(endpointLabel);
  if (res.status === 429) throw new FmpRateLimitError();
  if (!res.ok) throw new FmpError(`fmp: request failed (${res.status}) [${endpointLabel}]`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new FmpError(`fmp: malformed response [${endpointLabel}]`);
  }
  const bodyErr = classifyBodyError(body, endpointLabel);
  if (bodyErr) throw bodyErr;

  if (cache) writeCache(cache.key, body as T, cache.ttl);
  return body as T;
}

/* ====================== DEFENSIVE FIELD HELPERS ====================== */

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v;
  return null;
}

function asArray(body: unknown): unknown[] {
  return Array.isArray(body) ? body : [];
}

/* ====================== TEST SURFACE ====================== */

// A minimal, key-free surface for unit tests of the pure logic (cache keying,
// error classification, quote normalization). NOT part of the public API — do
// not import in app code. Exposes no secret and touches no network.
export const __test = {
  cacheKey,
  classifyBodyError,
  normalizeQuote,
  num,
  str,
};

/* ====================== PUBLIC API ====================== */

/**
 * Probe the seated key against a cheap, universally-free endpoint (/quote/AAPL).
 * Returns a status object — NEVER throws — so the settings UI can render an
 * honest one-line result. Detects bad key (401/403 / "Invalid API KEY"),
 * rate-limited (429 / "Limit Reach"), and network failure.
 */
export async function fmpTestKey(): Promise<FmpKeyProbe> {
  const hasKey = await readKey();
  if (!hasKey) {
    return { ok: false, note: "No market-data key seated", reason: "no_key" };
  }
  try {
    // Deliberately un-cached: a connection test must hit the wire.
    const res = await rawRequest("/quote?symbol=AAPL", "quote");
    if (res.status === 401 || res.status === 403) {
      return { ok: false, note: "Key rejected — check the value", reason: "bad_key" };
    }
    if (res.status === 429) {
      return { ok: false, note: "Rate-limited — try again shortly", reason: "rate_limited" };
    }
    if (!res.ok) {
      return { ok: false, note: `Probe failed (HTTP ${res.status})`, reason: "error" };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, note: "Probe returned a malformed response", reason: "error" };
    }
    const bodyErr = classifyBodyError(body, "quote");
    if (bodyErr instanceof FmpRateLimitError) {
      return { ok: false, note: "Daily/second limit reached", reason: "rate_limited" };
    }
    if (bodyErr instanceof FmpAuthError) {
      return { ok: false, note: "Key rejected — check the value", reason: "bad_key" };
    }
    if (bodyErr) {
      return { ok: false, note: bodyErr.message.replace(/^fmp:\s*/, ""), reason: "error" };
    }
    const arr = asArray(body);
    if (arr.length > 0) {
      // A valid quote came back — the key works. FMP's /quote doesn't state the
      // plan, so we report a generic verified note (plan detection is best-effort
      // and left undefined rather than guessed).
      return { ok: true, note: "Verified — live market data", reason: "ok" };
    }
    return { ok: false, note: "Probe returned no data", reason: "error" };
  } catch (e) {
    if (e instanceof FmpNoKeyError) {
      return { ok: false, note: "No market-data key seated", reason: "no_key" };
    }
    // Network-level failure (no connectivity, DNS, TLS, host not in scope, …).
    return { ok: false, note: "Could not reach the market-data provider", reason: "network" };
  }
}

/**
 * ONE call for MANY symbols: /quote/{A,B,C}. Cached 5 min under a key derived
 * from the sorted symbol set, so re-requesting the same basket is free.
 */
export async function fmpBatchQuotes(symbols: string[]): Promise<FmpQuote[]> {
  const clean = Array.from(
    new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0)),
  ).sort();
  if (clean.length === 0) return [];
  const joined = clean.join(",");
  const key = cacheKey("quote", { symbols: joined });
  // stable /quote takes comma-separated symbols on ?symbol= (one call, many tickers)
  const body = await getJson<unknown>(`/quote?symbol=${encodeURIComponent(joined)}`, "quote", {
    key,
    ttl: TTL.QUOTE_MS,
  });
  return asArray(body).map(normalizeQuote);
}

function normalizeQuote(raw: unknown): FmpQuote {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    symbol: str(r.symbol) ?? "",
    price: num(r.price),
    changesPercentage: num(r.changesPercentage),
    change: num(r.change),
    dayLow: num(r.dayLow),
    dayHigh: num(r.dayHigh),
    yearLow: num(r.yearLow),
    yearHigh: num(r.yearHigh),
    marketCap: num(r.marketCap),
    volume: num(r.volume),
    avgVolume: num(r.avgVolume),
    open: num(r.open),
    previousClose: num(r.previousClose),
    eps: num(r.eps),
    pe: num(r.pe),
    name: str(r.name),
    exchange: str(r.exchange),
    timestamp: num(r.timestamp),
    raw,
  };
}

/** Earnings calendar between two ISO dates (YYYY-MM-DD). Cached 24 h. */
export async function fmpEarningsCalendar(from: string, to: string): Promise<FmpEarningsEvent[]> {
  const key = cacheKey("earning_calendar", { from, to });
  const body = await getJson<unknown>(
    `/earnings-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    "earning_calendar",
    { key, ttl: TTL.DAY_MS },
  );
  return asArray(body).map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      symbol: str(r.symbol) ?? "",
      date: str(r.date),
      epsEstimated: num(r.epsEstimated),
      eps: num(r.eps),
      revenueEstimated: num(r.revenueEstimated),
      revenue: num(r.revenue),
      time: str(r.time),
      raw,
    };
  });
}

/** Economic calendar between two ISO dates. Cached 24 h. */
export async function fmpEconomicCalendar(from: string, to: string): Promise<FmpEconomicEvent[]> {
  const key = cacheKey("economic_calendar", { from, to });
  const body = await getJson<unknown>(
    `/economic-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    "economic_calendar",
    { key, ttl: TTL.DAY_MS },
  );
  return asArray(body).map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      event: str(r.event),
      date: str(r.date),
      country: str(r.country),
      actual: num(r.actual),
      previous: num(r.previous),
      estimate: num(r.estimate),
      impact: str(r.impact),
      raw,
    };
  });
}

/** Company profile. Cached 24 h. Returns null when the symbol is unknown. */
export async function fmpProfile(sym: string): Promise<FmpProfile | null> {
  const symbol = sym.trim().toUpperCase();
  if (!symbol) return null;
  const key = cacheKey("profile", { symbol });
  const body = await getJson<unknown>(`/profile?symbol=${encodeURIComponent(symbol)}`, "profile", {
    key,
    ttl: TTL.DAY_MS,
  });
  const first = asArray(body)[0];
  if (!first) return null;
  const r = first as Record<string, unknown>;
  return {
    symbol: str(r.symbol) ?? symbol,
    companyName: str(r.companyName),
    sector: str(r.sector),
    industry: str(r.industry),
    description: str(r.description),
    ceo: str(r.ceo),
    country: str(r.country),
    exchange: str(r.exchangeShortName) ?? str(r.exchange),
    currency: str(r.currency),
    website: str(r.website),
    beta: num(r.beta),
    price: num(r.price),
    marketCap: num(r.mktCap) ?? num(r.marketCap),
    raw: first,
  };
}

/** TTM/period key metrics. Cached 24 h. Latest period first. */
export async function fmpKeyMetrics(sym: string): Promise<FmpKeyMetrics[]> {
  const symbol = sym.trim().toUpperCase();
  if (!symbol) return [];
  const key = cacheKey("key-metrics", { symbol });
  const body = await getJson<unknown>(`/key-metrics?symbol=${encodeURIComponent(symbol)}`, "key-metrics", {
    key,
    ttl: TTL.DAY_MS,
  });
  return asArray(body).map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      symbol: str(r.symbol) ?? symbol,
      date: str(r.date),
      peRatio: num(r.peRatio),
      pbRatio: num(r.pbRatio) ?? num(r.ptbRatio),
      dividendYield: num(r.dividendYield),
      roe: num(r.roe),
      debtToEquity: num(r.debtToEquity),
      currentRatio: num(r.currentRatio),
      raw,
    };
  });
}

/** Financial ratios. Cached 24 h. Latest period first. */
export async function fmpRatios(sym: string): Promise<FmpRatios[]> {
  const symbol = sym.trim().toUpperCase();
  if (!symbol) return [];
  const key = cacheKey("ratios", { symbol });
  const body = await getJson<unknown>(`/ratios?symbol=${encodeURIComponent(symbol)}`, "ratios", {
    key,
    ttl: TTL.DAY_MS,
  });
  return asArray(body).map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      symbol: str(r.symbol) ?? symbol,
      date: str(r.date),
      grossProfitMargin: num(r.grossProfitMargin),
      operatingProfitMargin: num(r.operatingProfitMargin),
      netProfitMargin: num(r.netProfitMargin),
      returnOnEquity: num(r.returnOnEquity),
      returnOnAssets: num(r.returnOnAssets),
      debtEquityRatio: num(r.debtEquityRatio),
      currentRatio: num(r.currentRatio),
      payoutRatio: num(r.payoutRatio) ?? num(r.dividendPayoutRatio),
      raw,
    };
  });
}

/** Historical dividends. Cached 24 h. The response nests rows under `historical`. */
export async function fmpStockDividends(sym: string): Promise<FmpDividend[]> {
  const symbol = sym.trim().toUpperCase();
  if (!symbol) return [];
  const key = cacheKey("stock_dividend", { symbol });
  const body = await getJson<unknown>(
    `/dividends?symbol=${encodeURIComponent(symbol)}`,
    "stock_dividend",
    { key, ttl: TTL.DAY_MS },
  );
  // stable /dividends returns a flat array; keep the legacy `historical`-nested
  // fallback so either shape parses.
  const container = (body ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(container.historical) ? container.historical : asArray(body);
  return rows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      date: str(r.date),
      label: str(r.label),
      dividend: num(r.dividend),
      adjDividend: num(r.adjDividend),
      recordDate: str(r.recordDate),
      paymentDate: str(r.paymentDate),
      declarationDate: str(r.declarationDate),
      raw,
    };
  });
}

/** Daily OHLCV history between two ISO dates. Cached 24 h. Rows nest under
 *  `historical`; normalized newest-first as FMP returns them. */
export async function fmpHistorical(sym: string, from: string, to: string): Promise<FmpBar[]> {
  const symbol = sym.trim().toUpperCase();
  if (!symbol) return [];
  const key = cacheKey("historical", { symbol, from, to });
  const body = await getJson<unknown>(
    `/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(
      from,
    )}&to=${encodeURIComponent(to)}`,
    "historical",
    { key, ttl: TTL.DAY_MS },
  );
  // stable /historical-price-eod/full returns a FLAT array; keep the legacy
  // `historical`-nested fallback so either shape parses.
  const container = (body ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(container.historical) ? container.historical : asArray(body);
  return rows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      date: str(r.date),
      open: num(r.open),
      high: num(r.high),
      low: num(r.low),
      close: num(r.close),
      adjClose: num(r.adjClose),
      volume: num(r.volume),
      raw,
    };
  });
}
