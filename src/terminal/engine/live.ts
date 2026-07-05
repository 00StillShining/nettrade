// live.ts — the LIVE ORCHESTRATOR (phase 2a).
//
// Flips the roster / Positions / account masthead from the seed-77 mock world to
// the user's REAL Trading 212 holdings + live prices. The engine is designed for
// this: injecting into DataEngine.quotes[sym] + setting UNIVERSE[sym]._liveHeld
// makes the mock walk skip that symbol, and screens re-render via notify().
//
// Data flow (all READ-ONLY — never places a trade / moves money):
//   Trading 212  → the real holdings (symbol, qty, avgCost, current price) + the
//                  account value / buying power / P&L (State + roster + masthead).
//   FMP          → day-% enrichment on the held symbols (T212 gives the price
//                  level but not today's move) — optional, only if a key is set.
//   Coinbase     → any crypto holdings (keyless), via the mapped pair.
//
// HONEST FALLBACK: no T212 key or a failed fetch → we leave the mock world intact
// and provider stays MOCK (never a fabricated "live"). A held symbol with no live
// price keeps its synthetic price, clearly still mock. Under VITE_MOCK the whole
// module is a NO-OP so design builds stay seed-77.

import { invoke } from "@tauri-apps/api/core";
import {
  fetchPositions,
  fetchAccountCash,
  type Credentials,
  type Position,
} from "../../adapters/trading212";
import { fmpBatchQuotes, fmpProfile, fmpHasKey, resetFmpKeyCache } from "../../adapters/fmp";
import {
  DataEngine,
  UNIVERSE,
  DEFAULT_ROSTER,
  HIST_POINTS,
  RANGES,
  genHistory,
  clamp,
  type Range,
  type InstrumentProfile,
} from "./dataEngine";
import { seedFromString } from "./prng";
import { State, notifyState } from "../state";
import { startHistorySync, recordSnapshot, loadTruth } from "./liveHistory";

const IS_MOCK = import.meta.env.VITE_MOCK === "1";

/** T212 tickers look like "AAPL_US_EQ" / "NVDA_US_EQ"; take the leading symbol. */
function cleanTicker(t: string): string {
  return (t.split("_")[0] || t).trim().toUpperCase();
}

/** A held symbol that trades as crypto → its Coinbase pair (keyless live). */
const CRYPTO_PAIR: Record<string, string> = { BTC: "BTC-USD", ETH: "ETH-USD" };

/** Synthesize a neutral UNIVERSE entry for a held symbol not in the seed world,
 *  so the roster / radar / charts have something to read (they isFinite-guard). */
function ensureUniverse(sym: string, name: string | null): void {
  if (UNIVERSE[sym]) return;
  UNIVERSE[sym] = {
    name: name || sym,
    base: 100,
    drift: 0.04,
    vol: 0.22,
    sector: "—",
    exch: "—",
    style: "—",
    tags: [],
    mcap: 0,
    pe: NaN,
    div: 0,
    beta: 1,
    avgvol: 0,
    live: false,
    bio: "Live holding — profile pending.",
    priors: "",
    _liveHeld: false,
  } as InstrumentProfile;
}

/** Ensure DataEngine.quotes[sym] exists (seeded mock history) before folding in a
 *  live price. Mirrors DataEngine.init()'s per-symbol seeding. */
function ensureQuote(sym: string): void {
  if (DataEngine.quotes[sym]) return;
  const s = DataEngine.seed ^ seedFromString(sym);
  const day = genHistory(sym, HIST_POINTS["1D"], s, "1D");
  const hist = {} as Record<Range, number[]>;
  RANGES.forEach((r) => {
    hist[r] = genHistory(sym, HIST_POINTS[r], s ^ (r.charCodeAt(0) * 131), r);
  });
  hist["1D"] = day;
  const last = day[day.length - 1];
  const prevClose = day[0];
  DataEngine.quotes[sym] = { sym, hist, day, last, prevClose, dayPct: (last / prevClose - 1) * 100 };
}

/** Fold a live PRICE LEVEL into a symbol's quote (scaling the whole synthetic
 *  series so only the level moves — the intraday CHART stays modeled until 2c).
 *  If dayPct is known (from FMP), anchor prevClose to it; else derive from series.
 *  Marks the symbol _liveHeld so the mock walk skips it. */
function foldLivePrice(sym: string, price: number, dayPct?: number): void {
  const q = DataEngine.quotes[sym];
  if (!q || !(price > 0)) return;
  const scale = price / q.last;
  q.day = q.day.map((v) => v * scale);
  q.hist["1D"] = q.day;
  (["1W", "1M", "1Y"] as Range[]).forEach((r) => { q.hist[r] = q.hist[r].map((v) => v * scale); });
  q.prevClose *= scale;
  q.last = price;
  if (dayPct !== undefined && Number.isFinite(dayPct)) {
    q.dayPct = clamp(dayPct, -50, 50);
    q.prevClose = q.last / (1 + q.dayPct / 100);
  } else {
    q.dayPct = clamp((q.last / q.prevClose - 1) * 100, -50, 50);
  }
  if (UNIVERSE[sym]) UNIVERSE[sym]._liveHeld = true;
}

// Same reasoning as the FMP key (see fmp.ts): the Keychain read prompts on a
// self-signed build, so read the T212 credentials ONCE per launch and cache them.
// Without this, every 5-minute refresh re-prompts. `resetLiveCaches()` drops the
// cache (and the FMP one) when the user saves/clears a key in Settings.
let credsPromise: Promise<Credentials | null> | undefined;

/** Drop the cached credentials + market-data key so the next sync re-reads them.
 *  Call after the user saves or clears a key in Settings. */
export function resetLiveCaches(): void {
  credsPromise = undefined;
  resetFmpKeyCache();
  // A saved/cleared key means the next sync may be a DIFFERENT account — let the
  // history back-fill re-kick on the following refresh (guard defined below).
  historyKicked = false;
}

/** Read the T212 credentials from the Keychain, cached once per launch (see the
 *  comment above `credsPromise`). Exported so liveHistory.ts can reuse the SAME
 *  cached read path — there must be exactly ONE Keychain read discipline, never
 *  a second prompt source. */
export async function getCreds(): Promise<Credentials | null> {
  if (credsPromise) return credsPromise;
  credsPromise = (async () => {
    try {
      // Touch ID store FIRST (if enabled) — the biometric item holds the same JSON
      // payload the password item did ({apiKey, apiSecret}). Prompts Touch ID once
      // per launch (promise-cached). When on, the password copy is gone.
      if (await invoke<boolean>("keychain_bio_has", { slot: "creds" }).catch(() => false)) {
        const payload = await invoke<string | null>("keychain_bio_get", { slot: "creds" });
        if (payload) {
          const c = JSON.parse(payload) as { apiKey?: string; apiSecret?: string };
          if (c && typeof c.apiKey === "string" && c.apiKey.length > 0) {
            return { apiKey: c.apiKey, apiSecret: typeof c.apiSecret === "string" ? c.apiSecret : "" };
          }
        }
        return null;
      }
      const c = await invoke<{ apiKey: string; apiSecret: string } | null>(
        "keychain_get_credentials",
        { accountId: "default" },
      );
      if (c && typeof c.apiKey === "string" && c.apiKey.length > 0) {
        return { apiKey: c.apiKey, apiSecret: typeof c.apiSecret === "string" ? c.apiSecret : "" };
      }
      return null;
    } catch {
      // no keychain access / prompt dismissed → treat as no key, and drop the
      // cache so a later refresh can retry rather than being stuck on mock.
      credsPromise = undefined;
      return null;
    }
  })();
  return credsPromise;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let inFlight = false;

// phase 2c — the history back-fill is kicked at most ONCE per launch (the 5-min
// poller must not re-paginate the rate-limited history every tick); a manual
// refreshLive() forces a re-kick by clearing this flag. startHistorySync() is
// itself idempotent (in-flight guarded), so this is belt-and-braces on top.
let historyKicked = false;
function kickHistoryOnce(): void {
  if (historyKicked) return;
  historyKicked = true;
  void startHistorySync();
}

/** One live sync. Defensive throughout — any failure leaves the last-good/mock
 *  world intact and never blanks or crashes the app. */
async function refresh(): Promise<void> {
  if (IS_MOCK || inFlight) return;
  inFlight = true;
  try {
    const creds = await getCreds();
    if (!creds) {
      // No key: honest — no live claim. Leave the mock world running.
      DataEngine.provider = "MOCK";
      DataEngine.live = false;
      DataEngine.accountLive = false;
      return;
    }

    let positions: Position[];
    let cashCcy: string | null = null;
    let totalMinor = 0;
    let freeMinor = 0;
    let pplMinor = 0;
    let resultMinor = 0;
    try {
      positions = await fetchPositions(creds, "live");
    } catch {
      DataEngine.provider = "MOCK"; // T212 unreachable → keep last-good; don't fake live
      DataEngine.live = false;
      DataEngine.accountLive = false;
      return;
    }
    try {
      const cash = await fetchAccountCash(creds, "live");
      cashCcy = cash.currency;
      totalMinor = cash.totalMinor;
      freeMinor = cash.freeMinor;
      pplMinor = cash.pplMinor;
      resultMinor = cash.resultMinor;
    } catch {
      /* cash summary optional — value falls back to Σ position value below */
    }

    if (!positions.length) {
      // Connected but no open positions: honest empty portfolio, real cash.
      State.positions = {};
      if (freeMinor) State.cash = freeMinor / 100;
      State.accountCcy = cashCcy || State.accountCcy;
      // pplMinor = TOTAL RETURN for the masthead (an all-closed account still
      // shows its realised result); unrealMinor = pure unrealised (cash.ppl).
      State.liveAccount = totalMinor
        ? { totalMinor, freeMinor, pplMinor: pplMinor + resultMinor, unrealMinor: pplMinor, ccy: cashCcy }
        : null;
      DataEngine.provider = "LIVE";
      DataEngine.live = true;
      DataEngine.accountLive = true;
      DataEngine.notify();
      notifyState();
      // phase 2c — connected with no open positions still has cash-event /
      // dividend history worth syncing (deposits, interest, closed-position
      // dividends). Kick the back-fill and record an honest value snapshot
      // (recordSnapshot no-ops until history sync has completed once). loadTruth
      // is CHAINED after the snapshot so the fresh point is in the series it reads.
      kickHistoryOnce();
      void recordSnapshot(totalMinor || freeMinor, cashCcy || State.accountCcy).then(() => loadTruth());
      return;
    }

    // --- build the real holdings ---
    const held = positions.map((p) => {
      const raw = cleanTicker(p.ticker);
      const sym = CRYPTO_PAIR[raw] ?? raw;
      return {
        sym,
        qty: p.quantity,
        avgCost: p.avgPriceMinor / 100,
        price: p.currentPriceMinor / 100,
        name: p.name,
      };
    });
    const syms = held.map((h) => h.sym);

    // rebuild the roster IN PLACE (the engine + screens iterate DEFAULT_ROSTER)
    DEFAULT_ROSTER.length = 0;
    DEFAULT_ROSTER.push(...syms);

    // ensure universe + quotes, fold T212's current price in as the live level,
    // and set the real book.
    const book: Record<string, { qty: number; avgCost: number }> = {};
    held.forEach((h) => {
      ensureUniverse(h.sym, h.name);
      ensureQuote(h.sym);
      foldLivePrice(h.sym, h.price); // T212 price level (day-% enriched below if FMP is up)
      book[h.sym] = { qty: h.qty, avgCost: h.avgCost };
    });
    State.positions = book;

    // --- ACCOUNT MASTHEAD figures, all in the ACCOUNT currency ---
    // T212's /equity/account/cash does NOT return the account currency, and per
    // account / under rate-limiting it can come back with `total`/`ppl` absent
    // (=0). So we derive the headline from the POSITIONS: each carries an
    // account-currency `walletImpact` (value + P/L + currency) — no FX mixing.
    // /cash is used for free cash (buying power) and as the preferred total when
    // it actually reports one.
    const acctCcy =
      positions.find((p) => p.accountCurrency)?.accountCurrency || cashCcy || State.accountCcy;
    const investedMinor = positions.reduce((s, p) => s + (p.currentValueMinor || 0), 0);
    const posPplMinor = positions.reduce((s, p) => s + (p.unrealizedPlMinor || 0), 0);
    const acctTotalMinor = totalMinor > 0 ? totalMinor : investedMinor + freeMinor;
    // TOTAL RETURN = unrealised (open positions) + realised (closed positions).
    // The user's headline "+£40" is their total return; open positions alone can
    // net to ~£0 while realised gains carry the account. /cash reports both; if it's
    // unavailable, fall back to summing the open positions' unrealised P&L only.
    const unrealMinor = pplMinor !== 0 ? pplMinor : posPplMinor;
    const acctPplMinor = unrealMinor + resultMinor;

    if (freeMinor) State.cash = freeMinor / 100;
    State.accountCcy = acctCcy;
    // positions exist on this path, so we always have a real headline to show.
    State.liveAccount = { totalMinor: acctTotalMinor, freeMinor, pplMinor: acctPplMinor, unrealMinor, ccy: acctCcy };
    if (!syms.includes(State.selected)) State.selected = syms[0];


    // mark the crypto holdings as Coinbase-capable so DataEngine.tryLive picks them up
    held.forEach((h) => { if (CRYPTO_PAIR[cleanTicker(h.sym)] || h.sym.includes("-USD")) { if (UNIVERSE[h.sym]) UNIVERSE[h.sym].live = true; } });

    // FAST FIRST PAINT: the real portfolio (holdings + T212 prices + account value)
    // is ready now — show it immediately; the FMP day-% + profile enrichment below
    // (rate-limited ~1/s on a cold cache) then refines it and notifies again.
    DataEngine.provider = "LIVE";
    DataEngine.live = true;
    DataEngine.accountLive = true;
    DataEngine.notify();
    notifyState();

    // phase 2c — kick the incremental history back-fill AFTER first paint so it
    // never blocks the portfolio showing (the ~6/min history endpoints are slow).
    // Idempotent + once-per-launch; a manual refreshLive() re-kicks it.
    kickHistoryOnce();

    // --- FMP day-% enrichment (stocks only; optional) ---
    try {
      if (await fmpHasKey()) {
        const stockSyms = syms.filter((s) => !s.includes("-USD"));
        if (stockSyms.length) {
          const quotes = await fmpBatchQuotes(stockSyms);
          quotes.forEach((fq) => {
            const sym = (fq.symbol || "").toUpperCase();
            if (!DataEngine.quotes[sym]) return;
            const price = fq.price != null && fq.price > 0 ? fq.price : DataEngine.quotes[sym].last;
            const pct = fq.changesPercentage != null && Number.isFinite(fq.changesPercentage) ? fq.changesPercentage : undefined;
            foldLivePrice(sym, price, pct);
          });
          // 2b — enrich each holding's profile (real name/sector/mktcap/beta/bio).
          // Cached 24h in the adapter so this is ~one call per symbol per DAY,
          // well within the 250/day budget. Best-effort: a paid-gated / failed
          // profile leaves the synthesized placeholder ("—") in place, honestly.
          await Promise.all(stockSyms.map(async (sym) => {
            try {
              const prof = await fmpProfile(sym);
              const p = UNIVERSE[sym];
              if (!prof || !p) return;
              if (prof.companyName) p.name = prof.companyName;
              if (prof.sector) p.sector = prof.sector;
              if (prof.marketCap != null && prof.marketCap > 0) p.mcap = prof.marketCap;
              if (prof.beta != null && Number.isFinite(prof.beta)) p.beta = prof.beta;
              if (prof.description) p.bio = prof.description;
            } catch { /* profile unavailable → keep the synthesized placeholder */ }
          }));
        }
      }
    } catch {
      /* enrichment best-effort — the T212 price level already stands */
    }

    DataEngine.provider = "LIVE";
    DataEngine.live = true;
    DataEngine.accountLive = true;
    DataEngine.notify();
    notifyState();

    // phase 2c — end of a successful refresh: record ONE honest value snapshot at
    // the freshly-confirmed account total (minute-deduped; a no-op until the
    // history back-fill has completed at least once, so net deposits are known
    // and never invented), then re-run the pure Performance-Truth load so the
    // History/Performance screens reflect the latest live mark.
    // chained so the freshly-recorded snapshot is included in the series loadTruth
    // publishes (concurrent voids left the newest value dot one refresh behind).
    void recordSnapshot(acctTotalMinor, acctCcy).then(() => loadTruth());
  } finally {
    inFlight = false;
  }
}

/** Start the live sync. intervalMs<=0 → one-shot (MANUAL refresh); else poll. */
export function startLive(intervalMs: number): void {
  if (IS_MOCK || running) return;
  running = true;
  void refresh();
  if (intervalMs > 0) timer = setInterval(() => void refresh(), intervalMs);
}

export function stopLive(): void {
  running = false;
  if (timer) { clearInterval(timer); timer = null; }
}

/** Force an immediate live sync (e.g. after the user saves a key or hits refresh).
 *  Clears the once-per-launch history guard so a MANUAL refresh also re-kicks the
 *  history back-fill/catch-up (startHistorySync is still in-flight-guarded, so a
 *  re-kick while one is running is a no-op). */
export function refreshLive(): void {
  historyKicked = false;
  void refresh();
}
