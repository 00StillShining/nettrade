/* =========================================================================
   TERMINAL 77 — TERMINAL STATE SINGLETON (ported from prototypes/terminal-77)

   The prototype kept one page-global State object plus per-screen state
   blocks (Scan/Alerts/Compare/News/Journal/Perf) and mutated them from
   render functions. The port keeps the exact same SHAPES (parity: seeded
   starter book, positions, pre-armed watches, compare slots) but moves them
   into ONE module-scoped singleton with a tiny subscribe/notify, so React
   screens re-render on state changes WITHOUT tearing down their canvases —
   the calc/render separation the indicator brief mandated.

   RULES OF THE ROAD:
   • engine/* never imports this file (module graph stays acyclic; the engine
     is pure and standalone-testable). Where the prototype's engine code read
     page globals (portfolio closes, news held-qty, watch star bits), the
     engine takes the dependency as an argument and THIS file supplies it.
   • Mutating helpers end with notifyState() — screens subscribe once and
     repaint from the singleton. DataEngine ticks notify separately through
     DataEngine.subscribe (the shell owns that clock).
   ========================================================================= */

import {
  DataEngine, UNIVERSE, DEFAULT_ROSTER, HIST_POINTS, genHistory, clamp, fmtUSD,
  type Range, type Quote,
} from "./engine/dataEngine";
import { seedFromString } from "./engine/prng";
import {
  ohlcFromCloses, genSyntheticCloses, genPortfolioCloses,
  type Bar, type Book,
} from "./engine/ohlc";
import { INDICATOR_CALC, type BollingerBands, type SuperTrendResult, type StochRsiResult, type MacdResult } from "./engine/indicators";
import { THRESHOLDS, SIGNAL_CALC, type RsiCycleResult, type EmaCompressionResult, type DivergenceMark } from "./engine/signals";
import { SCAN_CALC, type ScanPresetKey, type ScanResult } from "./engine/scan";
import { COMPARE_CALC, type CmpMetrics } from "./engine/compare";
import {
  computeRegime, evaluateWatches, ALERT_METRICS,
  type Watch, type WatchMetric, type WatchOp, type RegimeReport,
} from "./engine/alerts";
import { NewsEngine, type NewsLaneKey } from "./engine/news";

/* ================= SUBSCRIBE / NOTIFY ================= */
type Listener = () => void;
const listeners = new Set<Listener>();

// Screens subscribe once (in an effect); returns the unsubscribe closure.
export function stateSubscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function notifyState(): void {
  listeners.forEach((fn) => { try { fn(); } catch (err) { console.warn("state subscriber threw (kept alive):", err); } });
}

/* ================= CORE APP STATE (prototype State object, 1:1 shape) ================= */
export type ScreenId =
  | "dash" | "pos" | "watch" | "perf" | "orders"
  | "scan" | "alerts" | "news" | "compare" | "journal";

export interface Position { qty: number; avgCost: number }

// ORDERS.log record — a structured fill for the ORDERS screen (wire-format ledger).
export interface Fill {
  time: string;
  sym: string;               // display form (‑USD stripped), as the prototype logged it
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  est: number;               // magnitude of the notional; side carries direction
  bpAfter: number;           // buying power AFTER this fill
  line: string;              // human string reused by the marquee/flash
}

export interface AlertBits { order: boolean; watch: boolean }

export const State = {
  // ROUTING NOTE: the prototype navigated by mutating State.screen; the app
  // routes with HashRouter (/:screenId). Terminal.tsx mirrors the route param
  // into this field on every navigation so per-screen keyboard gating and the
  // selectInstrument dispatch below keep their exact prototype semantics.
  screen: "dash" as ScreenId,
  selected: "NVDA",              // selected instrument (roster)
  range: "1D" as Range,
  cash: 24500.00,                // buying power (real free cash once T212 is live)
  equity: 0,                     // computed
  accountCcy: "USD",             // account currency (from T212 when live; £/€/$ display)
  // T212's own reported account figures when live (most accurate headline) —
  // null in the mock world, so the masthead falls back to computeEquity().
  liveAccount: null as { totalMinor: number; freeMinor: number; pplMinor: number; ccy: string | null } | null,
  positions: {                   // sym -> {qty, avgCost} — the seeded starter book (seed-77 world)
    "NVDA": { qty: 120, avgCost: 98.20 },
    "AAPL": { qty: 60, avgCost: 189.40 },
    "SPY": { qty: 40, avgCost: 512.10 },
    "TSLA": { qty: 0, avgCost: 0 },
  } as Record<string, Position>,
  staged: 0,                     // pending qty delta on positions screen
  strategy: "DIRECTIONAL" as "DIRECTIONAL" | "HEDGED",
  ordersLog: [] as Fill[],
  alerts: {} as Record<string, AlertBits>, // sym -> {order,watch} — two independent star sources
                                 // (wave-1 order-needs-attention + wave-2 triggered watch); the roster ORs them,
                                 // each feature clears only its OWN bit so they never clobber each other
  tutorialShown: false,
  vol: 30, muted: false,
};

// --- roster-star flag bits: two independent sources OR'd for the orange .flag star. Splitting
// them stops wave-1 (order-needs-attention) and wave-2 (triggered watch) from clobbering each
// other — pressing R on ALERTS clears only the watch bit; acknowledging an order clears only order.
export function alertBits(sym: string): AlertBits {
  let b = State.alerts[sym];
  if (!b || typeof b !== "object") { b = { order: false, watch: false }; State.alerts[sym] = b; }
  return b;
}
export function alertFlagged(sym: string): boolean {
  const b = State.alerts[sym]; return !!(b && typeof b === "object" && (b.order || b.watch));
}
export function setAlertOrder(sym: string, on: boolean): void { alertBits(sym).order = !!on; }
export function setAlertWatch(sym: string, on: boolean): void { alertBits(sym).watch = !!on; }

/* ================= BOOK MATH (equity / P&L / staging) ================= */
export function positionFor(sym: string): Position {
  return State.positions[sym] || (State.positions[sym] = { qty: 0, avgCost: 0 });
}
export function computeEquity(): { mv: number; total: number } {
  let mv = 0;
  for (const sym in State.positions) { const pos = State.positions[sym]; if (pos.qty > 0) { mv += pos.qty * DataEngine.get(sym).last; } }
  State.equity = State.cash + mv;
  return { mv, total: State.equity };
}
export function dayPnl(): number {
  let pnl = 0;
  for (const sym in State.positions) { const pos = State.positions[sym]; if (pos.qty > 0) { const q = DataEngine.get(sym); pnl += pos.qty * (q.last - q.prevClose); } }
  return pnl;
}

export function clampStaged(): void {
  const sym = State.selected; const pos = positionFor(sym); const q = DataEngine.get(sym);
  // can't sell more than held; can't buy more than affordable
  const maxBuy = Math.floor(State.cash / q.last);
  State.staged = clamp(State.staged, -pos.qty, maxBuy);
}
export function stageDelta(d: number): void { State.staged += d; clampStaged(); notifyState(); }
export function resetStage(): void { State.staged = 0; notifyState(); }
export function toggleStrategy(): void { State.strategy = State.strategy === "DIRECTIONAL" ? "HEDGED" : "DIRECTIONAL"; notifyState(); }

/* confirmStage — the prototype's fill commit, minus the DOM (renders + marquee).
   Returns the Fill so the shell can push it onto the alerts marquee, or null if
   nothing was affordable/staged. Also raises the ORDER star bit. */
export function confirmStage(): Fill | null {
  if (State.staged === 0) return null;
  const sym = State.selected; const pos = positionFor(sym); const q = DataEngine.get(sym);
  // re-validate against CURRENT cash/price: the staged size was clamped when it was
  // set, but the price ticks every 1–2s, so a max-size buy confirmed after an upward
  // tick would overspend and land buying power negative (dishonest in a house-rule
  // terminal). Reclamp, and if a buy still exceeds cash, shrink it to what's affordable.
  clampStaged();
  if (State.staged > 0 && State.staged * q.last > State.cash) {
    State.staged = Math.floor(State.cash / q.last);
    if (State.staged === 0) { notifyState(); return null; } // nothing affordable at the new price — abort
  }
  const qty = State.staged; const last = q.last; const cost = qty * last;
  if (qty > 0) {
    const newQ = pos.qty + qty;
    pos.avgCost = pos.qty > 0 ? ((pos.avgCost * pos.qty) + (last * qty)) / newQ : last;
    pos.qty = newQ; State.cash -= cost;
  } else {
    pos.qty += qty; State.cash += Math.abs(cost); if (pos.qty === 0) pos.avgCost = 0;
  }
  const stamp = new Date().toTimeString().slice(0, 8);
  const line = `${stamp} ${qty > 0 ? "BUY" : "SELL"} ${Math.abs(qty)} ${sym.replace("-USD", "")} @ ${fmtUSD(last, last < 10 ? 4 : 2)}`;
  const fill: Fill = {
    time: stamp,
    sym: sym.replace("-USD", ""),
    side: qty > 0 ? "BUY" : "SELL",
    qty: Math.abs(qty),
    price: last,
    est: Math.abs(cost),           // magnitude; side carries direction
    bpAfter: State.cash,           // buying power AFTER this fill
    line,                          // human string reused by the marquee/flash
  };
  State.ordersLog.push(fill);
  setAlertOrder(sym, true); // open order needing attention -> orange star on the card (ORDER bit only)
  State.staged = 0;
  notifyState();
  return fill;
}

/* ================= SHARED SELECT ================= */
// The prototype's selectInstrument called per-screen render fns directly; here the
// dispatch mutates the same per-screen state and notifyState() triggers the repaint.
export function selectInstrument(sym: string): void {
  if (sym === State.selected) { notifyState(); return; } // screens re-pulse the selected card themselves
  setAlertOrder(sym, false); // acknowledging the card clears its ORDER star bit (a triggered-watch bit survives)
  State.selected = sym; State.staged = 0;
  if (State.screen === "perf") {
    // roster jump on the analysis deck retargets the chart when SOURCE=ROSTER.
    // PORTFOLIO / typed-symbol sources are pinned and ignore roster selection.
    if (Perf.source === "ROSTER") { Perf.symbol = sym; perfLoadSeries(); }
  } else if (State.screen === "alerts") { Alerts.ticket.sym = State.selected; } // prefill the new-watch ticket symbol
  else if (State.screen === "news") { News.focusId = null; } // retarget the focused wire row + dossier to the selected symbol
  else if (State.screen === "compare") { Compare.picker.fill(State.selected); } // roster click fills the ACTIVE slot (mirrors Performance ROSTER source)
  notifyState();
}
export function moveRoster(dir: number): void {
  const i = DEFAULT_ROSTER.indexOf(State.selected);
  const ni = (i + dir + DEFAULT_ROSTER.length) % DEFAULT_ROSTER.length;
  selectInstrument(DEFAULT_ROSTER[ni]);
}

/* ================= SLOT PICKER (shared Compare/Alerts abstraction) =================
   makeSlotPicker(nSlots) -> { slots[], active, set(i,sym), fill(sym), cycle(), reset() }.
   Compare uses 2–3 symbol slots; Alerts uses it as a single-slot ticket prefill. */
export interface SlotPicker {
  n: number; slots: (string | null)[]; active: number;
  set(i: number, sym: string): void;
  fill(sym: string): number;
  cycle(): number;
  reset(): void;
}
export function makeSlotPicker(nSlots: number): SlotPicker {
  return {
    n: nSlots, slots: new Array<string | null>(nSlots).fill(null), active: 0,
    set(i, sym) { if (i >= 0 && i < this.n) { this.slots[i] = sym; this.active = i; } },
    fill(sym) { this.slots[this.active] = sym; return this.active; },   // fill ACTIVE slot
    cycle() { this.active = (this.active + 1) % this.n; return this.active; },
    reset() { this.slots = new Array<string | null>(this.n).fill(null); this.active = 0; },
  };
}

/* ================= SCANNER STATE ================= */
export interface ScanRow { sym: string; q: Quote; r: ScanResult; rsi: number | null; dayPct: number; last: number }

export const Scan = {
  preset: "ALL" as ScanPresetKey,     // boot default = ALL (always populated, ranked); strict screeners (VCP/BURST/DIVPULL) can legitimately return 0 on this static seed
                                      // (VCP/DIVPULL are mathematically unreachable at 160 closed bars — dead heroes)
  sortKey: "SCORE" as "SCORE" | "1D%" | "RSI",
  cached: false,                      // 'SCAN: CACHED' badge (fundamentals-fetch failover echo)
  cache: {} as Record<string, ScanRow[]>, // key: `${preset}|${dataV}` -> rows
  dataV: 0,
};
export function scanBumpData(): void { Scan.dataV++; Scan.cache = {}; }

// Non-repainting: closed-bar metrics + memo per (preset, dataV). Row order only
// re-sorts on candle finalize; between candles last/1D% live-flash in place.
export function scanComputeRows(): ScanRow[] {
  const key = `${Scan.preset}|${Scan.dataV}`;
  if (Scan.cache[key]) return Scan.cache[key];
  const rows = DEFAULT_ROSTER.map((sym) => {
    const q = DataEngine.get(sym);
    const r = SCAN_CALC.run(Scan.preset, sym);
    // RSI on CLOSED bars for the rail cell (honest, non-repainting)
    const cl = q.hist["1M"].slice(0, Math.max(0, q.hist["1M"].length - 1));
    const rsiArr = INDICATOR_CALC.rsi(cl, THRESHOLDS.RSI_PERIOD);
    const rsi = rsiArr[rsiArr.length - 1];
    return { sym, q, r, rsi: isFinite(rsi) ? rsi : null, dayPct: q.dayPct, last: q.last };
  });
  Scan.cache[key] = rows; return rows;
}
export function scanSortRows(rows: ScanRow[]): ScanRow[] {
  const k = Scan.sortKey;
  const val = (x: ScanRow) => k === "1D%" ? x.dayPct : k === "RSI" ? (x.rsi == null ? -1 : x.rsi) : (isFinite(x.r.score) ? x.r.score : -1);
  // matched first, then chosen key desc; N/A & unmatched sink (honest: still shown, dimmed)
  return rows.slice().sort((a, b) => (Number(b.r.matched) - Number(a.r.matched)) || (val(b) - val(a)));
}

/* ================= ALERTS STATE ================= */
export const Alerts = {
  watches: [] as Watch[],      // {id,sym,metric,op,level,state,firedAt,now}
  regime: null as RegimeReport | null, // cached — recomputed on closed-bar roll only
  regimeClosedN: null as number | null, // last settled-bar count the regime was computed at
  ticket: { sym: "NVDA", metric: "PRICE" as WatchMetric, op: ">" as WatchOp, level: 0 },
  seq: 1,
};

// a seeded, screenshot-stable starter book (seed=77 world) so the board is populated.
export function alertsSeedBook(): void {
  if (Alerts.watches.length) return;
  const mk = (sym: string, metric: WatchMetric, op: WatchOp, level: number): Watch =>
    ({ id: Alerts.seq++, sym, metric, op, level, state: "ARMED", firedAt: null, now: null });
  Alerts.watches = [
    mk("NVDA", "PRICE", ">", 130.00),
    mk("TSLA", "RSI", "<", 30),
    mk("SPY", "DAY%", "<", -2.00),
    mk("AAPL", "PRICE", ">", 230.00),
    mk("BTC-USD", "PRICE", "<", 90000),
  ];
}

// tick-time evaluation with the roster-star side effect injected (engine stays pure)
export function evaluateWatchesNow(): boolean {
  return evaluateWatches(Alerts.watches, setAlertWatch);
}

// NON-REPAINTING regime recompute — only when the settled daily bar has rolled.
export function alertsComputeRegime(force?: boolean): RegimeReport {
  const spyClosedN = Math.max(0, DataEngine.get("SPY").hist["1M"].length - 1);
  if (!force && Alerts.regime && Alerts.regimeClosedN === spyClosedN) return Alerts.regime;
  Alerts.regime = computeRegime();
  Alerts.regimeClosedN = spyClosedN;
  return Alerts.regime;
}

/* ---- ticket ops (pure state mutations; the screen owns input focus/DOM) ---- */
export function alertTicketDisplayLevel(): string {
  const t = Alerts.ticket;
  if (t.metric === "RSI") return String(t.level | 0);
  if (t.metric === "PRICE") return t.level.toFixed(t.level < 10 ? 4 : 2);
  return t.level.toFixed(2);
}
export function alertTicketStep(dir: number): void {
  const t = Alerts.ticket;
  const step = t.metric === "RSI" ? 1 : t.metric === "DAY%" ? 0.25 : (t.level < 10 ? 0.5 : 1);
  t.level = t.metric === "RSI" ? clamp((t.level | 0) + dir, 0, 100) : +(t.level + dir * step).toFixed(4);
  notifyState();
}
export function alertSetTicketLevel(raw: number): void {
  if (!isFinite(raw)) return;
  Alerts.ticket.level = Alerts.ticket.metric === "RSI" ? clamp(raw | 0, 0, 100) : raw;
}
export function alertArmTicket(): void {
  const t = Alerts.ticket;
  const w: Watch = { id: Alerts.seq++, sym: t.sym, metric: t.metric, op: t.op, level: t.level, state: "ARMED", firedAt: null, now: null };
  Alerts.watches.unshift(w);
  notifyState();
}
// reset the focused/most-recent TRIGGERED watch back to ARMED (re-arm), clearing its flag.
export function alertResetWatch(): void {
  // most-recent triggered first; else the newest watch
  const w = Alerts.watches.find((x) => x.state === "TRIGGERED") || Alerts.watches[0];
  if (!w) return;
  w.state = "ARMED"; w.firedAt = null;
  // clear only the WATCH bit, and only if no other triggered watch holds this symbol. A wave-1
  // ORDER bit on the same symbol is untouched (that star survives re-arming a watch).
  if (!Alerts.watches.some((x) => x.sym === w.sym && x.state === "TRIGGERED")) setAlertWatch(w.sym, false);
  notifyState();
}
export function alertCycleMetric(): void {
  const i = ALERT_METRICS.indexOf(Alerts.ticket.metric);
  Alerts.ticket.metric = ALERT_METRICS[(i + 1) % ALERT_METRICS.length];
  notifyState();
}
export function alertToggleOp(): void { Alerts.ticket.op = Alerts.ticket.op === ">" ? "<" : ">"; notifyState(); }

/* ================= COMPARE STATE ================= */
export const Compare = {
  range: "1M" as Range,
  picker: makeSlotPicker(3),
  metricCache: {} as Record<string, CmpMetrics>, // `${sym}|${range}` -> settled verdict; recomputed on slot/range change only
};
// 2 slots pre-filled for showcase (the approved boot state)
Compare.picker.slots[0] = "NVDA";
Compare.picker.slots[1] = "AAPL";
Compare.picker.slots[2] = null;
Compare.picker.active = 2;

export function cmpFilledSlots(): { sym: string; i: number }[] {
  return Compare.picker.slots
    .map((s, i) => ({ sym: s, i }))
    .filter((o): o is { sym: string; i: number } => !!o.sym);
}
export function cmpGetMetrics(sym: string): CmpMetrics {
  const k = `${sym}|${Compare.range}`;
  if (!Compare.metricCache[k]) Compare.metricCache[k] = COMPARE_CALC.metrics(sym); // settled verdict, cached
  return Compare.metricCache[k];
}
export function cmpBumpMetrics(): void { Compare.metricCache = {}; } // on candle finalize only (non-repainting)

/* ================= NEWS STATE ================= */
export const News = { lane: "EARNINGS" as NewsLaneKey, focusId: null as string | null };

// wire the engine's held-qty seam to the real book (the prototype read
// positionFor(sym).qty directly; the pure engine takes it injected).
NewsEngine.heldQtyOf = (sym: string) => positionFor(sym).qty;

/* ================= JOURNAL STATE ================= */
// One place for the single tunable guess (THRESHOLDS discipline): the review interval.
export const JOURNAL_CONST = { REVIEW_INTERVAL_DAYS: 30 }; // trader-memory-core monitoring.review_interval_days default:30
export const JN_TAGS = ["WIN", "MISTAKE", "LESSON", "WATCHING"];          // toggle chips (TEAL when on — never green/red)
export const JN_LIFECYCLE = ["IDEA", "ENTRY READY", "ACTIVE", "CLOSED"];  // forward-only pill (trader-memory-core status enum, condensed)

// Session-local card store, keyed by ordersLog index. `sample:true` cards are demonstrative
// seeds that clear the instant a real fill lands. A card carries {note, tags:Set, lifeIdx}.
export interface JournalCard {
  sample: boolean; logIdx?: number;
  time: string; sym: string; side: "BUY" | "SELL"; qty: number; price: number; est: number;
  note: string; tags: Set<string>; lifeIdx: number;
}
export const JOURNAL = { cards: [] as JournalCard[], seeded: false };

export function journalSeed(): void {
  // Seed 2 demonstrative pages from the SAME seeded DataEngine the rest of the app shows,
  // so the diary reads full on a fresh session. Flagged SAMPLE; retired on first real fill.
  if (JOURNAL.seeded) return;
  const now = new Date();
  const stamp = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60000).toTimeString().slice(0, 8);
  const mk = (sym: string, side: "BUY" | "SELL", qty: number, minsAgo: number, tags: string[], life: number, note: string): JournalCard => {
    const q = DataEngine.get(sym); const price = q.last; const est = qty * price;
    return { sample: true, time: stamp(minsAgo), sym: sym.replace("-USD", ""), side, qty, price, est,
      note, tags: new Set(tags), lifeIdx: life };
  };
  JOURNAL.cards = [
    mk("NVDA", "BUY", 40, 42, ["WATCHING"], 2, "Added into strength on the AI-capex read; watching the 50-DMA hold before I press."),
    mk("SPY", "SELL", 20, 18, ["LESSON"], 3, "Trimmed the index hedge a touch early — note to self: let the plan run, not the nerves."),
  ]; // newest-first is handled at render; store chronological
  JOURNAL.seeded = true;
}
export function journalRealCards(): JournalCard[] {
  // Build the live card list from State.ordersLog (each confirmed fill), preserving any
  // note/tag the operator already typed for that index. Never drops user edits.
  return State.ordersLog.map((o, i) => {
    const prev = JOURNAL.cards.find((c) => !c.sample && c.logIdx === i);
    return prev || { sample: false, logIdx: i, time: o.time, sym: o.sym, side: o.side, qty: o.qty,
      price: o.price, est: o.est, note: "", tags: new Set<string>(), lifeIdx: (o.side === "BUY" ? 2 : 3) };
  });
}
export function journalActiveCards(): JournalCard[] {
  // Real fills win the moment any exist; otherwise show the SAMPLE seeds.
  if (State.ordersLog.length) { JOURNAL.cards = journalRealCards(); return JOURNAL.cards; }
  journalSeed(); return JOURNAL.cards;
}
export function journalReviewDate(timeStr: string): string {
  // Card timestamp ("HH:MM[:SS]", today's session) + REVIEW_INTERVAL_DAYS (purely informational,
  // never a blocker). Anchor to the card's own time so a fill just before midnight reviews on the
  // correct calendar day, then add the interval and format short.
  const d = new Date();
  const m = /^(\d{1,2}):(\d{2})/.exec(timeStr || "");
  if (m) { d.setHours(+m[1], +m[2], 0, 0); }
  d.setDate(d.getDate() + JOURNAL_CONST.REVIEW_INTERVAL_DAYS);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

/* ================= PERFORMANCE (ANALYSIS DECK) STATE ================= */
export type PerfSource = "PORTFOLIO" | "ROSTER" | "TYPED";
export interface PerfToggleItem { id: string; label: string; on: boolean; color: string }
export interface PerfToggleGroup { group: string; items: PerfToggleItem[] }

export const Perf = {
  source: "PORTFOLIO" as PerfSource,
  symbol: "PORTFOLIO",  // display key (ROSTER/TYPED carry the ticker)
  typed: "",            // last typed symbol
  range: "1D" as Range,
  bars: [] as Bar[],    // [{o,h,l,c,v}] current series
  closedN: 0,           // count of CLOSED candles (the last may be live-forming)
  tag: "" as "" | "SIMULATED" | "MOCK" | "LIVE",
  cache: {} as PerfCalc | Record<string, never>, // memoised calc keyed by toggle set + data version
  dataV: 0,             // bumped every tick/reload so overlays recompute
  cross: null as number | null, // crosshair bar index (overlay only)
  railHidden: false,
  live: false,          // whether the last candle is live-forming (extends on tick)
  liveFeed: false,      // true = crypto real-live tick; false = mock walk. Governs tick SOURCE only.
  symLabel: "PORTFOLIO",           // head-chrome data (the prototype set #perfSym/#perfNm directly)
  nmLabel: "Book equity curve",
};

// toggle definitions — grouped OVERLAYS / PANES / SIGNALS. `on` is default state.
export const PERF_TOGGLES: PerfToggleGroup[] = [
  { group: "OVERLAYS", items: [
    { id: "ribbon", label: "EMA RIBBON",  on: true,  color: "#D9942B" },
    { id: "bb",     label: "BOLLINGER×2", on: false, color: "#5D8B80" },
    { id: "super",  label: "SUPERTREND",  on: false, color: "#4CAF6E" },
    { id: "vwap",   label: "VWAP",        on: false, color: "#7FBBAD" },
    { id: "vol",    label: "VOLUME",      on: true,  color: "#4C463A" },
  ] },
  { group: "PANES", items: [
    { id: "rsi",   label: "RSI",       on: true,  color: "#D9942B" },
    { id: "stoch", label: "STOCH RSI", on: false, color: "#7FBBAD" },
    { id: "macd",  label: "MACD",      on: false, color: "#5D8B80" },
    { id: "atr",   label: "ATR",       on: false, color: "#B23A2F" },
  ] },
  { group: "SIGNALS", items: [
    { id: "adaptive", label: "ADAPTIVE CANDLES", on: false, color: "#D9942B" },
    { id: "signals",  label: "BUY/SELL PLOTS",   on: false, color: "#4CAF6E" },
    { id: "squeeze",  label: "EMA SQUEEZE",      on: false, color: "#D9942B" },
    { id: "zones",    label: "WATCH ZONES",      on: false, color: "#5D8B80" },
    { id: "div",      label: "DIVERGENCE",       on: false, color: "#B23A2F" },
  ] },
];
export const perfOn: Record<string, boolean> = {};
PERF_TOGGLES.forEach((g) => g.items.forEach((it) => { perfOn[it.id] = it.on; }));
// number-key quick-toggle order (first nine, flat)
export const PERF_FLAT: string[] = PERF_TOGGLES.flatMap((g) => g.items.map((it) => it.id));

// portfolio equity curve with the live book injected (the pure engine takes the
// Book as an argument; the prototype read State.positions/State.cash globally)
export function currentBook(): Book { return { cash: State.cash, positions: State.positions }; }
export function portfolioCloses(points: number, range: Range): number[] {
  return genPortfolioCloses(points, range, currentBook());
}

/* ---- PERF: series load (source/range change) — data half only; the screen
   paints the head chrome from Perf.symLabel/nmLabel/tag after this returns. ---- */
export function perfLoadSeries(): void {
  const range = Perf.range; const N = HIST_POINTS[range];
  let closes: number[], seed: number, volBase: number, tag: "SIMULATED" | "MOCK" | "LIVE";
  let live = false, symLabel: string, nmLabel: string;
  if (Perf.source === "PORTFOLIO") {
    closes = portfolioCloses(N, range); seed = (DataEngine.seed ^ 0x9E37) >>> 0; volBase = 1;
    tag = "SIMULATED"; symLabel = "PORTFOLIO"; nmLabel = "Book equity curve";
  } else {
    const sym = Perf.symbol; const known = UNIVERSE[sym];
    if (known) {
      // a real roster instrument — reuse the engine's history for the range
      const sd = (DataEngine.seed ^ seedFromString(sym)) ^ (range.charCodeAt(0) * 131);
      closes = (range === "1D" ? DataEngine.get(sym).hist["1D"].slice() : genHistory(sym, N, sd, range));
      seed = sd; volBase = Math.max(1, known.avgvol / 1e6);
      live = known.live && DataEngine.live && range === "1D"; // crypto stays live-capable on 1D
      tag = live ? "LIVE" : (known.live ? "LIVE" : "MOCK");
      symLabel = sym.replace("-USD", ""); nmLabel = known.name;
    } else {
      closes = genSyntheticCloses(sym, N, range); seed = seedFromString("SYN|" + sym); volBase = 8;
      tag = "MOCK"; symLabel = sym; nmLabel = "Unlisted / synthetic history";
    }
  }
  Perf.bars = ohlcFromCloses(closes, seed, volBase);
  Perf.liveFeed = live; // true = crypto real-live tick; false = mock walk. Governs tick SOURCE only.
  Perf.live = true;     // the LAST candle is ALWAYS live-forming (perfTick extends it every source)
  // NON-REPAINTING LAW: closedN excludes the live-forming last bar for EVERY source, so no
  // signal/divergence/marker is ever computed on a bar that can still move. Signals are frozen
  // to [0 .. closedN-1] architecturally, not by convention.
  Perf.closedN = Math.max(0, Perf.bars.length - 1);
  Perf.tag = tag;
  Perf.symLabel = symLabel; Perf.nmLabel = nmLabel;
  Perf.cache = {}; Perf.dataV++;
  notifyState();
}

/* ---- PERF: memoised calc (recomputed only when dataV or toggles change) ---- */
export interface PerfCalc {
  _key: string;
  o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
  n: number; cN: number;
  emaSet: number[][];
  bb?: BollingerBands;
  super?: SuperTrendResult;
  vwap?: number[];
  rsi?: number[];
  stoch?: StochRsiResult;
  macd?: MacdResult;
  atr?: number[];
  adaptive?: number[];
  cycle?: RsiCycleResult;
  squeeze?: EmaCompressionResult;
  divRsi?: DivergenceMark[];
  divMacd?: DivergenceMark[];
}
export function perfCalc(): PerfCalc {
  const key = Perf.dataV + "|" + PERF_FLAT.filter((id) => perfOn[id]).join(",");
  const cached = Perf.cache as PerfCalc;
  if (cached._key === key) return cached;
  const bars = Perf.bars, n = bars.length, cN = Perf.closedN;
  const o = bars.map((b) => b.o), h = bars.map((b) => b.h), l = bars.map((b) => b.l), c = bars.map((b) => b.c), v = bars.map((b) => b.v);
  const out: PerfCalc = {
    _key: key, o, h, l, c, v, n, cN,
    // overlays — the ribbon is always computed (adaptive/squeeze/colouring feed off it)
    emaSet: THRESHOLDS.EMA_PERIODS.map((p) => INDICATOR_CALC.ema(c, p)),
  };
  if (perfOn.bb)    out.bb    = INDICATOR_CALC.bollinger(c, THRESHOLDS.BB_PERIOD, THRESHOLDS.BB_SIGMA_INNER, THRESHOLDS.BB_SIGMA_OUTER);
  if (perfOn.super) out.super = INDICATOR_CALC.superTrend(h, l, c, THRESHOLDS.SUPERTREND_ATR, THRESHOLDS.SUPERTREND_MULT);
  if (perfOn.vwap)  out.vwap  = INDICATOR_CALC.vwap(h, l, c, v);
  // panes
  if (perfOn.rsi || perfOn.signals || perfOn.zones || perfOn.div) out.rsi = INDICATOR_CALC.rsi(c, THRESHOLDS.RSI_PERIOD);
  if (perfOn.stoch) out.stoch = INDICATOR_CALC.stochRsi(c, THRESHOLDS.RSI_PERIOD, THRESHOLDS.STOCHRSI_PERIOD, THRESHOLDS.STOCHRSI_K, THRESHOLDS.STOCHRSI_D);
  if (perfOn.macd || perfOn.div) out.macd = INDICATOR_CALC.macd(c, THRESHOLDS.MACD_FAST, THRESHOLDS.MACD_SLOW, THRESHOLDS.MACD_SIGNAL);
  if (perfOn.atr)   out.atr   = INDICATOR_CALC.atr(h, l, c, THRESHOLDS.ATR_PERIOD);
  // signals — CLOSED candles only; arrays frozen at cN (non-repainting law)
  if (perfOn.adaptive) out.adaptive = SIGNAL_CALC.adaptiveColors(c, out.emaSet, n); // colouring may cover live bar (cosmetic, not a signal)
  if (perfOn.signals) { out.cycle = SIGNAL_CALC.rsiCycle(c, cN); }
  if (perfOn.squeeze) { out.squeeze = SIGNAL_CALC.emaCompression(out.emaSet, cN); }
  if (perfOn.div) {
    out.divRsi = out.rsi ? SIGNAL_CALC.divergence(c, out.rsi, cN) : [];
    out.divMacd = out.macd ? SIGNAL_CALC.divergence(c, out.macd.macd, cN) : [];
  }
  Perf.cache = out; return out;
}
