// Trading 212 adapter — the ONLY place in the app that talks to the Trading 212
// API. Read-only: this file never places orders, only reads account/position
// data. All money values are normalized to INTEGER MINOR UNITS (pennies) via
// decimal.js so we never lose precision converting API decimals.
//
// SECURITY: never log `creds` (apiKey / apiSecret) or the Authorization header.
// Credentials live only in the macOS Keychain (see ../db and the
// keychain_* Tauri commands) — this module receives them transiently as a
// function argument and must not retain or persist them anywhere.

import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import Decimal from "decimal.js";

/* ====================== TYPES ====================== */

export type Environment = "live" | "demo";

export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

/** Normalized open position. All money fields are INTEGER MINOR UNITS (pennies). */
export interface Position {
  ticker: string;
  isin: string | null;
  name: string | null;
  /** Native instrument price currency, e.g. "USD". */
  instrumentCurrency: string | null;
  /** Fractional share count — NOT money, kept as a plain number. */
  quantity: number;
  avgPriceMinor: number;
  currentPriceMinor: number;
  /** Account base currency, e.g. "GBP". */
  accountCurrency: string | null;
  currentValueMinor: number;
  unrealizedPlMinor: number;
  fxImpactMinor: number;
  totalCostMinor: number;
  /** Raw API payload for this position, kept for debugging/forward-compat. */
  raw: unknown;
}

export type ConnectionStatus = "ok" | "unauthorized" | "rate_limited" | "network" | "error";

/* ====================== CONSTANTS ====================== */

const BASE_URLS: Record<Environment, string> = {
  live: "https://live.trading212.com/api/v0",
  demo: "https://demo.trading212.com/api/v0",
};

/** Trading 212 rate limit is 1 request / 1s — pace requests at least this far apart. */
const MIN_REQUEST_INTERVAL_MS = 1200;
const MAX_RETRIES = 4;

// The history endpoints (orders / dividends / transactions) are on a FAR
// stricter budget than positions — roughly 6 requests/min — so a history page
// must never fire closer than 10s after ANY prior request through the shared
// queue. We pass this as the per-call minimum interval; the single global queue
// + 429 backoff below are otherwise untouched.
const HISTORY_MIN_REQUEST_INTERVAL_MS = 10_000;
/** Max page size the history endpoints accept, also the default we request. */
const HISTORY_PAGE_LIMIT = 50;

/* ====================== AUTH ====================== */

/** Builds the HTTP Basic auth header value. Never log the return value. */
export function authHeader(creds: Credentials): string {
  const token = btoa(`${creds.apiKey}:${creds.apiSecret}`);
  return `Basic ${token}`;
}

/* ====================== RATE-LIMITED REQUEST HELPER ====================== */

// Shared across all calls from this module instance so concurrent callers
// still respect the 1 req/s ceiling.
let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `minIntervalMs` lets a stricter caller (the history endpoints) hold a wider
// gap after ANY prior request — the gap enforced is the requested minimum, so a
// history page paces >=10s behind whatever ran before it while ordinary calls
// keep the 1.2s cadence.
async function paceRequest(minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + minIntervalMs - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/** Optional per-call tuning for {@link request}. */
export interface RequestOpts {
  /**
   * Minimum ms this call must sit behind the previous request in the shared
   * queue. Defaults to {@link MIN_REQUEST_INTERVAL_MS} (1200). The strict
   * history endpoints pass {@link HISTORY_MIN_REQUEST_INTERVAL_MS} (10_000).
   */
  minIntervalMs?: number;
}

/**
 * Shared rate-limited request helper. Paces calls to >=1200ms apart (or wider
 * via `opts.minIntervalMs`) and retries on HTTP 429 with exponential backoff
 * (honouring Retry-After when present), capped at MAX_RETRIES attempts.
 *
 * Never logs `creds` or the resolved Authorization header.
 */
export async function request(
  path: string,
  creds: Credentials,
  env: Environment,
  opts?: RequestOpts,
): Promise<Response> {
  const url = `${BASE_URLS[env]}${path}`;
  const headers = {
    Authorization: authHeader(creds),
    Accept: "application/json",
  };
  const minIntervalMs = opts?.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;

  // Serialize all callers through a single queue so the 1 req/s pacing holds
  // even when multiple requests are kicked off concurrently.
  const run = async (): Promise<Response> => {
    let attempt = 0;
    for (;;) {
      await paceRequest(minIntervalMs);
      const res = await httpFetch(url, { method: "GET", headers });
      if (res.status !== 429) return res;
      attempt += 1;
      if (attempt > MAX_RETRIES) return res;
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
      const backoffMs = Number.isFinite(retryAfterMs) ? retryAfterMs : MIN_REQUEST_INTERVAL_MS * 2 ** attempt;
      await sleep(backoffMs);
    }
  };

  const result = queue.then(run, run);
  // Keep the queue alive regardless of this call's outcome so later callers
  // still pace correctly after an error.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/* ====================== DEFENSIVE PARSING ====================== */

// Tolerates both the current nested schema and an older flat shape. Never
// throws on a missing optional field — normalizes to null/0 instead.
interface RawPositionish {
  // current nested shape
  instrument?: { currency?: string; isin?: string; name?: string; ticker?: string };
  averagePricePaid?: number;
  currentPrice?: number;
  quantity?: number;
  walletImpact?: {
    currency?: string;
    currentValue?: number;
    fxImpact?: number;
    totalCost?: number;
    unrealizedProfitLoss?: number;
  };
  // older flat shape
  ticker?: string;
  averagePrice?: number;
  ppl?: number;
  fxPpl?: number;
}

function toMinor(n: number | undefined | null): number {
  if (n === undefined || n === null || !Number.isFinite(n)) return 0;
  return new Decimal(n).times(100).round().toNumber();
}

function normalizePosition(raw: unknown): Position | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawPositionish;

  const ticker = r.instrument?.ticker ?? r.ticker;
  if (!ticker) return null; // unidentifiable position — skip rather than throw

  const avgPrice = r.averagePricePaid ?? r.averagePrice;
  const currentPrice = r.currentPrice;
  const unrealizedPl = r.walletImpact?.unrealizedProfitLoss ?? r.ppl;
  const fxImpact = r.walletImpact?.fxImpact ?? r.fxPpl;
  const quantity = typeof r.quantity === "number" ? r.quantity : 0;
  const currentValue = r.walletImpact?.currentValue ?? (currentPrice !== undefined ? currentPrice * quantity : undefined);
  const totalCost = r.walletImpact?.totalCost ?? (avgPrice !== undefined ? avgPrice * quantity : undefined);

  return {
    ticker,
    isin: r.instrument?.isin ?? null,
    name: r.instrument?.name ?? null,
    instrumentCurrency: r.instrument?.currency ?? null,
    quantity,
    avgPriceMinor: toMinor(avgPrice),
    currentPriceMinor: toMinor(currentPrice),
    accountCurrency: r.walletImpact?.currency ?? null,
    currentValueMinor: toMinor(currentValue),
    unrealizedPlMinor: toMinor(unrealizedPl),
    fxImpactMinor: toMinor(fxImpact),
    totalCostMinor: toMinor(totalCost),
    raw,
  };
}

/* ====================== PUBLIC API ====================== */

/** Fetches and normalizes all open positions. Parses defensively per-item. */
export async function fetchPositions(creds: Credentials, env: Environment): Promise<Position[]> {
  const res = await request("/equity/positions", creds, env);
  if (!res.ok) {
    throw new Error(`trading212: request failed (${res.status})`);
  }
  const body: unknown = await res.json();
  if (!Array.isArray(body)) return [];
  const out: Position[] = [];
  for (const item of body) {
    const pos = normalizePosition(item);
    if (pos) out.push(pos);
  }
  return out;
}

/** Cash / account summary: total account value, free buying power, and total
 *  P/L — all in the ACCOUNT currency (e.g. GBP). Read-only. Defensive: any
 *  missing field normalizes to 0/null. Minor units (×100) to match Position. */
export interface AccountCash {
  freeMinor: number; // buying power (available cash)
  totalMinor: number; // total account value (invested + cash)
  investedMinor: number;
  pplMinor: number; // open positions' UNREALISED P/L (account ccy)
  resultMinor: number; // REALISED result from closed positions (account ccy)
  currency: string | null;
  raw: unknown; // full payload, for forward-compat / debugging
}
export async function fetchAccountCash(creds: Credentials, env: Environment): Promise<AccountCash> {
  const res = await request("/equity/account/cash", creds, env);
  if (!res.ok) throw new Error(`trading212: account/cash failed (${res.status})`);
  const r = (await res.json()) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    freeMinor: toMinor(n(r.free)),
    totalMinor: toMinor(n(r.total)),
    investedMinor: toMinor(n(r.invested)),
    pplMinor: toMinor(n(r.ppl)),
    resultMinor: toMinor(n(r.result)),
    currency: typeof r.currencyCode === "string" ? r.currencyCode : null,
    raw: r,
  };
}

/* ====================== HISTORY: TYPES ====================== */

/**
 * One executed (or attempted) order fill from /equity/history/orders.
 * `fillPriceMinor` is INSTRUMENT-currency minor units (same convention as
 * Position.avgPriceMinor); `filledValueMinor` and `feeMinor` are ACCOUNT-currency
 * minor units. `status` is passed through verbatim so downstream can filter to
 * executed rows without us silently dropping the non-filled ones here.
 */
export interface HistoryOrderFill {
  id: string;
  dateISO: string;
  ticker: string;
  side: "buy" | "sell";
  quantity: number; // abs share count (fractional allowed) — NOT money
  fillPriceMinor: number; // instrument ccy
  filledValueMinor: number; // account ccy, abs
  feeMinor: number; // account ccy, positive
  status: string;
  raw: unknown;
}

/** One paid dividend from /history/dividends. Money in ACCOUNT-currency minor units. */
export interface HistoryDividend {
  id: string;
  dateISO: string;
  ticker: string;
  amountMinor: number; // account ccy
  quantity: number | null; // shares that earned the dividend, if provided
  grossPerShareMinor: number | null; // account ccy per-share, if provided
  type: string | null;
  raw: unknown;
}

/** One cash movement from /history/transactions. `amountMinor` is ABS; direction lives in `kind`. */
export interface HistoryTransaction {
  id: string;
  dateISO: string;
  kind: "deposit" | "withdrawal" | "interest" | "fee" | "other";
  amountMinor: number; // account ccy, ABS
  reference: string | null;
  raw: unknown;
}

/** One page of a paginated history feed. `nextCursor` is an OPAQUE token, or null at the end.
 *  `rawCount` = items on the page BEFORE normalization: a page where every raw row failed to
 *  parse yields items=[] with rawCount>0 — the sync must FOLLOW the cursor there, not stop
 *  (stopping on the normalized count would silently truncate the back-fill). */
export interface HistoryPage<T> {
  items: T[];
  nextCursor: string | null;
  rawCount: number;
  /** The FIRST raw row that failed normalization on this page (null when none) —
   *  the sync persists a sample so a shape drift is diagnosable from the DB
   *  instead of vanishing silently. Broker rows carry no credentials. */
  skippedSample: unknown | null;
}

/* ====================== HISTORY: DEFENSIVE FIELD HELPERS ====================== */

/** First finite number among the candidates, else undefined. Ignores non-numbers. */
function firstNum(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** First non-empty string among the candidates, else undefined. */
function firstStr(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return undefined;
}

/** First usable ID among the candidates, stringified — T212's real history rows
 *  carry NUMERIC ids (captured live: order.id 53554138761), which firstStr would
 *  silently reject. Accepts a non-empty string or a finite number. */
function firstId(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/**
 * Pass a date string through iff it parses; else null. We keep the SOURCE string
 * verbatim (never reformat) so we never fabricate precision the API didn't give.
 */
function passDateISO(...vals: unknown[]): string | null {
  const s = firstStr(...vals);
  if (s === undefined) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/**
 * Sum a fees/taxes array into positive minor units. Each entry may carry the
 * charge under `quantity` (T212's shape for fee legs) or `amount`; other shapes
 * are tolerated by trying both. Non-array / empty -> 0.
 */
function sumFeesMinor(arr: unknown): number {
  if (!Array.isArray(arr)) return 0;
  let totalMinor = 0;
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { quantity?: unknown; amount?: unknown };
    const v = firstNum(e.quantity, e.amount);
    if (v === undefined) continue;
    totalMinor += Math.abs(toMinor(v));
  }
  return totalMinor;
}

/* ====================== HISTORY: CURSOR EXTRACTION ====================== */

/**
 * Turn the envelope's `nextPagePath` into the OPAQUE cursor token we round-trip.
 * The API sometimes returns a full path/URL with a `cursor` query param and
 * sometimes a bare token; we accept BOTH — if a `cursor` param is present we
 * lift its value, otherwise we treat the whole string as the token. A blank or
 * missing path means "no more pages" -> null.
 */
function extractCursor(nextPagePath: unknown): string | null {
  if (typeof nextPagePath !== "string") return null;
  const raw = nextPagePath.trim();
  if (raw.length === 0) return null;
  // Round-trip the WHOLE query string as the opaque token — some feeds paginate
  // with MORE than a cursor param (transactions carry e.g. cursor + time);
  // lifting only `cursor` produced a token the server rejects on resume, which
  // froze the transactions back-fill. historyQuery() merges every param back.
  const qIdx = raw.indexOf("?");
  if (qIdx >= 0) {
    const query = raw.slice(qIdx + 1).trim();
    return query.length > 0 ? query : null;
  }
  // No query part — the whole string IS the opaque token.
  return raw;
}

/**
 * Build the `?limit=&cursor=` query string for a history call. `cursor` is fed
 * back verbatim as an opaque token (it may itself be a full path — that's fine,
 * it round-trips). `limit` is clamped to [1, HISTORY_PAGE_LIMIT].
 */
function historyQuery(cursor: string | null | undefined, limit: number | undefined): string {
  const params = new URLSearchParams();
  const lim = Math.max(1, Math.min(HISTORY_PAGE_LIMIT, Math.trunc(limit ?? HISTORY_PAGE_LIMIT)));
  const token = typeof cursor === "string" ? cursor.trim() : "";
  if (token.length > 0) {
    if (token.includes("=")) {
      // Full-query token (the current extractCursor form, possibly multi-param —
      // e.g. transactions paginate with cursor + time): merge EVERY param back.
      // Tolerates a token that is itself a path?query by keeping the query part.
      const qIdx = token.indexOf("?");
      const query = qIdx >= 0 ? token.slice(qIdx + 1) : token;
      new URLSearchParams(query).forEach((v, k) => params.set(k, v));
    } else {
      // Legacy bare-cursor token (persisted by older builds) — best effort.
      params.set("cursor", token);
    }
  }
  params.set("limit", String(lim)); // ours wins — clamped to the API max
  return params.toString();
}

/* ====================== HISTORY: NORMALIZERS ====================== */

/**
 * Normalize one raw order item. Returns null (skip) only when the row is truly
 * unusable — no ticker, or an unparseable date. Every other row is returned WITH
 * its status so downstream can decide what "executed" means; we don't drop
 * non-filled rows here.
 *
 * SIDE is taken from an explicit side/direction/type field when it names BUY or
 * SELL, else inferred from the sign of the (filled/ordered) quantity — a
 * negative quantity means a sell. `quantity` is returned as an absolute value.
 */
function normalizeOrderFill(raw: unknown): HistoryOrderFill | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  // REAL SHAPE (captured live 2026-07-05 via the skipped-sample diagnostic): each
  // row is a NESTED PAIR — { order: { id, ticker, status, side, filledValue,
  // currency, createdAt, instrument: { ticker, currency } }, fill: { id,
  // quantity, price, filledAt, walletImpact: { currency, netValue, taxes: [
  // { name, quantity: -0.04 } ] } } }. ids are NUMBERS. `fill.price` is
  // INSTRUMENT ccy; `order.filledValue` / `walletImpact.netValue` are ACCOUNT
  // ccy. Cancelled/pending rows may carry no fill. The flat fallbacks below keep
  // the old defensive guesses alive in case the shape drifts again.
  const order = (r.order && typeof r.order === "object" ? r.order : r) as Record<string, unknown>;
  const fill = (r.fill && typeof r.fill === "object" ? r.fill : r) as Record<string, unknown>;
  const wallet = (fill.walletImpact && typeof fill.walletImpact === "object"
    ? fill.walletImpact
    : undefined) as Record<string, unknown> | undefined;

  const instrument = (order.instrument && typeof order.instrument === "object"
    ? order.instrument
    : r.instrument && typeof r.instrument === "object"
      ? r.instrument
      : undefined) as { ticker?: unknown } | undefined;
  const ticker = firstStr(order.ticker, instrument?.ticker, r.ticker);
  if (ticker === undefined) return null; // unidentifiable — skip

  const dateISO = passDateISO(
    fill.filledAt, order.createdAt, // real nested shape
    r.dateExecuted, r.dateModified, r.dateCreated, // legacy flat guesses
  );
  if (dateISO === null) return null; // no trustworthy timestamp — skip

  const rawQty = firstNum(fill.quantity, r.filledQuantity, r.orderedQuantity, r.quantity);
  const quantity = rawQty === undefined ? 0 : Math.abs(rawQty);

  // Prefer the FILL's own id (unique per row in the real shape — ids are numeric,
  // hence firstId not firstStr); fall back to the order id DISAMBIGUATED with
  // per-row content (date + qty) — an order can produce several fills, so a bare
  // `ord:<orderId>` key would make sibling fills collide on the DB primary key
  // and INSERT OR REPLACE would silently drop real executed volume.
  const fillId = firstId(fill !== r ? fill.id : undefined, r.fillId);
  const orderId = firstId(order.id, r.id);
  const id = fillId ?? (orderId !== undefined ? `ord:${orderId}:${dateISO}:${quantity}` : undefined);
  if (id === undefined) return null; // no id to key on — skip

  // Explicit side wins; otherwise sign of quantity (negative => sell).
  const sideField = firstStr(order.side, r.side, r.direction, r.type)?.toUpperCase() ?? "";
  let side: "buy" | "sell";
  if (sideField.includes("SELL")) side = "sell";
  else if (sideField.includes("BUY")) side = "buy";
  else side = rawQty !== undefined && rawQty < 0 ? "sell" : "buy";

  const fillPrice = firstNum(fill.price, r.fillPrice, r.price, r.averagePrice);
  const filledValue = firstNum(order.filledValue, wallet?.netValue, r.filledValue, r.value);
  const feeMinor =
    sumFeesMinor(wallet?.taxes) + sumFeesMinor(r.taxes) + sumFeesMinor(r.fees);
  const status = firstStr(order.status, r.status, r.fillResult) ?? "";

  return {
    id,
    dateISO,
    ticker,
    side,
    quantity,
    fillPriceMinor: toMinor(fillPrice),
    filledValueMinor: Math.abs(toMinor(filledValue)),
    feeMinor,
    status,
    raw,
  };
}

/** Normalize one raw dividend item. Skips only on missing ticker or unparseable date. */
function normalizeDividend(raw: unknown): HistoryDividend | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const ticker = firstStr(r.ticker);
  if (ticker === undefined) return null;

  const dateISO = passDateISO(r.paidOn, r.date);
  if (dateISO === null) return null;

  const id = firstStr(r.reference, r.id);
  if (id === undefined) return null;

  const amount = firstNum(r.amount);
  const quantity = firstNum(r.quantity);
  const grossPerShare = firstNum(r.grossAmountPerShare);

  return {
    id,
    dateISO,
    ticker,
    amountMinor: toMinor(amount),
    quantity: quantity ?? null,
    grossPerShareMinor: grossPerShare === undefined ? null : toMinor(grossPerShare),
    type: firstStr(r.type) ?? null,
    raw,
  };
}

/** Maps a raw transaction `type` onto our coarse kind. Case-insensitive, substring-tolerant. */
function txnKind(type: string | undefined): HistoryTransaction["kind"] {
  const t = (type ?? "").toUpperCase();
  if (t.includes("INTEREST")) return "interest"; // any *INTEREST* variant
  if (t.includes("WITHDRAW")) return "withdrawal"; // WITHDRAW / WITHDRAWAL
  if (t.includes("DEPOSIT") || t.includes("TOP_UP") || t.includes("TOPUP")) return "deposit";
  if (t.includes("FEE")) return "fee";
  return "other";
}

/** Normalize one raw transaction item. Amount is stored ABS; direction lives in `kind`. */
function normalizeTransaction(raw: unknown): HistoryTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const dateISO = passDateISO(r.dateTime, r.date);
  if (dateISO === null) return null;

  const id = firstStr(r.reference, r.id);
  if (id === undefined) return null;

  const amount = firstNum(r.amount);

  return {
    id,
    dateISO,
    kind: txnKind(firstStr(r.type)),
    amountMinor: Math.abs(toMinor(amount)),
    reference: firstStr(r.reference) ?? null,
    raw,
  };
}

/* ====================== HISTORY: PAGE FETCHERS ====================== */

/**
 * Shared page-fetch core: hits a history endpoint on the STRICT 10s budget,
 * normalizes each item defensively (skipping only truly-unusable rows), and
 * extracts the opaque next-page cursor from the `{ items, nextPagePath }`
 * envelope. Tolerates a bare array body (older shape) as items with no cursor.
 */
async function fetchHistoryPage<T>(
  endpoint: string,
  normalize: (raw: unknown) => T | null,
  creds: Credentials,
  env: Environment,
  cursor: string | null | undefined,
  limit: number | undefined,
): Promise<HistoryPage<T>> {
  const query = historyQuery(cursor, limit);
  const res = await request(`${endpoint}?${query}`, creds, env, {
    minIntervalMs: HISTORY_MIN_REQUEST_INTERVAL_MS,
  });
  if (!res.ok) throw new Error(`trading212: ${endpoint} failed (${res.status})`);

  const body: unknown = await res.json();
  // Current envelope: { items: [...], nextPagePath: string | null }.
  // Older/defensive: a bare array with no pagination.
  const rawItems = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)
      ? ((body as { items: unknown[] }).items)
      : [];
  const nextPagePath =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { nextPagePath?: unknown }).nextPagePath
      : null;

  const items: T[] = [];
  let skippedSample: unknown | null = null;
  for (const item of rawItems) {
    const norm = normalize(item);
    if (norm) items.push(norm); // unparseable rows are skipped, not thrown on
    else if (skippedSample === null) skippedSample = item; // keep ONE for diagnosis
  }
  return { items, nextCursor: extractCursor(nextPagePath), rawCount: rawItems.length, skippedSample };
}

/** One page of executed/attempted order fills, newest-first per the API. Strict 10s pacing. */
export async function fetchOrderHistoryPage(
  creds: Credentials,
  env: Environment,
  cursor?: string | null,
  limit?: number,
): Promise<HistoryPage<HistoryOrderFill>> {
  return fetchHistoryPage("/equity/history/orders", normalizeOrderFill, creds, env, cursor, limit);
}

/** One page of paid dividends. Strict 10s pacing. */
export async function fetchDividendsPage(
  creds: Credentials,
  env: Environment,
  cursor?: string | null,
  limit?: number,
): Promise<HistoryPage<HistoryDividend>> {
  return fetchHistoryPage("/history/dividends", normalizeDividend, creds, env, cursor, limit);
}

/** One page of cash movements (deposits/withdrawals/interest/fees/…). Strict 10s pacing. */
export async function fetchTransactionsPage(
  creds: Credentials,
  env: Environment,
  cursor?: string | null,
  limit?: number,
): Promise<HistoryPage<HistoryTransaction>> {
  return fetchHistoryPage("/history/transactions", normalizeTransaction, creds, env, cursor, limit);
}

/* ====================== HISTORY: TEST SURFACE ====================== */

// Key-free surface for unit tests of the pure history logic (normalizers,
// cursor extraction, query building, fee summation). NOT part of the public
// API — do not import in app code. Exposes no secret and touches no network.
export const __historyTest = {
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
};

/**
 * Single lightweight authed GET used to validate credentials without doing
 * anything destructive. Maps the response to a coarse status the UI can show.
 */
export async function testConnection(creds: Credentials, env: Environment): Promise<ConnectionStatus> {
  try {
    const res = await request("/equity/positions", creds, env);
    if (res.status === 200) return "ok";
    if (res.status === 401 || res.status === 403) return "unauthorized";
    if (res.status === 429) return "rate_limited";
    return "error";
  } catch {
    // network-level failure (no connectivity, DNS, TLS, host not in capability scope, …)
    return "network";
  }
}
