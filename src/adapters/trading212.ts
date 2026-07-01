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

async function paceRequest(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * Shared rate-limited request helper. Paces calls to >=1200ms apart and
 * retries on HTTP 429 with exponential backoff (honouring Retry-After when
 * present), capped at MAX_RETRIES attempts.
 *
 * Never logs `creds` or the resolved Authorization header.
 */
export async function request(path: string, creds: Credentials, env: Environment): Promise<Response> {
  const url = `${BASE_URLS[env]}${path}`;
  const headers = {
    Authorization: authHeader(creds),
    Accept: "application/json",
  };

  // Serialize all callers through a single queue so the 1 req/s pacing holds
  // even when multiple requests are kicked off concurrently.
  const run = async (): Promise<Response> => {
    let attempt = 0;
    for (;;) {
      await paceRequest();
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
