/* =========================================================================
   TERMINAL 77 — ALERTS ENGINES (ported verbatim from prototypes/terminal-77)

   TWO families, both derived from the EXISTING DataEngine so nothing is
   fabricated:
     (1) PRICE / INDICATOR / DAY% watches — arm a predicate against a roster
         symbol; it LATCHES ARMED->TRIGGERED on first cross (jitter can't
         re-arm/spam).
     (2) REGIME monitors — a faithful PORT of two skills over CLOSED daily
         bars:
         • ibd-distribution-day-monitor  (Distribution-Day count + risk
           classifier + UNLEVERAGED exposure policy)
         • ftd-detector                   (rally-attempt / follow-through
           state machine)
   Dual-index: SPY (roster proxy) + a synthetic 'NDX' (genSyntheticCloses) so
   the QQQ-weighted combine the skills require has two real inputs.

   NON-REPAINTING IS LAW: the regime engines finalize ONLY on a settled daily
   bar (state.ts gates the recompute on a closed-bar roll + caches the
   verdict). RSI watches evaluate on CLOSED bars (forming candle dropped).
   Informational only — NEVER a trade gate.
   ========================================================================= */

import { seedFromString } from "./prng";
import { DataEngine, HIST_POINTS, fmtUSD } from "./dataEngine";
import { ohlcFromCloses, genSyntheticCloses, type Bar } from "./ohlc";
import { INDICATOR_CALC } from "./indicators";
import { THRESHOLDS } from "./signals";

// PORTED THRESHOLDS — the debugged numbers from the two skills. Do NOT "improve"
// them; any deviation must be flagged // TUNABLE (none are — these are the ports).
export const ALERT_TH = {
  DD_MIN_DECLINE:      -0.002,  // ibd: Distribution Day = close <= -0.2% vs prior
  DD_EXPIRE_SESSIONS:  25,      // ibd: expiration_sessions
  DD_INVALIDATE_GAIN:  0.05,    // ibd: +5% from DD close invalidates (source: high)
  FTD_MIN_CORRECTION:  3.0,     // ftd: MIN_CORRECTION_PCT (%)
  FTD_MIN_DOWN_DAYS:   3,       // ftd: MIN_DOWN_DAYS
  FTD_LOOKBACK:        40,      // ftd: recent-high lookback window (days)
  FTD_DAY_START:       4,       // ftd: FTD_DAY_START (window opens Day 4)
  FTD_DAY_END:         10,      // ftd: FTD_DAY_END (window closes Day 10)
  FTD_GAIN_MIN:        1.25,    // ftd: FTD_GAIN_MINIMUM (%)
  FTD_GAIN_REC:        1.5,     // ftd: FTD_GAIN_RECOMMENDED (%)
  FTD_GAIN_STRONG:     2.0,     // ftd: FTD_GAIN_STRONG (%)
} as const;

/* ---- IBD Distribution-Day tracker (port of distribution_day_tracker.py) ----
   Walks CLOSED bars. A DD at index k is close_k <= -0.2% vs close_{k-1} AND
   vol_k > vol_{k-1}. It EXPIRES when age_sessions (settled sessions since it
   formed) > 25, OR the index high in any post-DD session gains >= +5% from the
   DD close. Today's DD (k = last index) is never invalidated (no post-DD
   sessions exist yet). */
export interface DdRecord { idx: number; age: number }
export interface DdSummary { d5: number; d15: number; d25: number; records: DdRecord[] }

export function ibdDistribution(bars: Bar[]): DdSummary {
  const n = bars.length; const active: DdRecord[] = [];
  for (let k = 1; k < n; k++) {
    const chg = (bars[k].c / bars[k - 1].c) - 1;
    if (chg <= ALERT_TH.DD_MIN_DECLINE && bars[k].v > bars[k - 1].v) {
      // is this DD still active as of the LAST closed bar?
      const ageSessions = (n - 1) - k; // settled sessions since it formed
      if (ageSessions > ALERT_TH.DD_EXPIRE_SESSIONS) continue; // expired by age
      // +5% invalidation: any post-DD session high >= DD close * 1.05
      let invalidated = false;
      for (let j = k + 1; j < n; j++) { if (bars[j].h >= bars[k].c * (1 + ALERT_TH.DD_INVALIDATE_GAIN)) { invalidated = true; break; } }
      if (invalidated) continue;
      active.push({ idx: k, age: ageSessions });
    }
  }
  const within = (a: number) => active.filter((d) => d.age <= a).length;
  return { d5: within(5), d15: within(15), d25: within(25), records: active };
}

/* ---- risk classifier (port of risk_classifier.py + default.yaml thresholds) ----
   Per-index band, plus the boolean market_below_MA (close below 21EMA or 50SMA). */
export type RiskBand = "NORMAL" | "CAUTION" | "HIGH" | "SEVERE";

export function ibdRiskBand(dd: DdSummary, closes: number[]): { band: RiskBand; belowMA: boolean } {
  const belowMA = (() => {
    const ema21 = INDICATOR_CALC.ema(closes, 21); const sma50 = INDICATOR_CALC.sma(closes, 50);
    const c = closes[closes.length - 1]; const e = ema21[ema21.length - 1], s = sma50[sma50.length - 1];
    return (isFinite(e) && c < e) || (isFinite(s) && c < s);
  })();
  const { d5, d15, d25 } = dd;
  let band: RiskBand;
  if (d25 >= 6 || d15 >= 4 || (belowMA && d25 >= 5)) band = "SEVERE";
  else if (d25 >= 5 || d15 >= 3 || d5 >= 2)          band = "HIGH";
  else if (d25 >= 3)                                 band = "CAUTION";
  else                                               band = "NORMAL";
  return { band, belowMA };
}

// dual-index QQQ-weighted combine (QQQ==NDX proxy here; SPY is the S&P proxy)
export function ibdCombine(ndxBand: RiskBand, spyBand: RiskBand): RiskBand {
  const rank: Record<RiskBand, number> = { NORMAL: 0, CAUTION: 1, HIGH: 2, SEVERE: 3 };
  if (ndxBand === "SEVERE" || spyBand === "SEVERE") return "SEVERE";
  if (ndxBand === "HIGH") return "HIGH";
  if (ndxBand === "NORMAL" && spyBand === "HIGH") return "HIGH";
  if (ndxBand === "CAUTION" && rank[spyBand] >= 1) return "HIGH";
  // otherwise take the more cautious of the two
  return rank[ndxBand] >= rank[spyBand] ? ndxBand : spyBand;
}

/* ---- UNLEVERAGED exposure policy (port of exposure_policy.py, unlevered QQQ
   variant). Reframed as an INFORMATIONAL ceiling/hint — never a trade gate. ---- */
export interface ExposurePolicy { ceiling: number; hint: string }
export const IBD_EXPOSURE: Record<RiskBand, ExposurePolicy> = {
  NORMAL:  { ceiling: 100, hint: "FULL EXPOSURE OK" },
  CAUTION: { ceiling: 100, hint: "AVOID NEW ADDS" },
  HIGH:    { ceiling: 75,  hint: "REDUCE EXPOSURE" },
  SEVERE:  { ceiling: 50,  hint: "DEFENSIVE · TIGHTEN STOPS" },
};
export type ChipLevel = "ok" | "warn" | "high" | "severe";
export const IBD_LEVEL: Record<RiskBand, ChipLevel> = { NORMAL: "ok", CAUTION: "warn", HIGH: "high", SEVERE: "severe" };

/* ---- FTD rally state machine (port of rally_tracker.py + SKILL.md) ----
   Walks CLOSED bars with no look-ahead. Finds the most-recent correction
   (>=3% off a 40-day high with >=3 down days), then tracks Day 1..n from the
   swing low. Returns a state string + swing-low / FTD-day watch levels + a
   quality hint. */
export interface FtdReport {
  state: string;
  level: "ok" | "warn";
  lowLvl: number | null;
  ftdLvl: number | null;
  day: number;
  hint: string;
}

export function ftdState(bars: Bar[]): FtdReport {
  const n = bars.length; if (n < 10) return { state: "NO SIGNAL", level: "ok", lowLvl: null, ftdLvl: null, day: 0, hint: "INSUFFICIENT HISTORY" };
  const closes = bars.map((b) => b.c);
  // recent high within lookback, ending a few bars back so a correction can develop
  const look = Math.min(ALERT_TH.FTD_LOOKBACK, n - 1);
  let hiIdx = n - 1 - look, hiVal = closes[hiIdx];
  for (let i = n - 1 - look; i < n; i++) { if (closes[i] > hiVal) { hiVal = closes[i]; hiIdx = i; } }
  // swing low = lowest CLOSE after the high
  let loIdx = hiIdx, loVal = closes[hiIdx];
  for (let i = hiIdx; i < n; i++) { if (closes[i] < loVal) { loVal = closes[i]; loIdx = i; } }
  const declinePct = (1 - loVal / hiVal) * 100;
  // count down days between high and low
  let downDays = 0; for (let i = hiIdx + 1; i <= loIdx; i++) { if (closes[i] < closes[i - 1]) downDays++; }
  const corrected = declinePct >= ALERT_TH.FTD_MIN_CORRECTION && downDays >= ALERT_TH.FTD_MIN_DOWN_DAYS;
  if (!corrected) {
    return { state: "NO SIGNAL", level: "ok", lowLvl: null, ftdLvl: bars[n - 1].c, day: 0, hint: "MARKET IN UPTREND · NO CORRECTION" };
  }
  const swingLow = bars[loIdx];
  // Day 1 = first session after the low that closes up OR in the top 50% of range
  let day1 = -1;
  for (let i = loIdx + 1; i < n; i++) {
    const b = bars[i]; const up = b.c > bars[i - 1].c;
    const rng = (b.h - b.l) || 1; const topHalf = (b.c - b.l) / rng >= 0.5;
    if (up || topHalf) { day1 = i; break; }
  }
  if (day1 < 0) {
    return { state: "CORRECTION", level: "warn", lowLvl: swingLow.l, ftdLvl: null, day: 0, hint: `OFF ${declinePct.toFixed(1)}% · AWAITING RALLY ATTEMPT` };
  }
  // any close below the swing low after day1 invalidates the rally
  for (let i = day1; i < n; i++) { if (bars[i].c < swingLow.l) { return { state: "RALLY FAILED", level: "warn", lowLvl: swingLow.l, ftdLvl: null, day: 0, hint: "UNDERCUT SWING LOW · NEW ATTEMPT NEEDED" }; } }
  const dayNum = (n - 1) - day1 + 1; // Day count as of last closed bar (Day 1 == day1)
  // scan the FTD window (Day 4..10) for a Follow-Through Day
  const day1Low = bars[day1].l;
  for (let i = day1; i < n; i++) {
    const d = (i - day1) + 1;
    if (i > day1 && bars[i].c < day1Low) { return { state: "RALLY FAILED", level: "warn", lowLvl: swingLow.l, ftdLvl: null, day: 0, hint: "BREACHED DAY-1 LOW" }; }
    if (d >= ALERT_TH.FTD_DAY_START && d <= ALERT_TH.FTD_DAY_END) {
      const chg = (bars[i].c / bars[i - 1].c - 1) * 100;
      if (chg >= ALERT_TH.FTD_GAIN_MIN && bars[i].v > bars[i - 1].v) {
        // FTD confirmed — invalidated if a LATER close is below the FTD day's low
        let inval = false; for (let j = i + 1; j < n; j++) { if (bars[j].c < bars[i].l) { inval = true; break; } }
        const tier = chg >= ALERT_TH.FTD_GAIN_STRONG ? "STRONG" : chg >= ALERT_TH.FTD_GAIN_REC ? "RECOMMENDED" : "MINIMUM";
        if (inval) return { state: "FTD INVALIDATED", level: "warn", lowLvl: swingLow.l, ftdLvl: bars[i].l, day: d, hint: "UNDERCUT FTD-DAY LOW" };
        return { state: "FTD CONFIRMED", level: "ok", lowLvl: swingLow.l, ftdLvl: bars[i].l, day: d, hint: `${tier} · +${chg.toFixed(2)}% ON HIGHER VOL` };
      }
    }
  }
  // no FTD yet — report window position
  if (dayNum < ALERT_TH.FTD_DAY_START) return { state: `RALLY ATTEMPT DAY ${dayNum}`, level: "warn", lowLvl: swingLow.l, ftdLvl: null, day: dayNum, hint: "FTD WINDOW OPENS DAY 4" };
  if (dayNum <= ALERT_TH.FTD_DAY_END)  return { state: `FTD WINDOW DAY ${dayNum}`, level: "warn", lowLvl: swingLow.l, ftdLvl: null, day: dayNum, hint: `WATCH FOR +${ALERT_TH.FTD_GAIN_MIN}% ON HIGHER VOL` };
  return { state: "WINDOW CLOSED", level: "warn", lowLvl: swingLow.l, ftdLvl: null, day: dayNum, hint: "NO FTD DAY 4–10 · AWAITING NEW ATTEMPT" };
}

/* ---- regime source + combined verdict ------------------------------------
   [LIVE SEAM: Tauri-Rust only] — the ONE swap point. Returns {spy,ndx} OHLCV
   bar arrays. MOCK today: SPY from DataEngine (roster proxy), NDX from
   genSyntheticCloses. In the app port this points at the FMP
   historical-price-full adapter (routed through the Rust fetch, like the T212
   adapter, to dodge CORS); the engines downstream never change. Kept behind
   the same 3s-failover discipline as DataEngine.tryLive. */
export function alertsRegimeSource(): { spy: Bar[]; ndx: Bar[] } {
  const spyCloses = DataEngine.get("SPY").hist["1Y"];            // 240 daily closes
  const spy = ohlcFromCloses(spyCloses, seedFromString("SPY|REGIME"), 6.1e7);
  const ndxCloses = genSyntheticCloses("NDX", HIST_POINTS["1Y"], "1Y");
  const ndx = ohlcFromCloses(ndxCloses, seedFromString("NDX|REGIME"), 5.2e8);
  return { spy, ndx };
}

export interface RegimeReport {
  spyDD: DdSummary; ndxDD: DdSummary;
  spyBand: RiskBand; ndxBand: RiskBand; band: RiskBand;
  exposure: ExposurePolicy; ftd: FtdReport; settled: string;
}

// PURE regime compute — the caching + closed-bar gating (NON-REPAINTING) lives
// in state.ts (alertsComputeRegime), which only calls this when the settled
// daily bar has actually rolled.
export function computeRegime(): RegimeReport {
  const { spy, ndx } = alertsRegimeSource();
  const spyDD = ibdDistribution(spy), ndxDD = ibdDistribution(ndx);
  const spyBand = ibdRiskBand(spyDD, spy.map((b) => b.c)).band;
  const ndxBand = ibdRiskBand(ndxDD, ndx.map((b) => b.c)).band;
  const band = ibdCombine(ndxBand, spyBand);
  const exposure = IBD_EXPOSURE[band];
  const ftd = ftdState(spy);
  const settled = alertsSettledDate();
  return { spyDD, ndxDD, spyBand, ndxBand, band, exposure, ftd, settled };
}

// a plausible 'last settled session' date (mock bars carry no real calendar) — walk
// back N weekdays from today so the footnote reads honestly as a trading day.
export function alertsSettledDate(): string {
  const d = new Date(); let back = 1;
  while (back > 0) { d.setDate(d.getDate() - 1); const wd = d.getDay(); if (wd !== 0 && wd !== 6) back--; }
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }).toUpperCase();
}

/* ---- WATCHES: armed predicates over roster symbols ---------------------- */
export type WatchMetric = "PRICE" | "RSI" | "DAY%";
export const ALERT_METRICS: WatchMetric[] = ["PRICE", "RSI", "DAY%"];
export type WatchOp = ">" | "<";
export interface Watch {
  id: number; sym: string; metric: WatchMetric; op: WatchOp; level: number;
  state: "ARMED" | "TRIGGERED"; firedAt: string | null; now: number | null;
}

// live "NOW" value for a watch's metric — PRICE/DAY% read q.last live (that IS the
// intended 'now' semantic); RSI reads CLOSED bars only (drop the forming candle).
export function alertWatchNow(w: Watch): number | null {
  const q = DataEngine.get(w.sym);
  if (w.metric === "PRICE") return q.last;
  if (w.metric === "DAY%")  return q.dayPct;
  // RSI: 1M closed series, forming bar dropped
  const cl = q.hist["1M"].slice(0, Math.max(0, q.hist["1M"].length - 1));
  const arr = INDICATOR_CALC.rsi(cl, THRESHOLDS.RSI_PERIOD);
  const v = arr[arr.length - 1]; return isFinite(v) ? v : null;
}

export function alertPredicate(now: number | null, op: WatchOp, level: number): boolean {
  if (now == null) return false;
  return op === ">" ? now > level : now < level;
}

/* evaluate ALL watches every tick (cheap). LATCH on first cross: ARMED->TRIGGERED,
   never re-arm on jitter. PORT NOTE — pure-engine boundary: the prototype set the
   roster WATCH star bit via the page-global setAlertWatch; here the caller injects
   it (state.ts passes its own setAlertWatch) so the engine stays state-free. */
export function evaluateWatches(watches: Watch[], setWatchFlag: (sym: string, on: boolean) => void): boolean {
  let changed = false;
  watches.forEach((w) => {
    const now = alertWatchNow(w); w.now = now;
    if (w.state === "ARMED" && alertPredicate(now, w.op, w.level)) {
      w.state = "TRIGGERED"; w.firedAt = nowClock(); setWatchFlag(w.sym, true); changed = true;
    }
  });
  return changed;
}

export function nowClock(): string {
  const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// human condition label for a watch row ("PRICE > $130.00" etc) — string only, no DOM
export function alertMetricLabel(w: Watch): string {
  if (w.metric === "PRICE") return `PRICE ${w.op} ${fmtUSD(w.level, w.level < 10 ? 4 : 2)}`;
  if (w.metric === "RSI")   return `RSI(14) ${w.op} ${w.level.toFixed(0)}`;
  return `DAY% ${w.op} ${w.level >= 0 ? "+" : ""}${w.level.toFixed(2)}%`;
}
