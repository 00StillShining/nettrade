/* =========================================================================
   TERMINAL 77 — COMPARE_CALC (ported verbatim from prototypes/terminal-77)

   Side-by-side VALUE FINGERPRINT. Answers: of the 2-3 picked symbols, which
   is the better instrument RIGHT NOW — richer value fingerprint, cheaper on
   PEG/FCF, wider moat — and where each wins/loses.

   HONEST-DATA: the five value dimensions are a METHODOLOGY DEMO derived
   deterministically from the existing DataEngine + UNIVERSE (GBM personality
   + per-sector baselines). They are NOT audited financials — the plabel says
   MODEL and the table header says so too. The ONLY live-capable layer is the
   price overlay (crypto slots via the already-wired Coinbase feed); equities
   stay MOCK. Fundamentals are computed locally (never fail) and never jitter
   on tick.

   NON-REPAINTING LAW: COMPARE_CALC.metrics(sym) is a SETTLED verdict computed
   once per (symbol,range) assignment and cached BY THE STATE LAYER — it must
   NOT wiggle every mock tick (that would be dishonest and defeat the
   comparison). Only the base-100 price overlay repaints live on 1D.
   ========================================================================= */

import { seedFromString } from "./prng";
import {
  DataEngine, UNIVERSE, DEFAULT_ROSTER, HIST_POINTS, RANGES, clamp, arrow,
  type Range,
} from "./dataEngine";
import { genSyntheticCloses } from "./ohlc";

export type CmpAxis = "VALUATION" | "MOAT" | "FCF" | "PROFITABILITY" | "GROWTH";
export const CMP_AXES: CmpAxis[] = ["VALUATION", "MOAT", "FCF", "PROFITABILITY", "GROWTH"]; // 1..5 each, *2 -> pentagon 1..10

// paper-cream / warm-brown / cool-grey — NEUTRAL line identity (NOT teal/orange)
export const CMP_COLORS = ["#EDE4CE", "#C79A5E", "#94A79B"];

// Per-sector fundamental baselines (stock-analyzer analyze-value 197-231): fwdPE / roe% / netMargin% /
// fcfYield% / peg. Used to (a) proxy the metrics UNIVERSE lacks and (b) colour rich/cheap vs own sector.
export interface CmpSectorBase { pe: number; roe: number; margin: number; fcfy: number; peg: number }
export const CMP_SECTOR_BASE: Record<string, CmpSectorBase> = {
  "SEMICONDUCTOR":    { pe: 32, roe: 0.20, margin: 0.26, fcfy: 0.030, peg: 1.4 },
  "CONSUMER TECH":    { pe: 28, roe: 0.30, margin: 0.25, fcfy: 0.035, peg: 1.3 },
  "AUTO / ENERGY":    { pe: 20, roe: 0.14, margin: 0.11, fcfy: 0.030, peg: 1.6 },
  "BROAD INDEX":      { pe: 22, roe: 0.16, margin: 0.13, fcfy: 0.045, peg: 1.5 },
  "DIGITAL ASSET":    { pe: NaN, roe: NaN, margin: NaN, fcfy: NaN, peg: NaN },
  "SPECIALTY RETAIL": { pe: 15, roe: 0.08, margin: 0.05, fcfy: 0.055, peg: 1.8 },
  "_DEFAULT":         { pe: 22, roe: 0.15, margin: 0.12, fcfy: 0.040, peg: 1.5 },
};

/* --- SYNTHETIC FALLBACK for typed non-roster symbols (mirrors perfLoadSeries' UNIVERSE[sym]?…:
   genSyntheticCloses path). A typed SYM that isn't on the roster has no UNIVERSE profile and no
   DataEngine quote, so Compare MOCK-derives both deterministically from the ticker hash — the same
   genSyntheticCloses() the Performance screen uses — and tags the profile with the neutral _DEFAULT
   sector (pe stays NaN so COMPARE_CALC's crypto-style valuation fallback engages, never a crash).
   [LIVE SEAM: Tauri-Rust only] the app port swaps these derives for the real quoteSummary lookup. */

// the profile fields COMPARE_CALC actually reads — UNIVERSE's InstrumentProfile
// satisfies this structurally, the synthetic derives satisfy it minimally.
export interface CmpProfile {
  name: string; sector: string; style: string; tags: string[];
  mcap: number; pe: number; div: number; drift: number; beta: number;
  avgvol: number; live: boolean; synthetic?: boolean;
}
// the quote fields COMPARE reads — DataEngine's Quote satisfies this structurally.
export interface CmpQuote {
  last: number; prevClose: number; dayPct: number;
  day: number[]; hist: Record<Range, number[]>; synthetic?: boolean;
}

export function cmpIsRoster(sym: string): boolean { return !!UNIVERSE[sym]; }

// synthetic UNIVERSE-shaped profile for an unlisted ticker (only the fields COMPARE_CALC reads).
const cmpSynthProfileCache: Record<string, CmpProfile> = {};
export function cmpSynthProfile(sym: string): CmpProfile {
  if (cmpSynthProfileCache[sym]) return cmpSynthProfileCache[sym];
  const h = seedFromString(sym);
  const drift = (((h >> 3) % 21) - 10) / 12000;             // same personality basis as genSyntheticCloses
  const mcap = 5e9 + (h % 80) * 1e9;                        // $5B–$85B unlisted-scale guess
  const p: CmpProfile = { name: "Unlisted / synthetic", sector: "_DEFAULT", style: "SYNTHETIC", tags: [],
    mcap, pe: NaN, div: 0, drift, beta: 1.2, avgvol: 5e6, live: false, synthetic: true };
  cmpSynthProfileCache[sym] = p; return p;
}
// UNIVERSE profile if roster, else the synthetic profile. Used everywhere COMPARE reads UNIVERSE[sym].
export function cmpProfile(sym: string): CmpProfile { return UNIVERSE[sym] || cmpSynthProfile(sym); }

// synthetic DataEngine-quote-shaped object for an unlisted ticker (last/dayPct/prevClose + hist per range).
const cmpSynthQuoteCache: Record<string, CmpQuote> = {};
export function cmpSynthQuote(sym: string): CmpQuote {
  if (cmpSynthQuoteCache[sym]) return cmpSynthQuoteCache[sym];
  const hist = {} as Record<Range, number[]>;
  RANGES.forEach((r) => { hist[r] = genSyntheticCloses(sym, HIST_POINTS[r], r); });
  const day = hist["1D"]; const last = day[day.length - 1]; const prevClose = day[0];
  const dayPct = prevClose ? (last / prevClose - 1) * 100 : 0;
  const q: CmpQuote = { last, prevClose, dayPct, day: day.slice(), hist, synthetic: true };
  cmpSynthQuoteCache[sym] = q; return q;
}
// DataEngine quote if roster, else the synthetic quote. Used everywhere COMPARE reads DataEngine.get(sym).
export function cmpQuote(sym: string): CmpQuote { return cmpIsRoster(sym) ? DataEngine.get(sym) : cmpSynthQuote(sym); }

export function cmpSectorBase(sym: string): CmpSectorBase {
  const p = cmpProfile(sym); return CMP_SECTOR_BASE[p && p.sector] || CMP_SECTOR_BASE._DEFAULT;
}

// map a typed ticker to a roster key if it matches one (so BTC -> BTC-USD); otherwise the raw
// ticker becomes a SYNTHETIC slot — cmpProfile()/cmpQuote() MOCK-derive a full profile + history
// from the hash (neutral _DEFAULT sector, pe=NaN -> the crypto-style valuation fallback in
// COMPARE_CALC engages), so any typed symbol is safely comparable and never dereferences undefined.
export function cmpResolveSym(raw: string): string {
  const direct = DEFAULT_ROSTER.find((s) => s === raw || s.replace("-USD", "") === raw); if (direct) return direct;
  return raw.slice(0, 9); // unknown -> synthetic (bounded to the input maxlength; MOCK-derived downstream)
}

/* --- COMPARE_CALC — pure derive-block (no DOM, no canvas), sibling to INDICATOR_CALC/SCAN_CALC.
   Returns {crypto, axes 1..5, composite, verdict, verdictLevel, and delta rows:
   peg,fcfYield,moatScore,divYield,day} with {val, txt, betterHigh}.
   LIVE-WIREUP: replace derive*() with ported yahooquery/quoteSummary (Rust-side, see
   stock-analyzer) — the mock->live swap happens ONLY inside COMPARE_CALC.metrics; the UI never changes. */
export interface CmpDeltaRow { val: number; txt: string; betterHigh: boolean; sub?: string; mkt?: boolean }
export type CmpDeltaKey = "peg" | "fcfYield" | "moatScore" | "divYield" | "day";
export type CmpVerdict = "STRONG BUY" | "BUY" | "HOLD" | "AVOID";
export type CmpVerdictLevel = "ok" | "warn" | "high";
export interface CmpMetrics {
  sym: string; crypto: boolean;
  axes: Record<CmpAxis, number>;    // 1..5 each (*2 -> pentagon 1..10)
  composite: number;                // /5.0
  verdict: CmpVerdict; verdictLevel: CmpVerdictLevel;
  mos: number;                      // margin-of-safety %
  rows: Record<CmpDeltaKey, CmpDeltaRow>;
}
interface MoatInputs { roe: number; netMargin: number; growthAnn: number; crypto: boolean }

export const COMPARE_CALC = {
  metrics(sym: string): CmpMetrics {
    const p = cmpProfile(sym); const q = cmpQuote(sym); const base = cmpSectorBase(sym);
    const crypto = !isFinite(p.pe); // BTC/ETH: no PE -> fixed-3 valuation (matches radarScores VALUE fallback)
    const last = q.last;
    // ---- growth proxied from GBM personality (annualized drift) so NVDA/TSLA read high-growth,
    //      SPY/utilities low — internally consistent with the charts that drift already drives.
    const growthAnn = clamp(p.drift * 252, -0.10, 0.40); // ~annual expected return from daily drift
    // ---- FCF yield proxied off the sector baseline, nudged by relative PE (cheaper PE => higher yield),
    //      then clamped. Crypto has no FCF concept -> hold at a neutral 3/5 later.
    const peRel = crypto ? 1 : clamp(base.pe / (p.pe || base.pe), 0.4, 1.8); // >1 = cheaper than sector
    const fcfYield = crypto ? NaN : clamp(base.fcfy * peRel, 0.005, 0.12);
    // ---- ROE / net margin proxied from the sector baseline, tilted by the growth personality.
    const roe = crypto ? NaN : clamp(base.roe * (0.75 + peRel * 0.35), 0.02, 0.45);
    const netMargin = crypto ? NaN : clamp(base.margin * (0.8 + peRel * 0.3), 0.02, 0.40);
    // ---- PEG = fwdPE / (growth% ) (stock-analyzer METHODOLOGY 282-288). Lower is cheaper.
    const gPct = Math.max(growthAnn * 100, 1);
    const peg = crypto ? NaN : clamp((p.pe || base.pe) / gPct, 0.2, 4.0);
    // ---- margin-of-safety: light DCF proxy — FCF yield above the sector bar => cushion.
    const mos = crypto ? 0 : clamp((fcfYield - base.fcfy) / Math.max(base.fcfy, 0.01) * 40 + (peRel - 1) * 30, -40, 60); // %
    const divYield = p.div > 0 ? (p.div / last) * 100 : 0;

    // ===== FIVE AXIS SCORES — VERBATIM 1-5 cutoffs (compare.json methodologySource / analyze-value 742-748)
    // valuation: 5 if MoS>30 else 4 if >15 else 3 if >0 else 2  (crypto: fixed 3)
    const sVal = crypto ? 3 : (mos > 30 ? 5 : mos > 15 ? 4 : mos > 0 ? 3 : 2);
    // moat: int(analyze_moat.average) via the exact mcap tiers + margin/roe proxies (469-527)
    const sMoat = this.moatScore(sym, { roe, netMargin, growthAnn, crypto });
    // fcf: 5 if fcf>0 && fcf/mcap>0.03 else 4 if fcf>0 else 3  (crypto: neutral 3)
    const sFcf = crypto ? 3 : (fcfYield > 0.03 ? 5 : fcfYield > 0 ? 4 : 3);
    // profit: 5 if roe>0.2 else 4 if >0.15 else 3 if >0.1 else 2  (crypto: neutral 3)
    const sProf = crypto ? 3 : (roe > 0.2 ? 5 : roe > 0.15 ? 4 : roe > 0.1 ? 3 : 2);
    // growth: 5 if avg>0.2 else 4 if >0.15 else 3 if >0.1 else 2
    const sGro = growthAnn > 0.2 ? 5 : growthAnn > 0.15 ? 4 : growthAnn > 0.1 ? 3 : 2;

    const axes: Record<CmpAxis, number> = { VALUATION: sVal, MOAT: sMoat, FCF: sFcf, PROFITABILITY: sProf, GROWTH: sGro };
    const composite = (sVal + sMoat + sFcf + sProf + sGro) / 5; // /5.0
    // final rating gate (SKILL 227-234 / analyze-value 751-758)
    let verdict: CmpVerdict = "AVOID", verdictLevel: CmpVerdictLevel = "high";
    if (composite >= 4.5 && mos > 20) { verdict = "STRONG BUY"; verdictLevel = "ok"; }
    else if (composite >= 4.0 && mos > 10) { verdict = "BUY"; verdictLevel = "ok"; }
    else if (composite >= 3.5) { verdict = "HOLD"; verdictLevel = "warn"; }
    else { verdict = "AVOID"; verdictLevel = "high"; }

    // ---- delta rows (betterHigh = higher value wins the row; false = lower wins, e.g. PEG)
    const rows: Record<CmpDeltaKey, CmpDeltaRow> = {
      peg:      { val: crypto ? NaN : peg,             txt: crypto ? "N/A" : peg.toFixed(2),                          betterHigh: false, sub: crypto ? "—" : this.pegLabel(peg) },
      fcfYield: { val: crypto ? NaN : fcfYield * 100,  txt: crypto ? "N/A" : (fcfYield * 100).toFixed(2) + "%",       betterHigh: true,  sub: crypto ? "—" : (fcfYield > 0.05 ? "HEALTHY" : "THIN") },
      moatScore:{ val: sMoat,                          txt: sMoat.toFixed(0) + " / 5",                                betterHigh: true,  sub: this.moatLabel(sMoat) },
      divYield: { val: divYield,                       txt: divYield > 0 ? divYield.toFixed(2) + "%" : "—",           betterHigh: true,  sub: divYield > 0 ? "PAYS" : "NONE" },
      day:      { val: q.dayPct,                       txt: `${arrow(q.dayPct)} ${Math.abs(q.dayPct).toFixed(2)}%`,   betterHigh: true,  mkt: true },
    };
    return { sym, crypto, axes, composite, verdict, verdictLevel, mos, rows };
  },
  // analyze_moat (469-527): five sub-moats each 1-5 -> average -> int() for the axis score.
  moatScore(sym: string, m: MoatInputs): number {
    const p = cmpProfile(sym);
    if (m.crypto) { // digital assets have no classic moat model -> conservative 3 (network only)
      return 3;
    }
    const mc = p.mcap;
    const network   = mc > 500e9 ? 5 : mc > 100e9 ? 4 : 3;                              // by mcap tier
    const brand     = (m.roe > 0.25 && m.netMargin > 0.20) ? 5 : (m.roe > 0.15 ? 4 : 3); // roe/gross_margin
    const isTech    = /SEMICONDUCTOR|CONSUMER TECH/.test(p.sector);
    const tech      = (isTech && m.growthAnn > 0.15) ? 5 : isTech ? 4 : 3;               // tech-sector + growth
    const cost      = m.netMargin > 0.2 ? 5 : m.netMargin > 0.15 ? 4 : m.netMargin > 0.1 ? 3 : 2; // net_margin tiers
    const switching = m.roe > 0.2 ? 5 : m.roe > 0.15 ? 4 : 3;                            // roe tiers
    const avg = (network + brand + tech + cost + switching) / 5;
    return clamp(Math.round(avg), 1, 5);
  },
  moatLabel(s: number): string { return s >= 4.5 ? "极宽 WIDE+" : s >= 4 ? "宽阔 WIDE" : s >= 3 ? "中等 MODERATE" : "狭窄 NARROW"; },
  pegLabel(peg: number): string { return peg < 0.8 ? "DEEP VALUE" : peg < 1.0 ? "UNDERVALUED" : peg < 1.2 ? "FAIR" : peg < 1.5 ? "RICH" : "EXPENSIVE"; },
};

/* --- the key-stat DELTA table row definitions: one row per headline metric.
   The BEST cell per row gets a 3px orange LEFT-BORDER + ▲ (a "look-here" flag) — NEVER an orange fill. */
export interface CmpDeltaRowDef { key: CmpDeltaKey; label: string; note: string }
export const CMP_DELTA_ROWS: CmpDeltaRowDef[] = [
  { key: "peg",       label: "PEG",        note: "fwdPE / growth · lower cheaper" },
  { key: "fcfYield",  label: "FCF YIELD",  note: "&gt;5% healthy · higher better" },
  { key: "moatScore", label: "MOAT SCORE", note: "analyze_moat avg · 1&#8211;5" },
  { key: "divYield",  label: "DIV YIELD",  note: "div / last · higher better" },
  { key: "day",       label: "1D %",       note: "live day move · market number" },
];

/* --- shared-domain base-100 normalization: index each series to 100 at its first bar, THEN
   take min/max across ALL series together so a £4 crypto and a £600 index share one y-domain.
   PORT NOTE — pure-engine boundary: the prototype read Compare.picker.slots + Compare.range
   (page globals); here the caller passes the slots + range explicitly (state.ts wraps this). */
export interface CmpOverlaySeries { i: number; sym: string; norm: number[]; endPct: number }
export interface CmpOverlay { series: CmpOverlaySeries[]; min: number; max: number }

export function cmpBuildOverlay(slots: (string | null)[], range: Range): CmpOverlay {
  const filled = slots.map((s, i) => ({ sym: s, i })).filter((o): o is { sym: string; i: number } => !!o.sym);
  const out: CmpOverlay = { series: [], min: 100, max: 100 };
  filled.forEach((o) => {
    const q = cmpQuote(o.sym); const raw = q.hist[range] || [];
    if (raw.length < 2) { out.series.push({ i: o.i, sym: o.sym, norm: [], endPct: 0 }); return; }
    const b0 = raw[0] || 1;
    const norm = raw.map((v) => (v / b0) * 100);
    out.series.push({ i: o.i, sym: o.sym, norm, endPct: norm[norm.length - 1] - 100 });
  });
  out.series.forEach((s) => { s.norm.forEach((v) => { if (v < out.min) out.min = v; if (v > out.max) out.max = v; }); });
  if (out.max - out.min < 0.5) { out.min -= 1; out.max += 1; } // guard a flat all-equal domain
  return out;
}
