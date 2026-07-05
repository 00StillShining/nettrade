// Typed helpers over the phase-2c history tables (order_history /
// dividend_history / transaction_history / equity_snapshots). This is the ONLY
// place that writes persisted history to SQLite. The tables exist so the
// Performance-Truth engine's realised P/L, dividends, cash events and honest
// value curve survive a relaunch and can be back-filled incrementally instead
// of re-paginating the ~6-requests/min history endpoints on every launch.
//
// SECURITY / HONESTY: rows are the already-normalized adapter shapes (minor
// units via toMinor). raw_json keeps the untouched adapter payload for
// forward-compat/audit; it never carries credentials (the adapter strips those
// before constructing a row). Nothing here fabricates a value.
//
// PARAMETERIZATION: every write/read binds values through the driver's
// placeholder array (never string-interpolated), so an arbitrary ticker /
// reference string can never break out into SQL. INSERT OR REPLACE keyed on the
// stable primary key gives an idempotent upsert — re-persisting the same page
// during an incremental catch-up is a harmless no-op.

import { getDb } from "./index";
import type {
  HistoryOrderFill,
  HistoryDividend,
  HistoryTransaction,
} from "../adapters/trading212";

/* ====================== ROW SHAPES (mirror the migration columns) ====================== */

interface OrderRow {
  id: string;
  date_iso: string;
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  fill_price_minor: number;
  filled_value_minor: number;
  fee_minor: number;
  status: string;
  raw_json: string | null;
}

interface DividendRow {
  id: string;
  date_iso: string;
  ticker: string;
  amount_minor: number;
  quantity: number | null;
  gross_per_share_minor: number | null;
  type: string | null;
  raw_json: string | null;
}

interface TransactionRow {
  id: string;
  date_iso: string;
  kind: "deposit" | "withdrawal" | "interest" | "fee" | "other";
  amount_minor: number;
  reference: string | null;
  raw_json: string | null;
}

interface SnapshotRow {
  at_iso: string;
  total_value_minor: number;
  net_deposits_minor: number;
  ccy: string;
}

/* ====================== SERIALIZE HELPERS ====================== */

// Stringify the raw payload defensively — a circular / unserializable payload
// must not sink the whole upsert. On failure we persist null rather than throw.
function rawToJson(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

function jsonToRaw(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ====================== ORDER HISTORY ====================== */

/** Upserts executed/parsed order fills. INSERT OR REPLACE on the stable id, so a
 *  re-fetched page is idempotent. Callers pass the adapter's HistoryOrderFill. */
export async function upsertOrderFills(fills: HistoryOrderFill[]): Promise<void> {
  if (!fills.length) return;
  const db = await getDb();
  for (const f of fills) {
    await db.execute(
      `INSERT OR REPLACE INTO order_history
         (id, date_iso, ticker, side, quantity, fill_price_minor,
          filled_value_minor, fee_minor, status, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        f.id,
        f.dateISO,
        f.ticker,
        f.side,
        f.quantity,
        f.fillPriceMinor,
        f.filledValueMinor,
        f.feeMinor,
        f.status,
        rawToJson(f.raw),
      ],
    );
  }
}

/** Reads all persisted order fills, sorted date_iso ASC (chronological — the
 *  average-cost replay in truth.ts requires this order). */
export async function readAllOrderFills(): Promise<HistoryOrderFill[]> {
  const db = await getDb();
  const rows = await db.select<OrderRow[]>(
    `SELECT * FROM order_history ORDER BY date_iso ASC, id ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    dateISO: r.date_iso,
    ticker: r.ticker,
    side: r.side,
    quantity: r.quantity,
    fillPriceMinor: r.fill_price_minor,
    filledValueMinor: r.filled_value_minor,
    feeMinor: r.fee_minor,
    status: r.status,
    raw: jsonToRaw(r.raw_json),
  }));
}

/* ====================== DIVIDEND HISTORY ====================== */

export async function upsertDividends(divs: HistoryDividend[]): Promise<void> {
  if (!divs.length) return;
  const db = await getDb();
  for (const d of divs) {
    await db.execute(
      `INSERT OR REPLACE INTO dividend_history
         (id, date_iso, ticker, amount_minor, quantity,
          gross_per_share_minor, type, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.id,
        d.dateISO,
        d.ticker,
        d.amountMinor,
        d.quantity,
        d.grossPerShareMinor,
        d.type,
        rawToJson(d.raw),
      ],
    );
  }
}

/** Reads all persisted dividends, sorted date_iso ASC. */
export async function readAllDividends(): Promise<HistoryDividend[]> {
  const db = await getDb();
  const rows = await db.select<DividendRow[]>(
    `SELECT * FROM dividend_history ORDER BY date_iso ASC, id ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    dateISO: r.date_iso,
    ticker: r.ticker,
    amountMinor: r.amount_minor,
    quantity: r.quantity,
    grossPerShareMinor: r.gross_per_share_minor,
    type: r.type,
    raw: jsonToRaw(r.raw_json),
  }));
}

/* ====================== TRANSACTION HISTORY ====================== */

export async function upsertTransactions(txns: HistoryTransaction[]): Promise<void> {
  if (!txns.length) return;
  const db = await getDb();
  for (const t of txns) {
    await db.execute(
      `INSERT OR REPLACE INTO transaction_history
         (id, date_iso, kind, amount_minor, reference, raw_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [t.id, t.dateISO, t.kind, t.amountMinor, t.reference, rawToJson(t.raw)],
    );
  }
}

/** Reads all persisted transactions, sorted date_iso ASC. */
export async function readAllTransactions(): Promise<HistoryTransaction[]> {
  const db = await getDb();
  const rows = await db.select<TransactionRow[]>(
    `SELECT * FROM transaction_history ORDER BY date_iso ASC, id ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    dateISO: r.date_iso,
    kind: r.kind,
    amountMinor: r.amount_minor,
    reference: r.reference,
    raw: jsonToRaw(r.raw_json),
  }));
}

/* ====================== EQUITY SNAPSHOTS ====================== */

/** One honestly-RECORDED mark-to-market row (see EquitySnapshot in engine/types).
 *  Keyed by at_iso; INSERT OR REPLACE lets the poller dedupe within a truncated
 *  minute (liveHistory truncates at_iso to the minute before calling). */
export interface EquitySnapshotRow {
  atISO: string;
  totalValueMinor: number;
  netDepositsMinor: number;
  ccy: string;
}

export async function upsertEquitySnapshot(snap: EquitySnapshotRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO equity_snapshots
       (at_iso, total_value_minor, net_deposits_minor, ccy)
     VALUES (?, ?, ?, ?)`,
    [snap.atISO, snap.totalValueMinor, snap.netDepositsMinor, snap.ccy],
  );
}

/** Reads all recorded snapshots, sorted at_iso ASC. A sparse/empty result is the
 *  CORRECT, honest output for a user with little sync history — never padded. */
export async function readAllEquitySnapshots(): Promise<EquitySnapshotRow[]> {
  const db = await getDb();
  const rows = await db.select<SnapshotRow[]>(
    `SELECT * FROM equity_snapshots ORDER BY at_iso ASC`,
  );
  return rows.map((r) => ({
    atISO: r.at_iso,
    totalValueMinor: r.total_value_minor,
    netDepositsMinor: r.net_deposits_minor,
    ccy: r.ccy,
  }));
}
