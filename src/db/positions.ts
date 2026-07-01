// Typed helpers over the position_cache / sync_meta tables. This is the only
// place that writes positions to SQLite — the cache exists so the app still
// has something to show (and the user can see "last synced") if a later
// fetch fails or the user is offline.

import { getDb } from "./index";
import type { Position } from "../adapters/trading212";

interface PositionRow {
  account_id: string;
  ticker: string;
  isin: string | null;
  name: string | null;
  instrument_currency: string | null;
  quantity: number;
  avg_price_minor: number;
  current_price_minor: number;
  account_currency: string | null;
  current_value_minor: number;
  unrealized_pl_minor: number;
  fx_impact_minor: number;
  total_cost_minor: number;
  raw_json: string | null;
  fetched_at: string;
}

function rowToPosition(row: PositionRow): Position {
  let raw: unknown = null;
  if (row.raw_json) {
    try {
      raw = JSON.parse(row.raw_json);
    } catch {
      raw = null;
    }
  }
  return {
    ticker: row.ticker,
    isin: row.isin,
    name: row.name,
    instrumentCurrency: row.instrument_currency,
    quantity: row.quantity,
    avgPriceMinor: row.avg_price_minor,
    currentPriceMinor: row.current_price_minor,
    accountCurrency: row.account_currency,
    currentValueMinor: row.current_value_minor,
    unrealizedPlMinor: row.unrealized_pl_minor,
    fxImpactMinor: row.fx_impact_minor,
    totalCostMinor: row.total_cost_minor,
    raw,
  };
}

/** Upserts every position into position_cache and records sync_meta.lastSync. */
export async function cachePositions(accountId: string, positions: Position[]): Promise<void> {
  const db = await getDb();
  const fetchedAt = new Date().toISOString();

  for (const p of positions) {
    await db.execute(
      `INSERT INTO position_cache (
         account_id, ticker, isin, name, instrument_currency, quantity,
         avg_price_minor, current_price_minor, account_currency,
         current_value_minor, unrealized_pl_minor, fx_impact_minor,
         total_cost_minor, raw_json, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, ticker) DO UPDATE SET
         isin = excluded.isin,
         name = excluded.name,
         instrument_currency = excluded.instrument_currency,
         quantity = excluded.quantity,
         avg_price_minor = excluded.avg_price_minor,
         current_price_minor = excluded.current_price_minor,
         account_currency = excluded.account_currency,
         current_value_minor = excluded.current_value_minor,
         unrealized_pl_minor = excluded.unrealized_pl_minor,
         fx_impact_minor = excluded.fx_impact_minor,
         total_cost_minor = excluded.total_cost_minor,
         raw_json = excluded.raw_json,
         fetched_at = excluded.fetched_at`,
      [
        accountId,
        p.ticker,
        p.isin,
        p.name,
        p.instrumentCurrency,
        p.quantity,
        p.avgPriceMinor,
        p.currentPriceMinor,
        p.accountCurrency,
        p.currentValueMinor,
        p.unrealizedPlMinor,
        p.fxImpactMinor,
        p.totalCostMinor,
        JSON.stringify(p.raw ?? null),
        fetchedAt,
      ],
    );
  }

  // Drop positions that were NOT part of this sync (closed/sold since last time)
  // so the offline cache can't show stale, no-longer-open holdings. Every row
  // upserted above shares this sync's fetchedAt; anything else is stale. When
  // `positions` is empty this clears the account's cache entirely (correct — no
  // open positions).
  await db.execute(
    `DELETE FROM position_cache WHERE account_id = ? AND fetched_at <> ?`,
    [accountId, fetchedAt],
  );

  await db.execute(
    `INSERT INTO sync_meta (account_id, k, v) VALUES (?, 'lastSync', ?)
     ON CONFLICT(account_id, k) DO UPDATE SET v = excluded.v`,
    [accountId, fetchedAt],
  );
}

/** Reads the cached positions for an account, most-recently-fetched first. */
export async function readCachedPositions(accountId: string): Promise<Position[]> {
  const db = await getDb();
  const rows = await db.select<PositionRow[]>(
    `SELECT * FROM position_cache WHERE account_id = ? ORDER BY fetched_at DESC, ticker ASC`,
    [accountId],
  );
  return rows.map(rowToPosition);
}

/** Returns the ISO timestamp of the last successful sync, or null if never synced. */
export async function getLastSync(accountId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ v: string | null }[]>(
    `SELECT v FROM sync_meta WHERE account_id = ? AND k = 'lastSync'`,
    [accountId],
  );
  return rows[0]?.v ?? null;
}
