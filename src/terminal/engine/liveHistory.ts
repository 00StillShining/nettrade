// liveHistory.ts — the phase-2c HISTORY SYNC + MAPPING module.
//
// Fetches the user's Trading 212 order/dividend/transaction history (paginated,
// budget-aware), persists it, maps it into the pure Performance-Truth engine's
// types, and publishes the result through TruthStore for the History /
// Performance / Dividends screens. All READ-ONLY (GET only — never places a
// trade / moves money) and a strict NO-OP under VITE_MOCK.
//
// WHY INCREMENTAL: the T212 history endpoints are rate-limited to ~6 requests
// per minute, so a full paginate is SLOW. We therefore fetch page 1 (newest
// first) each launch and STOP as soon as a page is entirely already-known (an
// incremental catch-up), only chasing nextCursor to exhaustion on a genuine
// first-run back-fill. Back-fill progress is persisted into sync_meta so an
// interrupted back-fill resumes on the next launch instead of restarting.
//
// HONEST DATA: every mapped figure comes from a real persisted row. Nothing is
// interpolated. recordSnapshot() only ever writes a value point once history
// sync has completed at least once, so net deposits are KNOWN — never a
// snapshot with invented deposits. Fills are labelled executed-only; skipped
// "other" transactions are counted, not silently dropped.

import type {
  Credentials,
  Environment,
  HistoryOrderFill,
  HistoryDividend,
  HistoryTransaction,
} from "../../adapters/trading212";
import {
  fetchOrderHistoryPage,
  fetchDividendsPage,
  fetchTransactionsPage,
} from "../../adapters/trading212";
import type { CashEvent, Trade, EquitySnapshot } from "../../engine/types";
import { computeTruth } from "../../engine/truth";
import {
  netDepositsSeries,
  realisedSeries,
  valueSeries,
} from "../../engine/series";
import {
  upsertOrderFills,
  upsertDividends,
  upsertTransactions,
  upsertEquitySnapshot,
  readAllOrderFills,
  readAllDividends,
  readAllTransactions,
  readAllEquitySnapshots,
} from "../../db/history";
import { getDb } from "../../db/index";
import { getCreds } from "./live";
import { State } from "../state";
import { TruthStore, type FillRow } from "./truthStore";

const IS_MOCK = import.meta.env.VITE_MOCK === "1";

const ACCOUNT_ID = "default";
const ENV: Environment = "live";
/** sync_meta keys for the resumable back-fill cursors (per the task brief). */
const CURSOR_KEYS = {
  orders: "2c:orders_cursor",
  dividends: "2c:dividends_cursor",
  transactions: "2c:transactions_cursor",
} as const;

/* ====================== CLEAN TICKER ====================== */

/** T212 tickers look like "AAPL_US_EQ" / "NVDA_US_EQ"; take the leading symbol.
 *  Copies live.ts cleanTicker semantics verbatim (kept local so the mapping is a
 *  standalone-testable pure function rather than importing the orchestrator). */
export function cleanTicker(t: string): string {
  return (t.split("_")[0] || t).trim().toUpperCase();
}

/* ====================== PURE MAPPING (exported for tests) ====================== */

/** True when a fill is a real EXECUTED trade worth replaying: its status reads
 *  filled/executed, and it carries a positive quantity AND fill price. A pending
 *  / cancelled / rejected order, or a zero-qty/zero-price artifact, is excluded
 *  from the average-cost replay (it never actually moved shares). */
export function isExecutedFill(f: HistoryOrderFill): boolean {
  const s = (f.status || "").toUpperCase();
  const executed = s.includes("FILL") || s.includes("EXECUT");
  return executed && f.quantity > 0 && f.fillPriceMinor > 0;
}

/**
 * fillToTrade — one executed HistoryOrderFill -> a Trade for the engine.
 * The ticker is CLEANED to the display symbol so realised P/L groups by the
 * same key the screens show. settledValueMinor is the actual account-currency
 * cash impact when the source supplied a non-zero filledValueMinor, else
 * undefined (the engine then falls back to instrument-currency maths — see the
 * documented v1 currency limitation in engine/types.ts). Callers must have
 * already filtered by isExecutedFill.
 */
export function fillToTrade(f: HistoryOrderFill): Trade {
  return {
    dateISO: f.dateISO,
    ticker: cleanTicker(f.ticker),
    side: f.side,
    quantity: f.quantity,
    priceMinor: f.fillPriceMinor,
    feeMinor: f.feeMinor,
    settledValueMinor: f.filledValueMinor || undefined,
  };
}

/**
 * fillsToTrades — executed-only, mapped, and sorted CHRONOLOGICALLY ASC. The
 * average-cost replay (replayRealisedEvents in truth.ts) defensively re-sorts,
 * but we sort here too so the engine input is honest and the History screen's
 * chronological reads and the replay agree on order.
 */
export function fillsToTrades(fills: HistoryOrderFill[]): Trade[] {
  return fills
    .filter(isExecutedFill)
    .map(fillToTrade)
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
}

/**
 * transactionToCashEvent — a persisted transaction -> a CashEvent, or null for a
 * kind the truth split does not model as a cash event ("other"). amountMinor
 * stays POSITIVE: the engine applies the sign by kind (a withdrawal subtracts, a
 * deposit adds) — see CashEvent's doc comment in engine/types.ts.
 */
export function transactionToCashEvent(t: HistoryTransaction): CashEvent | null {
  switch (t.kind) {
    case "deposit":
      return { kind: "deposit", dateISO: t.dateISO, amountMinor: t.amountMinor };
    case "withdrawal":
      return { kind: "withdrawal", dateISO: t.dateISO, amountMinor: t.amountMinor };
    case "interest":
      return { kind: "interest", dateISO: t.dateISO, amountMinor: t.amountMinor };
    case "fee":
      return {
        kind: "fee",
        dateISO: t.dateISO,
        amountMinor: t.amountMinor,
        note: t.reference ?? undefined,
      };
    case "other":
    default:
      // Unmodelled kind — the caller counts these rather than dropping silently.
      return null;
  }
}

/** dividendToCashEvent — a persisted dividend -> a "dividend" CashEvent with the
 *  ticker cleaned. amountMinor stays positive (engine applies sign by kind). */
export function dividendToCashEvent(d: HistoryDividend): CashEvent {
  return {
    kind: "dividend",
    dateISO: d.dateISO,
    amountMinor: d.amountMinor,
    ticker: cleanTicker(d.ticker),
  };
}

/**
 * toCashEvents — the full cash-event list the engine consumes, from all
 * transactions + dividends. Returns the events plus a count of skipped "other"
 * transactions so the caller can surface the honest gap rather than hide it.
 */
export function toCashEvents(
  txns: HistoryTransaction[],
  dividends: HistoryDividend[],
): { events: CashEvent[]; skippedOther: number } {
  const events: CashEvent[] = [];
  let skippedOther = 0;
  for (const t of txns) {
    const e = transactionToCashEvent(t);
    if (e) events.push(e);
    else skippedOther += 1;
  }
  for (const d of dividends) events.push(dividendToCashEvent(d));
  return { events, skippedOther };
}

/**
 * pageAllKnown — the incremental-stop predicate. True when EVERY id on this page
 * is already present in `knownIds` AND the table was already non-empty (so this
 * is a genuine catch-up, not an empty first run that happens to fetch an empty
 * page). When true, the sync stops paginating: everything older than this page
 * is guaranteed already persisted (history is fetched newest-first). An empty
 * page is treated as "all known" (nothing new to persist) only when non-empty —
 * an empty first page on an empty table means "no history at all", also a stop.
 */
export function pageAllKnown(
  pageIds: string[],
  knownIds: ReadonlySet<string>,
  tableWasNonEmpty: boolean,
): boolean {
  if (pageIds.length === 0) return true; // nothing new on this page — stop
  if (!tableWasNonEmpty) return false; // first run: keep back-filling to exhaustion
  return pageIds.every((id) => knownIds.has(id));
}

/**
 * snapshotMinuteKey — truncate an ISO timestamp to the MINUTE for the
 * equity_snapshots primary key, so the 5-minute poller firing twice inside one
 * clock-minute dedupes to a single recorded point (INSERT OR REPLACE on the key)
 * instead of littering the value curve with near-duplicate marks. Returns the
 * canonical "YYYY-MM-DDTHH:MM:00.000Z" form. An unparsable input falls back to
 * the raw string (defensive — never throws so a bad clock can't break sync).
 */
export function snapshotMinuteKey(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

/* ====================== SYNC_META CURSOR PERSISTENCE ====================== */

async function readCursor(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ v: string | null }[]>(
    `SELECT v FROM sync_meta WHERE account_id = ? AND k = ?`,
    [ACCOUNT_ID, key],
  );
  return rows[0]?.v ?? null;
}

async function writeCursor(key: string, cursor: string | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO sync_meta (account_id, k, v) VALUES (?, ?, ?)
     ON CONFLICT(account_id, k) DO UPDATE SET v = excluded.v`,
    [ACCOUNT_ID, key, cursor],
  );
}

/* ====================== TRUTH LOAD ====================== */

/**
 * loadTruth — read all persisted history + the live positions/account, run the
 * PURE Performance-Truth engine, and publish the result through TruthStore. Safe
 * to call repeatedly (idempotent read); a NO-OP under VITE_MOCK. Never throws
 * out — a DB read failure leaves the last-good truth in place.
 */
export async function loadTruth(): Promise<void> {
  if (IS_MOCK) return;
  try {
    const [orderFills, dividends, txns, snapshots] = await Promise.all([
      readAllOrderFills(),
      readAllDividends(),
      readAllTransactions(),
      readAllEquitySnapshots(),
    ]);

    // Live positions (the honest "now" mark) + account currency come from the
    // live orchestrator's shared State. State.positions is the sym->{qty,avgCost}
    // book; the engine needs the full Position shape, so we reconstruct the
    // fields computeTruth actually reads (currentValue + unrealised P/L) from the
    // live account when present. When there are no live positions (mock world or
    // pre-first-sync), the engine sees an empty array — honest, not fabricated.
    const ccy =
      (State.liveAccount && State.liveAccount.ccy) || State.accountCcy || "GBP";
    TruthStore.ccy = ccy;

    const trades = fillsToTrades(orderFills);
    const { events } = toCashEvents(txns, dividends);

    // Positions for the truth: the live book carries per-symbol qty/avgCost but
    // not a live mark here (that lives in DataEngine.quotes). We hand computeTruth
    // the account-level unrealised P/L and current value via a single synthetic
    // Position ONLY when the live account reports them, so unrealised/currentValue
    // are honest live figures rather than a re-derivation. best/worst come from
    // real positions elsewhere (Dashboard); the truth store's headline does not
    // need per-holding refs, so an empty positions array with the account figures
    // folded in as one aggregate keeps the split exact without inventing holdings.
    const asOfISO = new Date().toISOString();
    const positions =
      State.liveAccount && State.liveAccount.totalMinor > 0
        ? [
            {
              ticker: "__ACCOUNT__",
              isin: null,
              name: null,
              instrumentCurrency: null,
              quantity: 0,
              avgPriceMinor: 0,
              currentPriceMinor: 0,
              accountCurrency: ccy,
              currentValueMinor: State.liveAccount.totalMinor,
              // PURE unrealised — NOT pplMinor (that field is the masthead's
              // TOTAL RETURN, i.e. unrealised + realised; using it here would
              // double-count realised once computeTruth adds its own replay).
              unrealizedPlMinor: State.liveAccount.unrealMinor,
              fxImpactMinor: 0,
              totalCostMinor: 0,
              raw: null,
            },
          ]
        : [];

    // No live account yet (a screen-mount sync can beat the first live refresh):
    // publishing a truth with currentValue/unrealised = 0 would flash a fake
    // "▲ 0.00" TRUTH DECK tagged LIVE. Keep truth null until the account is real;
    // fills/dividends/series are still real and publish below.
    const truth = State.liveAccount ? computeTruth(events, trades, positions, asOfISO, ccy) : null;

    const snaps: EquitySnapshot[] = snapshots.map((s) => ({
      atISO: s.atISO,
      totalValueMinor: s.totalValueMinor,
      netDepositsMinor: s.netDepositsMinor,
    }));
    const series = {
      netDeposits: netDepositsSeries(events, asOfISO),
      realised: realisedSeries(trades, asOfISO),
      value: valueSeries(snaps),
    };

    // Fills for the History screen: executed-only, enriched with the cleaned
    // display symbol, NEWEST-FIRST (readAll* returns ASC; reverse for the list).
    const fills: FillRow[] = orderFills
      .filter(isExecutedFill)
      .map((f) => ({ ...f, sym: cleanTicker(f.ticker) }))
      .reverse();

    TruthStore.truth = truth;
    TruthStore.series = series;
    TruthStore.fills = fills;
    TruthStore.dividends = [...dividends].reverse(); // newest-first
    TruthStore.firstSnapshotISO = snaps.length ? snaps[0].atISO : null;
    TruthStore.notify();
  } catch (err) {
    // Read failure — keep the last-good store, mark error, stay honest.
    console.warn("loadTruth failed (kept last-good):", err);
  }
}

/* ====================== SNAPSHOT RECORDING ====================== */

// Net deposits are only KNOWN once history sync has completed at least once
// (deposits/withdrawals are transaction rows). Until then we must NOT record a
// value snapshot — an invented net-deposits figure would let a fresh top-up
// masquerade as a gain, the exact dishonesty this app exists to prevent.
let historySyncedOnce = false;

/**
 * recordSnapshot — persist one honestly-RECORDED mark-to-market point. Computes
 * net deposits from the persisted transaction rows (deposit − withdrawal),
 * truncates at_iso to the minute (dedupes the 5-min poller within a minute), and
 * INSERT OR REPLACEs. NO-OP under VITE_MOCK, and — critically — a NO-OP until
 * history sync has completed at least once, so it never writes a snapshot with
 * invented deposits. Best-effort: a DB error is swallowed (the live world stands).
 */
export async function recordSnapshot(totalValueMinor: number, ccy: string): Promise<void> {
  if (IS_MOCK) return;
  if (!historySyncedOnce) return; // net deposits not yet known — never invent them
  if (!(totalValueMinor > 0)) return; // no honest value to record
  try {
    const txns = await readAllTransactions();
    let netDepositsMinor = 0;
    for (const t of txns) {
      if (t.kind === "deposit") netDepositsMinor += t.amountMinor;
      else if (t.kind === "withdrawal") netDepositsMinor -= t.amountMinor;
    }
    await upsertEquitySnapshot({
      atISO: snapshotMinuteKey(new Date().toISOString()),
      totalValueMinor,
      netDepositsMinor,
      ccy,
    });
  } catch (err) {
    console.warn("recordSnapshot failed (skipped):", err);
  }
}

/* ====================== THE SYNC ====================== */

let syncInFlight = false;

/**
 * syncTable — the shared incremental paginate for one history stream. Fetches
 * page 1 (newest-first), upserts, and STOPS when the page is entirely already-
 * known (catch-up); otherwise follows nextCursor to exhaustion (first-run
 * back-fill), persisting the cursor into sync_meta so an interruption resumes.
 * Returns nothing; throws propagate to startHistorySync's per-table guard.
 */
async function syncTable<T extends { id: string }>(
  cursorKey: string,
  fetchPage: (
    cursor: string | null,
  ) => Promise<{ items: T[]; nextCursor: string | null; rawCount: number; skippedSample: unknown | null }>,
  upsert: (items: T[]) => Promise<void>,
  readAllIds: () => Promise<string[]>,
): Promise<void> {
  const knownBefore = new Set(await readAllIds());
  const tableWasNonEmpty = knownBefore.size > 0;

  // Resume an interrupted back-fill from the persisted cursor when the table is
  // already non-empty; a fresh table always starts at page 1 (cursor = null).
  const resumeCursor = tableWasNonEmpty ? await readCursor(cursorKey) : null;
  let cursor: string | null = resumeCursor;

  // POISONED-RESUME RECOVERY: if the very first fetch at a RESUMED cursor fails
  // (older builds persisted a lossy token the server rejects — the frozen
  // transactions back-fill), clear the cursor and RE-WALK from page 1 to
  // exhaustion, IGNORING the all-known early stop (upserts are idempotent, so a
  // full re-walk is safe — just slow). Without the full walk, page 1 would read
  // all-known and stop, permanently orphaning everything older than the freeze.
  let forceFullWalk = false;

  // Loop-safety state: the cursor token is round-tripped OPAQUELY (extractCursor
  // may fall back to the whole nextPagePath), so a server that doesn't advance it
  // would otherwise serve the same page forever at one request per 10s. We stop
  // on any repeated cursor, and on any page whose ids we already saw THIS run.
  const seenCursors = new Set<string>();
  const seenThisRun = new Set<string>();

  for (;;) {
    let page: Awaited<ReturnType<typeof fetchPage>>;
    try {
      page = await fetchPage(cursor);
    } catch (err) {
      if (cursor !== null && cursor === resumeCursor && !forceFullWalk) {
        console.warn(
          `history sync (${cursorKey}): resume cursor rejected — re-walking from page 1`,
          err,
        );
        await writeCursor(cursorKey, null);
        cursor = null;
        forceFullWalk = true; // disable the all-known stop: walk to exhaustion
        continue;
      }
      throw err; // a mid-walk failure propagates (cursor persisted → resumes next run)
    }
    await upsert(page.items);

    // DIAGNOSTIC: a raw row that failed normalization means the broker's shape
    // drifted from the parser — persist ONE sample (broker data, no credentials)
    // so the drift is diagnosable from the DB instead of vanishing silently.
    if (page.skippedSample !== null) {
      try {
        await writeCursor(
          cursorKey + ":skipped_sample",
          JSON.stringify(page.skippedSample).slice(0, 4000),
        );
      } catch { /* best-effort */ }
    }

    const pageIds = page.items.map((it) => it.id);

    if (pageIds.length === 0) {
      // Distinguish "genuinely no rows" from "every raw row failed normalization":
      // stopping on the latter would silently truncate the back-fill (everything
      // older never fetched — understated deposits/realised with no error shown).
      if (page.rawCount > 0 && page.nextCursor) {
        console.warn(
          `history sync (${cursorKey}): page of ${page.rawCount} raw rows all failed normalization — following cursor`,
        );
        // fall through to the cursor-follow below
      } else {
        await writeCursor(cursorKey, null); // truly empty — end of history
        return;
      }
    } else if (cursor !== null && cursor === resumeCursor && pageAllKnown(pageIds, knownBefore, true)) {
      // SILENT-IGNORE RECOVERY: a genuinely-resumed page can NEVER be all-known
      // (its resume point was persisted BEFORE that page was fetched), so an
      // all-known page at a resumed cursor means the server IGNORED the token
      // and served page 1 — stopping here would orphan everything older than
      // the newest page with no error (observed live: transactions frozen at 50
      // rows, "done", deposits silently undercounted). Discard the token and
      // re-walk from page 1 to exhaustion.
      console.warn(`history sync (${cursorKey}): resume token ignored by server — re-walking from page 1`);
      await writeCursor(cursorKey, null);
      cursor = null;
      forceFullWalk = true;
      continue;
    } else if (
      // forceFullWalk disables the all-known stop (a re-walk after a poisoned
      // resume MUST reach exhaustion to recover the orphaned older pages); the
      // repeated-page guard always applies (loop safety).
      (!forceFullWalk && pageAllKnown(pageIds, knownBefore, tableWasNonEmpty)) ||
      pageIds.every((id) => seenThisRun.has(id)) // repeated page THIS run — server not advancing
    ) {
      await writeCursor(cursorKey, null); // back-fill complete/none — clear resume point
      return;
    }
    pageIds.forEach((id) => seenThisRun.add(id));

    if (!page.nextCursor) {
      await writeCursor(cursorKey, null); // exhausted — nothing left to resume
      return;
    }
    if (page.nextCursor === cursor || seenCursors.has(page.nextCursor)) {
      // The server handed back a cursor we already used — a loop, not progress.
      console.warn(`history sync (${cursorKey}): cursor did not advance — stopping`);
      await writeCursor(cursorKey, null);
      return;
    }
    seenCursors.add(page.nextCursor);

    // More history to back-fill — persist the resume point BEFORE fetching on so
    // an interrupted run picks up here next launch instead of restarting.
    cursor = page.nextCursor;
    await writeCursor(cursorKey, cursor);
  }
}

/**
 * startHistorySync — the idempotent kick. NO-OP under VITE_MOCK, when a sync is
 * already in flight, or when there are no credentials. Syncs each stream in
 * turn, publishing through TruthStore after each table lands so screens fill
 * progressively (orders first, then dividends, then transactions). Sets
 * TruthStore.sync through "syncing" -> "done" / "error". Never blocks first
 * paint (the caller `void`s it) and never throws out.
 */
// Cooldown: Orders/Journal/Performance each kick startHistorySync on mount, so
// without this, cycling screens (Q/E) after a completed sync re-runs a full
// 3-endpoint catch-up on every navigation — each history request parks the
// shared adapter queue for 10s and starves the ordinary 1.2s-paced calls behind
// it. 5 minutes matches the live poller, the natural re-sync heartbeat.
let lastSyncDoneAt = 0;
let lastSyncHadError = false;
const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
// A FAILED sync retries fast (a fixed key / recovered network shouldn't wait out
// the full cooldown) while still damping screen-mount retry spam.
const SYNC_ERROR_RETRY_MS = 30 * 1000;

export function startHistorySync(): void {
  if (IS_MOCK || syncInFlight) return;
  if (Date.now() - lastSyncDoneAt < (lastSyncHadError ? SYNC_ERROR_RETRY_MS : SYNC_COOLDOWN_MS)) return;
  syncInFlight = true;
  void (async () => {
    let creds: Credentials | null;
    try {
      creds = await getCreds();
    } catch {
      creds = null;
    }
    if (!creds) {
      // No key: honest — no history claim. Leave the store idle.
      syncInFlight = false;
      return;
    }

    TruthStore.sync = "syncing";
    TruthStore.syncError = null;
    TruthStore.notify();
    const c = creds; // narrowed, stable reference for the closures below
    let anyError = false;
    // Keep the last failure's honest reason for the screens (endpoint + status
    // kind only — an Error message from the adapter never carries a secret).
    const noteError = (err: unknown) => {
      TruthStore.syncError = String(err instanceof Error ? err.message : err).slice(0, 160);
    };

    // ORDERS -----------------------------------------------------------------
    try {
      // a fresh attempt clears the stream's persisted error — a stale one must
      // not masquerade as the CURRENT failure during diagnosis
      await writeCursor(CURSOR_KEYS.orders + ":last_error", null);
      await syncTable(
        CURSOR_KEYS.orders,
        (cursor) => fetchOrderHistoryPage(c, ENV, cursor),
        upsertOrderFills,
        async () => (await readAllOrderFills()).map((f) => f.id),
      );
      await loadTruth();
      TruthStore.notify();
    } catch (err) {
      anyError = true;
      noteError(err);
      // persist the reason so failures are diagnosable from the DB (sqlite3),
      // even when the screens' error line isn't showing (fills already present)
      void writeCursor(CURSOR_KEYS.orders + ":last_error", String(err).slice(0, 300)).catch(() => undefined);
      console.warn("history sync (orders) failed:", err);
    }

    // DIVIDENDS --------------------------------------------------------------
    try {
      // a fresh attempt clears the stream's persisted error — a stale one must
      // not masquerade as the CURRENT failure during diagnosis
      await writeCursor(CURSOR_KEYS.dividends + ":last_error", null);
      await syncTable(
        CURSOR_KEYS.dividends,
        (cursor) => fetchDividendsPage(c, ENV, cursor),
        upsertDividends,
        async () => (await readAllDividends()).map((d) => d.id),
      );
      await loadTruth();
      TruthStore.notify();
    } catch (err) {
      anyError = true;
      noteError(err);
      // persist the reason so failures are diagnosable from the DB (sqlite3),
      // even when the screens' error line isn't showing (fills already present)
      void writeCursor(CURSOR_KEYS.dividends + ":last_error", String(err).slice(0, 300)).catch(() => undefined);
      console.warn("history sync (dividends) failed:", err);
    }

    // TRANSACTIONS -----------------------------------------------------------
    let txnsSynced = false;
    try {
      // a fresh attempt clears the stream's persisted error — a stale one must
      // not masquerade as the CURRENT failure during diagnosis
      await writeCursor(CURSOR_KEYS.transactions + ":last_error", null);
      await syncTable(
        CURSOR_KEYS.transactions,
        (cursor) => fetchTransactionsPage(c, ENV, cursor),
        upsertTransactions,
        async () => (await readAllTransactions()).map((t) => t.id),
      );
      txnsSynced = true;
      await loadTruth();
      TruthStore.notify();
    } catch (err) {
      anyError = true;
      noteError(err);
      // persist the reason so failures are diagnosable from the DB (sqlite3),
      // even when the screens' error line isn't showing (fills already present)
      void writeCursor(CURSOR_KEYS.transactions + ":last_error", String(err).slice(0, 300)).catch(() => undefined);
      console.warn("history sync (transactions) failed:", err);
    }

    // Snapshots may record once the transactions HEAD has landed (the newest-
    // first first page — recent deposits are then complete). The VALUE line
    // never depended on old deposits (valueSeries is a totalValue passthrough),
    // so deep-history gaps (the T212 pagination-404 bug) must not keep the
    // curve unborn; the stored netDepositsMinor is best-known and the gap is
    // surfaced honestly via txnsPartial below.
    const txnRowCount = txnsSynced ? 1 : (await readAllTransactions().catch(() => [])).length;
    if (txnsSynced || txnRowCount > 0) historySyncedOnce = true;

    // HONESTY FLAG: while the transactions back-fill is known-incomplete
    // (errored this run, or a resume cursor is still parked), NET CONTRIBUTIONS
    // is understated and TOTAL GAIN may overstate — the truth deck says so.
    try {
      const parked = await readCursor(CURSOR_KEYS.transactions);
      TruthStore.txnsPartial = !txnsSynced || parked !== null;
    } catch {
      TruthStore.txnsPartial = !txnsSynced;
    }
    TruthStore.sync = anyError ? "error" : "done";
    TruthStore.syncedAtISO = new Date().toISOString();
    TruthStore.notify();
    lastSyncDoneAt = Date.now();
    lastSyncHadError = anyError;
    syncInFlight = false;
  })();
}
