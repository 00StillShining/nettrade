/* =========================================================================
   TERMINAL 77 — NEWS ENGINE (ported verbatim from prototypes/terminal-77)

   The HOLDINGS WIRE. THREE lanes, all derived from the EXISTING
   DataEngine/UNIVERSE so nothing is fabricated and every number reconciles
   with the roster/chart already on screen:
     (1) EARNINGS — per roster symbol, exact earnings-calendar JSON shape.
         Ports earnings-calendar/fetch_earnings_fmp.py: MIN_MARKET_CAP $2B
         hard gate (all roster names pass truthfully), timing BMO/AMC/TAS,
         sort key (date ASC, timing_order{BMO:1,AMC:2,TAS:3}, marketCap DESC).
         EPS/REV EST derived from mcap/pe so EPS ties back to price.
     (2) MACRO — a fixed diegetic set (FOMC / CPI / NFP / GDP / PPI) in the
         economic-calendar field schema (country US, USD, previous/estimate,
         impact High/Medium), spread over the next 7 days.
     (3) HEADLINES — scored with the market-news-analyst formula over LIVE
         numbers: dayPct -> price-impact band -> Price Score; breadth
         multiplier from UNIVERSE.tags; forward modifier from sign vs drift;
         Impact = Price*Breadth + Forward. Consequence authored in the
         tired-desk-analyst voice, consistent with sign + dayPct.

   HONEST-DATA / CORS: FMP (earnings + macro) and Yahoo/RSS (headlines) send
   NO permissive CORS header and leak an apikey — unlike Coinbase. A static
   browser build CANNOT fetch them. So NEWS ships MOCK-FIRST behind a single
   marked live seam in NewsEngine.tryLive(); the real fetch belongs in the
   Tauri/Rust app port (reqwest, server-side, no CORS). tryLive() falls
   through to the MockWireProvider and the taskbar reads OFFLINE // CACHED —
   no console CORS spam.

   NON-REPAINTING IS LAW (honouring the CLOSED-candle discipline): EARNINGS
   and MACRO are SCHEDULED events — computed once per refresh, immutable
   until the next explicit R / day rollover (a scheduled release must never
   flicker on the 1-2s price tick). HEADLINE scores MAY recompute on tick
   (dayPct is live) but the row ORDER is FROZEN between refreshes and only
   the changed digits flash — the feed is never re-sorted under the reader.
   ========================================================================= */

import { mulberry32, seedFromString } from "./prng";
import {
  DataEngine, UNIVERSE, DEFAULT_ROSTER, DEFAULT_SEED, isMarketOpen, arrow, glClass,
} from "./dataEngine";

export type NewsLaneKey = "EARNINGS" | "MACRO" | "HEADLINES";
export interface NewsLane { key: NewsLaneKey; label: string }
export const NEWS_LANES: NewsLane[] = [
  { key: "EARNINGS",  label: "EARNINGS.q3" },
  { key: "MACRO",     label: "MACRO.rel" },
  { key: "HEADLINES", label: "HEADLINES.desk" },
];

// economic-calendar impact map (SKILL.md): High=FOMC/NFP/CPI/GDP, Medium=Retail/PMI.
// Authored diegetic set — internally consistent, spread over the next 7 sessions.
export interface MacroDef {
  event: string; currency: string; country: string; impact: "High" | "Medium";
  prev: string; est: string; dayOffset: number; timeTxt: string; line: string;
}
export const NEWS_MACRO_DEFS: MacroDef[] = [
  { event: "FOMC RATE DECISION", currency: "USD", country: "US", impact: "High",   prev: "4.50%", est: "4.50%", dayOffset: 2, timeTxt: "14:00 EST",
    line: "Hold widely priced; the dots and the presser move more than the number. A hawkish hold pressures <b>growth/tech</b> and lifts the dollar." },
  { event: "CPI YoY",            currency: "USD", country: "US", impact: "High",   prev: "3.0%",  est: "2.9%",  dayOffset: 1, timeTxt: "08:30 EST",
    line: "A hot print revives the higher-for-longer trade — <b>rate-sensitive megacaps</b> wear it first, gold and duration catch a bid." },
  { event: "NON-FARM PAYROLLS",  currency: "USD", country: "US", impact: "High",   prev: "206K",  est: "190K",  dayOffset: 4, timeTxt: "08:30 EST",
    line: "Too strong and cuts get pushed out; too weak and the soft-landing story cracks. Either tail hits <b>high-beta</b> hardest." },
  { event: "GDP QoQ (ADV)",      currency: "USD", country: "US", impact: "Medium", prev: "2.8%",  est: "2.6%",  dayOffset: 5, timeTxt: "08:30 EST",
    line: "Backward-looking, but a big miss reprices the cycle. Broad-index read; single names shrug unless it moves the Fed." },
  { event: "PPI MoM",            currency: "USD", country: "US", impact: "Medium", prev: "0.2%",  est: "0.2%",  dayOffset: 3, timeTxt: "08:30 EST",
    line: "The CPI appetiser — pipeline inflation. In-line is a non-event; a spike front-runs the CPI reaction by a day." },
];
export const NEWS_DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export type EarningsTiming = "BMO" | "AMC" | "TAS";
export const NEWS_TIMING_ORDER: Record<EarningsTiming, number> = { BMO: 1, AMC: 2, TAS: 3 };

export interface EarningsRow {
  id: string; lane: "EARNINGS"; sym: string; companyName: string; sector: string;
  style: string; tags: string[]; date: Date; timing: EarningsTiming; marketCap: number;
  epsEstimated: number | null; revenueEstimated: number; heldQty: number;
  daysOut: number; imminent: boolean;
}
export interface MacroRow {
  id: string; lane: "MACRO"; event: string; currency: string; country: string;
  impact: "High" | "Medium"; prev: string; est: string; timeTxt: string; line: string;
  date: Date; daysOut: number; imminent: boolean;
}
export interface HeadlineRow {
  id: string; lane: "HEADLINES"; sym: string; companyName: string; sector: string;
  style: string; tags: string[]; bio: string; priors: string; dayPct: number;
  last: number; impact: number; priceLabel: string; breadthLabel: string;
  breadthMult: number; fwdLabel: string; imminent: boolean; line: string;
}
export type NewsRow = EarningsRow | MacroRow | HeadlineRow;

export const NewsEngine = {
  live: true,               // overall feed banner state; mock draws when false
  cached: false,            // 'FEED: CACHED' badge (mirrors Scan.cached failover echo)
  dataV: 0,                 // bumped on refresh (R) / day rollover — freezes scheduled rows between bumps
  _now: null as Date | null, // frozen "now" per refresh so scheduled dates don't drift mid-session
  cache: {} as Record<string, NewsRow[]>, // laneKey|dataV -> rows

  // PORT NOTE — pure-engine boundary: the prototype read positionFor(sym).qty (a
  // page-global State read) for the EARNINGS "held" column. state.ts installs the
  // real book accessor at boot; the default (no holdings) keeps the engine
  // standalone-testable.
  heldQtyOf: ((_sym: string) => 0) as (sym: string) => number,

  bump(): void { this.dataV++; this.cache = {}; this._now = new Date(); },

  // [LIVE SEAM: Tauri-Rust only] app port fetches FMP earnings-calendar +
  // economics-calendar + Yahoo per-ticker RSS HERE (Tauri/Rust reqwest, server-side
  // => no CORS, apikey stays out of the webview). A static BROWSER build has no
  // permissive-CORS path to any of these (unlike Coinbase spot), so tryLive() ALWAYS
  // falls through to MockWireProvider — no fetch, no console CORS spam, no leaked key.
  tryLive(): Promise<boolean> {
    // On a static file this resolves to mock immediately; the app port swaps in a real
    // Promise.all(reqwest...) at this one marker, folding live rows over the mock skeleton.
    this.live = false; this.cached = true;   // honest: the browser build is always CACHED
    this.bump();
    return Promise.resolve(false);
  },

  // ---- EARNINGS lane (per roster symbol; exact earnings-calendar shape) ----
  earnings(): EarningsRow[] {
    const key = "EARNINGS|" + this.dataV; if (this.cache[key]) return this.cache[key] as EarningsRow[];
    const now = this._now || new Date();
    const rows: EarningsRow[] = DEFAULT_ROSTER.map((sym) => {
      const p = UNIVERSE[sym]; const q = DataEngine.get(sym);
      const rng = mulberry32((DEFAULT_SEED ^ seedFromString("NEWS|EARN|" + sym)) >>> 0);
      // deterministic next business day, 1..10 sessions out
      const sessions = 1 + Math.floor(rng() * 10);
      const d = nextBusinessDay(now, sessions);
      const timing = (["BMO", "AMC", "TAS"] as EarningsTiming[])[Math.floor(rng() * 3)];
      // EPS EST derived from mcap/pe so it ties back to price (fallback for pe=NaN crypto)
      const eps = isFinite(p.pe) ? (q.last / p.pe) / 4 : null;            // quarterly EPS ≈ (price/PE)/4
      const rev = p.mcap * (isFinite(p.pe) ? (1 / p.pe) : 0.08) * (0.9 + rng() * 0.35); // rough quarterly revenue
      const held = this.heldQtyOf(sym);
      const daysOut = businessDaysBetween(now, d);
      return {
        id: "e-" + sym, lane: "EARNINGS" as const, sym, companyName: p.name, sector: p.sector, style: p.style, tags: p.tags,
        date: d, timing, marketCap: p.mcap, epsEstimated: eps, revenueEstimated: rev, heldQty: held,
        daysOut, imminent: daysOut <= 1 && (timing === "BMO" || timing === "AMC"),
      };
    });
    // sort key = (date ASC, timing_order, marketCap DESC) — the earnings-calendar port
    rows.sort((a, b) => (a.date.getTime() - b.date.getTime()) || (NEWS_TIMING_ORDER[a.timing] - NEWS_TIMING_ORDER[b.timing]) || (b.marketCap - a.marketCap));
    this.cache[key] = rows; return rows;
  },

  // ---- MACRO lane (fixed diegetic set, economic-calendar schema) ----
  macro(): MacroRow[] {
    const key = "MACRO|" + this.dataV; if (this.cache[key]) return this.cache[key] as MacroRow[];
    const now = this._now || new Date();
    const rows: MacroRow[] = NEWS_MACRO_DEFS.map((m) => {
      const d = nextBusinessDay(now, m.dayOffset);
      const daysOut = businessDaysBetween(now, d);
      return { id: "m-" + m.event, lane: "MACRO" as const, event: m.event, currency: m.currency, country: m.country,
        impact: m.impact, prev: m.prev, est: m.est, timeTxt: m.timeTxt, line: m.line, date: d, daysOut,
        imminent: daysOut <= 1 && m.impact === "High" };
    });
    rows.sort((a, b) => (a.date.getTime() - b.date.getTime()) || (macroImpactRank(b.impact) - macroImpactRank(a.impact)));
    this.cache[key] = rows; return rows;
  },

  // ---- HEADLINES lane (market-news-analyst scoring over LIVE numbers) ----
  // Order FROZEN per refresh (cached list of syms); scores recompute live on tick.
  headlines(): HeadlineRow[] {
    const key = "HEADLINES|" + this.dataV; if (this.cache[key]) return this.cache[key] as HeadlineRow[];
    // freeze the ROSTER ORDER at refresh time; a headline exists per name
    const rows = DEFAULT_ROSTER.map((sym) => this.scoreHeadline(sym));
    // rank once, then freeze (impact DESC); tick recomputes score-in-place, never re-sorts
    rows.sort((a, b) => b.impact - a.impact);
    this.cache[key] = rows; return rows;
  },

  // pure scorer — safe to call every tick for a live digit without touching order
  scoreHeadline(sym: string): HeadlineRow {
    const p = UNIVERSE[sym]; const q = DataEngine.get(sym);
    const dp = q.dayPct, ad = Math.abs(dp);
    // single-stock price bands (market-news-analyst): Severe>=10 / Major 5-10 / Moderate 2-5 / Minor / Negligible
    const priceScore = ad >= 10 ? 10 : ad >= 5 ? 7 : ad >= 2 ? 4 : ad >= 1 ? 2 : 1;
    const priceLabel = ad >= 10 ? "SEVERE" : ad >= 5 ? "MAJOR" : ad >= 2 ? "MODERATE" : ad >= 1 ? "MINOR" : "NEGLIGIBLE";
    // breadth multiplier from tags: INDEX/BROAD -> Systemic 3x, CRYPTO/AI -> Sector 1.5x, single name 1x
    const isIndex = p.tags.some((t) => /INDEX/.test(t)) || /INDEX/.test(p.sector);
    const isSector = p.tags.some((t) => /CRYPTO|AI/.test(t));
    const breadthMult = isIndex ? 3 : isSector ? 1.5 : 1;
    const breadthLabel = isIndex ? "SYSTEMIC" : isSector ? "SECTOR-WIDE" : "STOCK-SPECIFIC";
    // forward modifier: sign agrees with structural drift -> Trend Confirmation +25%, disagrees -> Contrary -25%
    const agrees = (dp >= 0) === (p.drift >= 0);
    const fwdMult = ad < 1 ? 1.0 : (agrees ? 1.25 : 0.75);
    const fwdLabel = ad < 1 ? "ISOLATED" : (agrees ? "TREND CONFIRMATION" : "CONTRARY MOVE");
    const impact = priceScore * breadthMult * fwdMult;
    return { id: "h-" + sym, lane: "HEADLINES" as const, sym, companyName: p.name, sector: p.sector, style: p.style, tags: p.tags,
      bio: p.bio, priors: p.priors, dayPct: dp, last: q.last, impact,
      priceLabel, breadthLabel, breadthMult, fwdLabel,
      imminent: impact >= 15,   // genuinely high-impact catalyst — the one orange marker
      line: headlineConsequence(sym, dp, breadthLabel, fwdLabel) };
  },
};

// business-day helpers (skip Sat/Sun) — scheduled catalysts land on trading days only
export function nextBusinessDay(from: Date, sessions: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let n = sessions;
  while (n > 0) { d.setDate(d.getDate() + 1); const g = d.getDay(); if (g !== 0 && g !== 6) n--; }
  return d;
}
export function businessDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let n = 0; const d = new Date(a);
  while (d < b) { d.setDate(d.getDate() + 1); const g = d.getDay(); if (g !== 0 && g !== 6) n++; }
  return n;
}
export function macroImpactRank(x: string): number { return x === "High" ? 3 : x === "Medium" ? 2 : 1; }

// relative-time readout, honest about market state (isMarketOpen)
export function newsWhen(row: NewsRow): string {
  if (row.lane === "HEADLINES") return "LIVE · ON THE TAPE";
  const d = row.daysOut;
  const dow = NEWS_DOW[row.date.getDay()];
  if (d <= 0) { const { open } = isMarketOpen(new Date()); return "TODAY " + dow + (open ? " · MKT OPEN" : " · PRE"); }
  if (d === 1) return "NEXT SESSION · " + dow;
  return "IN " + d + " SESSIONS · " + dow;
}

// tired-desk-analyst consequence, consistent with sign + dayPct (rate-HIKE playbook etc.)
// Returns an HTML string by design — the screen injects it into the wire line verbatim.
export function headlineConsequence(sym: string, dp: number, breadth: string, fwd: string): string {
  const up = dp >= 0, mag = Math.abs(dp).toFixed(2), disp = sym.replace("-USD", "");
  const numHtml = `<span class="w-num ${glClass(dp)}">${arrow(dp)} ${mag}%</span>`;
  if (Math.abs(dp) < 1) return `Desk quiet on ${disp} — ${numHtml} on the session, inside the noise. ${breadth.toLowerCase()} read; nobody's writing home.`;
  if (up) {
    if (breadth === "SYSTEMIC") return `Broad tape green, ${disp} ${numHtml} carrying the index — ${fwd.toLowerCase()}. Risk-on holds until it doesn't.`;
    if (breadth === "SECTOR-WIDE") return `${disp} ${numHtml} leading its group higher — ${fwd.toLowerCase()}. Momentum crowd already long; watch for the chase.`;
    return `${disp} bid ${numHtml} on the day — ${fwd.toLowerCase()}. Single-name move, no read-through to the book yet.`;
  } else {
    if (breadth === "SYSTEMIC") return `Index heavy, ${disp} ${numHtml} dragging breadth — ${fwd.toLowerCase()}. Duration and gold catch the safety bid.`;
    if (breadth === "SECTOR-WIDE") return `${disp} ${numHtml}, its whole group offered — ${fwd.toLowerCase()}. The AI/crypto beta unwinds together, as it always does.`;
    return `${disp} sold ${numHtml} — ${fwd.toLowerCase()}. Contained to the name; the desk isn't reaching for the panic button.`;
  }
}

// roster-relevant catalysts within the next 7 sessions (headlines are always "on the tape")
export function newsCountFor(laneKey: NewsLaneKey): number {
  if (laneKey === "HEADLINES") return DEFAULT_ROSTER.length;
  const rows: (EarningsRow | MacroRow)[] = laneKey === "EARNINGS" ? NewsEngine.earnings() : NewsEngine.macro();
  return rows.filter((r) => r.daysOut <= 7).length;
}
