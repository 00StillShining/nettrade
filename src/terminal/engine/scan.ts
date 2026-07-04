/* =========================================================================
   TERMINAL 77 — SCAN_CALC (ported verbatim from prototypes/terminal-77)

   Pure derive-block for the SCANNER (no DOM, no canvas). Ports the REAL
   thresholds from the four screener skills (cited inline from
   wave2-specs/scanner.json → methodologySource). Every price-derived metric
   is computed on CLOSED bars only (closedN = bars.length-1) so a rank never
   repaints mid-candle. Insufficient-data criteria FAIL CONSERVATIVE (score
   as not-met), never silently pass. BTC/ETH (pe=NaN, div=0) read N/A on
   CANSLIM/DIVPULL.
   ========================================================================= */

import { seedFromString } from "./prng";
import { DataEngine, UNIVERSE, DEFAULT_ROSTER, clamp } from "./dataEngine";
import { ohlcFromCloses, type Bar } from "./ohlc";
import { INDICATOR_CALC } from "./indicators";
import { THRESHOLDS } from "./signals";

export type ScanPresetKey = "VCP" | "CANSLIM" | "BURST" | "DIVPULL" | "ALL";
export interface ScanPreset { key: ScanPresetKey; label: string; name: string }

export const SCAN_PRESETS: ScanPreset[] = [
  { key: "VCP",     label: "VCP.min",        name: "VCP" },
  { key: "CANSLIM", label: "CANSLIM.oneil",  name: "CANSLIM" },
  { key: "BURST",   label: "BURST.stockbee", name: "BURST" },
  { key: "DIVPULL", label: "DIVPULL.rsi40",  name: "DIVPULL" },
  { key: "ALL",     label: "ALL.scan",       name: "ALL" },
];

// Ported one-liners (teal info strip). Approximation flags are explicit & honest.
// HTML strings by design — the screen injects them into the method strip verbatim.
export const SCAN_METHOD: Record<ScanPresetKey, string> = {
  VCP: '<b>MINERVINI VCP:</b> Trend-Template 7&#215;14.3pt PASS&#8805;85; T1 depth 8&#8211;35%, each contraction &#8804;0.75&#215; prior, &#8805;2 tightening, vol dry-up &#8804;0.85&#215;. Bands 90+ Textbook / 80+ Strong / 70+ Good. <b>SMA150/200 need ~222 bars; hist[1M]=160 &#8594; those criteria FAIL-CONSERVATIVE.</b>',
  CANSLIM: '<b>O&#8217;NEIL CANSLIM:</b> C15 A20 N15 S15 L20 I10 M5. C: EPS-QoQ &#8805;50=100. N: within 5% of 52w-high=100. S: up/down-vol &#8805;2.0=100. L: weighted RS (52w-position proxy). <b>C/A/L/I approximated from static profile &#8212; LIVE swaps FMP quarterly EPS.</b>',
  BURST: '<b>STOCKBEE BURST:</b> trigger 4% close/prevClose&#8805;1.04 (+3 if &#8805;7%), vol&gt;prev &amp; &#8805;100k. Maxes trig17/vol20/setup18/close10/risk15 + market5. A&#8805;82 / A-&#8805;72 / B&#8805;62 / Watch&#8805;50.',
  DIVPULL: '<b>DIV-GROWTH PULLBACK:</b> gates yield&#8805;1.5%, 3y div-CAGR&#8805;12%, RSI(14)&#8804;40. Div40/Quality30/Technical20/Val10. <b>Div-CAGR &amp; quality approximated from static UNIVERSE &#8212; LIVE swaps FMP dividend history.</b>',
  ALL: '<b>ALL.scan:</b> best-of the four real screeners per instrument &#8212; the max matched score across VCP / CANSLIM / BURST / DIVPULL. Non-matching names shown dimmed (honest: still evaluated, not hidden).',
};

export interface ScanFundamentals {
  epsQoQ: number; epsCAGR: number; divCAGR: number; instPct: number;
  yieldPct: number; roe: number; isCrypto: boolean;
}
export interface ScanFrame { closes: number[]; n: number; closedN: number; bars: Bar[] }
export type ScanLevel = "ok" | "warn" | "high";
export interface ScanResult {
  score: number;           // 0..100 (NaN on the N/A rows — statusChip renders the dashed chip)
  matched: boolean;
  flag: string;            // which screener produced this verdict ('—' when nothing matched on ALL)
  grade: string;
  level: ScanLevel;
  pips?: number;
  na?: boolean;            // BTC/ETH on CANSLIM/DIVPULL — not-applicable, never zero-scored
  rsi?: number;            // DIVPULL carries its gating RSI for the row readout
}

export const SCAN_CALC = {
  // ---- LIVE SEAM: swap synthetic fundamentals for FMP (Tauri-proxied). -----------
  // ===== LIVE SEAM: mock returns DataEngine/UNIVERSE-derived approximations. The app
  // port replaces THIS BODY with the proxied FMP call + daily cache, leaving all four
  // scorers below untouched. FMP is CORS-blocked + key-leaking in-browser, so it MUST
  // be Rust-proxied; Coinbase price path stays a legal client fetch. [LIVE SEAM: Tauri-Rust only]
  scanFundamentals(sym: string): ScanFundamentals {
    const u = UNIVERSE[sym];
    const isCrypto = !isFinite(u.pe) || (u.div === 0 && (u.sector === "DIGITAL ASSET"));
    const tags = (u.tags || []).join(" ");
    const growth = /AI|MOMENTUM|GROWTH/i.test(u.style + " " + tags);
    // approximate quarterly EPS growth & 3y CAGR from valuation/style (NOT real earnings)
    const epsQoQ  = isCrypto ? NaN : clamp((70 - u.pe) + (growth ? 35 : 5), -20, 80);   // proxy %
    const epsCAGR = isCrypto ? NaN : clamp((growth ? 38 : 18) + (u.beta - 1) * 10, 5, 55);  // proxy %
    const divCAGR = (u.div > 0) ? clamp(6 + u.div * 14, 0, 26) : 0;                     // proxy % from yield
    const instPct = isCrypto ? NaN : clamp(45 + (u.mcap > 1e12 ? 25 : 0) + (growth ? 12 : 0), 20, 92);
    const yieldPct = (u.div > 0 && isFinite(u.pe)) ? u.div : (u.div || 0);              // UNIVERSE.div is already a yield %
    const roe     = isCrypto ? NaN : clamp(8 + (growth ? 14 : 6) + (u.pe < 30 ? 4 : 0), 5, 30);
    return { epsQoQ, epsCAGR, divCAGR, instPct, yieldPct, roe, isCrypto };
  },

  // ---- shared per-symbol closed-bar frame (memo-friendly) ----
  frame(sym: string): ScanFrame {
    const q = DataEngine.get(sym);
    const closes = q.hist["1M"].slice();        // 160 bars per dataEngineHooks spec
    const n = closes.length;
    const closedN = Math.max(0, n - 1);         // NON-REPAINTING: exclude live-forming last bar
    const seed = (DataEngine.seed ^ seedFromString(sym)) ^ 0x4D;  // header SEED 0x4D
    const bars = ohlcFromCloses(closes, seed, UNIVERSE[sym].avgvol / 1000 || 1e5);
    return { closes, n, closedN, bars };
  },

  // ---- VCP (Minervini) — composite 0.25 Trend +0.25 Contraction +0.20 Vol +0.15 Pivot +0.15 RS ----
  vcp(sym: string): ScanResult {
    const { closes, closedN, bars } = this.frame(sym);
    if (closedN < 40) return { score: 0, matched: false, flag: "VCP", grade: "No-VCP", level: "ok", pips: 0 };
    const cl = closes.slice(0, closedN);        // CLOSED closes only
    const last = cl[cl.length - 1];
    const sma = (p: number) => { const a = INDICATOR_CALC.sma(cl, p); return a[a.length - 1]; };
    const sma50 = sma(50), sma150 = sma(150), sma200 = sma(200);
    const lo52 = Math.min(...cl), hi52 = Math.max(...cl);
    // Trend Template: 7 criteria × 14.3pt, PASS ≥85 (≥6 of 7). SMA150/200 need ~222 bars;
    // we only have 160 closed → c1..c4 UNVERIFIABLE → FAIL CONSERVATIVE (met=false), like the Python.
    const rsProxy = clamp(((last - lo52) / ((hi52 - lo52) || 1)) * 100, 0, 100); // RS proxy from 52w position
    const crit = [
      isFinite(sma150) && isFinite(sma200) && last > sma150 && last > sma200,   // c1 (needs 200) → false here
      isFinite(sma150) && isFinite(sma200) && sma150 > sma200,                  // c2 (needs 200) → false
      false,                                                                    // c3 SMA200 rising 22d — UNVERIFIABLE → fail-conservative
      isFinite(sma50) && last > sma50,                                          // c4 (needs 50) → verifiable
      (last >= lo52 * 1.25),                                                    // c5 ≥25% above 52w-low
      (last >= hi52 * 0.75),                                                    // c6 within 25% of 52w-high
      rsProxy > 70,                                                             // c7 RS>70 (proxy)
    ];
    const met = crit.filter(Boolean).length;
    const trendScore = met * 14.3;              // 0..100
    const trendPass = trendScore >= 85 && met >= 6;
    // Contraction quality: scan last ~40 closed bars for tightening pullbacks.
    const seg = cl.slice(-Math.min(50, cl.length));
    const { contractions, maxDepth, tightening } = this._contractions(seg);
    const t1ok = maxDepth >= 8 && maxDepth <= 35; // T1 depth 8–35%
    const contractionQ = (contractions >= 2 && tightening && t1ok) ? 90 : (contractions >= 2 ? 60 : 30);
    // Volume dry-up ≤0.85× (BURST-style vol ratio on closed bars)
    const vols = bars.slice(0, closedN).map((b) => b.v);
    const vDry = this._volDryUp(vols) <= 0.85 ? 90 : 55;
    // Pivot proximity: how close to the 52w-high pivot (within 25% window)
    const pivot = clamp(100 - ((hi52 - last) / ((hi52 * 0.25) || 1)) * 100, 0, 100);
    const composite = 0.25 * trendScore + 0.25 * contractionQ + 0.20 * vDry + 0.15 * pivot + 0.15 * rsProxy;
    // matched only if trend template passes AND a real VCP (≥2 contractions, T1 in band)
    const matched = trendPass && contractions >= 2 && t1ok;
    const grade = composite >= 90 ? "Textbook" : composite >= 80 ? "Strong" : composite >= 70 ? "Good" : composite >= 60 ? "Developing" : composite >= 50 ? "Weak" : "No-VCP";
    const level: ScanLevel = composite >= 80 ? "high" : composite >= 60 ? "warn" : "ok";
    return { score: Math.round(composite), matched, flag: "VCP", grade, level, pips: matched ? (composite >= 80 ? 3 : 2) : 1 };
  },
  _contractions(seg: number[]): { contractions: number; maxDepth: number; tightening: boolean } {
    // find local peaks→troughs; measure each pullback depth; check monotone tightening
    const depths: number[] = []; let peak = seg[0], inPull = false, trough = seg[0];
    for (let i = 1; i < seg.length; i++) {
      if (seg[i] > peak && !inPull) { peak = seg[i]; }
      if (seg[i] < peak) { inPull = true; trough = Math.min(trough, seg[i]); }
      if (inPull && seg[i] >= peak * 0.999) { // recovered → close the contraction
        depths.push((peak - trough) / peak * 100); peak = seg[i]; trough = seg[i]; inPull = false;
      }
    }
    if (inPull) depths.push((peak - trough) / peak * 100);
    let tightening = depths.length >= 2;
    // strict: every contraction ≤0.75× the prior (contraction_ratio 0.75)
    for (let i = 1; i < depths.length; i++) { if (depths[i] > depths[i - 1] * 0.75) { tightening = false; break; } }
    return { contractions: depths.length, maxDepth: depths.length ? depths[0] : 0, tightening };
  },
  _volDryUp(vols: number[]): number {
    if (vols.length < 25) return 1;
    const recent = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const base = vols.slice(-25, -5).reduce((a, b) => a + b, 0) / 20;
    return base ? recent / base : 1;
  },

  // ---- CANSLIM (O'Neil) — C15 A20 N15 S15 L20 I10 M5 ----
  canslim(sym: string): ScanResult {
    const f = this.scanFundamentals(sym);
    if (f.isCrypto) return { score: NaN, matched: false, flag: "CANSLIM", grade: "N/A", level: "ok", na: true };
    const { closes, closedN } = this.frame(sym);
    const cl = closes.slice(0, closedN); const last = cl[cl.length - 1];
    const hi52 = Math.max(...cl), lo52 = Math.min(...cl);
    // C: EPS QoQ ≥50%=100 / 30–49=80 / 18–29=60  (×0.15)
    const C = f.epsQoQ >= 50 ? 100 : f.epsQoQ >= 30 ? 80 : f.epsQoQ >= 18 ? 60 : 30;
    // A: 3y EPS CAGR ≥40=90 / 30–39=70 / 25–29=50  (×0.20)
    const A = f.epsCAGR >= 40 ? 90 : f.epsCAGR >= 30 ? 70 : f.epsCAGR >= 25 ? 50 : 30;
    // N: within 5% of 52w-high=100 / 10%=80  (×0.15)  — price-honest
    const distHi = (hi52 - last) / ((hi52) || 1) * 100;
    const N = distHi <= 5 ? 100 : distHi <= 10 ? 80 : 40;
    // S: up/down-vol ratio (proxy from recent up vs down closes) (×0.15)
    const S = this._upDownVol(cl) >= 2.0 ? 100 : this._upDownVol(cl) >= 1.5 ? 80 : this._upDownVol(cl) >= 1.0 ? 60 : 30;
    // L: weighted RS proxy (52w position) (×0.20)
    const rs = clamp(((last - lo52) / ((hi52 - lo52) || 1)) * 100, 0, 100); const L = rs >= 90 ? 100 : rs >= 80 ? 85 : rs >= 70 ? 70 : 50;
    // I: institutional % approx (×0.10)
    const I = f.instPct >= 80 ? 100 : f.instPct >= 60 ? 80 : 60;
    // M: market gate — SPY vs its 50-EMA; bear = hard veto (0)  (×0.05)
    const M = this._marketGate() ? 100 : 0;
    let comp = 0.15 * C + 0.20 * A + 0.15 * N + 0.15 * S + 0.20 * L + 0.10 * I + 0.05 * M;
    if (M === 0) comp = 0;   // hard veto (bear market → whole screen fails)
    const grade = comp >= 90 ? "Except+" : comp >= 80 ? "Except" : comp >= 70 ? "Strong" : comp >= 60 ? "Above-Avg" : "Weak";
    const matched = comp >= 70 && M !== 0;
    const level: ScanLevel = comp >= 80 ? "high" : comp >= 60 ? "warn" : "ok";
    return { score: Math.round(comp), matched, flag: "CANSLIM", grade, level, pips: matched ? (comp >= 80 ? 3 : 2) : 1 };
  },
  _upDownVol(cl: number[]): number {
    let up = 0, dn = 0; for (let i = Math.max(1, cl.length - 30); i < cl.length; i++) { if (cl[i] >= cl[i - 1]) up++; else dn++; }
    return dn ? up / dn : 3;
  },
  _marketGate(): boolean {
    const spy = DataEngine.get("SPY"); const cl = spy.hist["1M"]; const n = cl.length - 1;
    const e = INDICATOR_CALC.ema(cl.slice(0, n), 50); const last = e[e.length - 1];
    return isFinite(last) ? cl[n - 1] > last : true;   // insufficient data → not a hard veto
  },

  // ---- BURST (Stockbee momentum-burst) — trigger20 vol20 setup25 close10 risk15 ----
  burst(sym: string): ScanResult {
    const { closedN, bars } = this.frame(sym);
    if (closedN < 25) return { score: 0, matched: false, flag: "BURST", grade: "Reject", level: "ok", pips: 0 };
    const b = bars.slice(0, closedN);           // CLOSED bars only
    const cur = b[b.length - 1], prev = b[b.length - 2];
    const pctUp = (cur.c / prev.c - 1) * 100;
    // trigger: 4%-breakout close/prevClose≥1.04 + volume>prev + volume≥100k floor
    const trigFire = cur.c / prev.c >= 1.04 && cur.v > prev.v && cur.v >= 1e5;
    let trigger = trigFire ? 14 : 0; if (pctUp >= 7) trigger += 3;    // +3 if ≥7%
    trigger = Math.min(trigger, 20);
    // volume: best of vol_1d/vol_20d ≥3.0=20/≥2.0=15/≥1.5=10/≥1.0=6
    const v20 = b.slice(-21, -1).reduce((a, x) => a + x.v, 0) / 20; const vr = v20 ? cur.v / v20 : 1;
    const volume = vr >= 3 ? 20 : vr >= 2 ? 15 : vr >= 1.5 ? 10 : vr >= 1 ? 6 : 0;
    // setup25: base-days ≥10=10, narrow prior-day range ≤3%=5, base vol dry-up ≤0.85×=+3
    const baseDays = this._baseDays(b); const priorRange = (prev.h - prev.l) / prev.c * 100;
    let setup = (baseDays >= 10 ? 10 : 0) + (priorRange <= 3 ? 5 : 0) + (this._volDryUp(b.map((x) => x.v)) <= 0.85 ? 3 : 0);
    setup = Math.min(setup, 25);
    // close-quality10: (close-low)/(high-low) ≥90%=10 …≥50%=3
    const cq = (cur.h > cur.l) ? (cur.c - cur.l) / (cur.h - cur.l) : 1; const closeQ = cq >= 0.9 ? 10 : cq >= 0.7 ? 7 : cq >= 0.5 ? 3 : 0;
    // risk-distance15: dist to base-low ≤2.5%=15,≤4%=12,≤6%=8
    const baseLow = Math.min(...b.slice(-Math.min(20, b.length)).map((x) => x.l));
    const riskDist = (cur.c - baseLow) / cur.c * 100; const risk = riskDist <= 2.5 ? 15 : riskDist <= 4 ? 12 : riskDist <= 6 ? 8 : 3;
    let score = trigger + volume + setup + closeQ + risk;   // + market-gate 5 (assumed open below)
    score += this._marketGate() ? 5 : 0;
    // Achievable ceiling = trig17 + vol20 + setup18 + close10 + risk15 + market5 = 85, so the top
    // grade A must be reachable BELOW that (was A≥90 — unawardable). Bands relabelled to the real max.
    const grade = score >= 82 ? "A" : score >= 72 ? "A-" : score >= 62 ? "B" : score >= 50 ? "Watch" : "Reject";
    const matched = trigFire && score >= 70;
    const level: ScanLevel = score >= 80 ? "high" : score >= 55 ? "warn" : "ok";
    return { score: Math.round(clamp(score, 0, 100)), matched, flag: "BURST", grade, level, pips: matched ? (score >= 80 ? 3 : 2) : 1 };
  },
  _baseDays(b: Bar[]): number { // consecutive prior bars whose range stayed inside a tight band before the trigger
    let days = 0;
    for (let i = b.length - 2; i >= 1; i--) { const rng = (b[i].h - b[i].l) / b[i].c * 100; if (rng > 6) break; days++; if (days > 30) break; }
    return days;
  },

  // ---- DIVPULL (dividend-growth pullback) — Div40 Quality30 Technical20 Val10 ----
  divpull(sym: string): ScanResult {
    const f = this.scanFundamentals(sym);
    const u = UNIVERSE[sym];
    if (f.isCrypto || u.div === 0) return { score: NaN, matched: false, flag: "DIVPULL", grade: "N/A", level: "ok", na: true };
    const { closes, closedN } = this.frame(sym);
    const cl = closes.slice(0, closedN);
    const rsiArr = INDICATOR_CALC.rsi(cl, THRESHOLDS.RSI_PERIOD); const rsi = rsiArr[rsiArr.length - 1];
    // Gates: yield ≥1.5%, 3y div-CAGR ≥12%, RSI(14) ≤40
    const gates = f.yieldPct >= 1.5 && f.divCAGR >= 12 && isFinite(rsi) && rsi <= 40;
    // Div score: CAGR ≥20=40/≥15=35/≥12=30/else20 (+5 consistency)
    const div = (f.divCAGR >= 20 ? 40 : f.divCAGR >= 15 ? 35 : f.divCAGR >= 12 ? 30 : 20) + (f.divCAGR >= 12 ? 5 : 0);
    // Quality30: ROE ≥20=12/≥15=10/≥10=7 (+ margin/D-E proxies folded in)
    const qual = (f.roe >= 20 ? 12 : f.roe >= 15 ? 10 : f.roe >= 10 ? 7 : 4) + 10 + (u.beta < 1.2 ? 8 : 3);
    // Technical20 (RSI): ≤25=20/≤30=18/≤35=15/≤40=12/else5
    const tech = !isFinite(rsi) ? 5 : rsi <= 25 ? 20 : rsi <= 30 ? 18 : rsi <= 35 ? 15 : rsi <= 40 ? 12 : 5;
    // Valuation10: cheaper PE → higher
    const val = u.pe < 20 ? 10 : u.pe < 30 ? 7 : u.pe < 40 ? 4 : 2;
    const comp = clamp(0.40 * div + 0.30 * Math.min(qual, 30) + 0.20 * tech + 0.10 * val, 0, 100);
    const matched = gates && comp >= 60;
    const grade = comp >= 80 ? "Strong" : comp >= 65 ? "Buy-zone" : comp >= 50 ? "Watch" : "Pass";
    const level: ScanLevel = comp >= 75 ? "high" : comp >= 55 ? "warn" : "ok";
    return { score: Math.round(comp), matched, flag: "DIVPULL", grade, level, pips: matched ? (comp >= 75 ? 3 : 2) : 1, rsi };
  },

  // ---- dispatch one preset over one symbol ----
  run(preset: ScanPresetKey, sym: string): ScanResult {
    if (preset === "VCP")     return this.vcp(sym);
    if (preset === "CANSLIM") return this.canslim(sym);
    if (preset === "BURST")   return this.burst(sym);
    if (preset === "DIVPULL") return this.divpull(sym);
    // ALL = best matched score across the four
    const parts = [this.vcp(sym), this.canslim(sym), this.burst(sym), this.divpull(sym)];
    const real = parts.filter((p) => isFinite(p.score));
    real.sort((a, b) => (Number(b.matched) - Number(a.matched)) || (b.score - a.score));
    const best: ScanResult = real[0] || { score: 0, matched: false, flag: "—", grade: "No-VCP", level: "ok", pips: 0 };
    return { ...best, flag: best.matched ? best.flag : (best.flag || "—") };
  },
};

// roster-wide matched count for a preset (the segToggle superscript numbers)
export function scanCountFor(preset: ScanPresetKey): number {
  let c = 0; DEFAULT_ROSTER.forEach((s) => { if (SCAN_CALC.run(preset, s).matched) c++; }); return c;
}
