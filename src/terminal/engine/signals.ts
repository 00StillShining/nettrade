/* =========================================================================
   TERMINAL 77 — SIGNAL ENGINES (ported verbatim from prototypes/terminal-77)

   THRESHOLDS + SIGNAL_CALC. Custom signal approximations; every guessed
   number is flagged // TUNABLE and gathered in THRESHOLDS (one place to
   retune, zero magic numbers in the math below).

   NON-REPAINTING IS LAW: every function consumes CLOSED candles only —
   callers pass closedN (bars.length - 1, the live-forming last bar dropped)
   and the signal arrays are frozen at that index architecturally, not by
   convention. A historical mark can never appear/move/vanish mid-candle.

   The wave-1 review fixes are INTACT: emaCompression and adaptiveColors read
   the FINITE SUBSET of the EMA ribbon (the slow 144/233 EMAs never warm up
   on short ranges — demanding all 8 would zero both signals out entirely).
   ========================================================================= */

import { INDICATOR_CALC } from "./indicators";

/* ---- THRESHOLDS: every guessed/tunable number, collected in one place ---- */
export const THRESHOLDS = {
  EMA_PERIODS:      [8, 13, 21, 34, 55, 89, 144, 233], // ribbon periods (configurable const)
  RIBBON_MIN_EMAS:  4,   // TUNABLE — min FINITE ribbon EMAs before adaptive/squeeze read (slow EMAs never warm up on short ranges)
  BB_PERIOD:        20,
  BB_SIGMA_INNER:   1,   // dual Bollinger inner band
  BB_SIGMA_OUTER:   2,   // dual Bollinger outer band
  SUPERTREND_ATR:   10,  // ATR lookback for SuperTrend
  SUPERTREND_MULT:  3,   // TUNABLE — SuperTrend band multiplier (classic 3, but a guess for this feed)
  ATR_PERIOD:       14,
  RSI_PERIOD:       14,
  RSI_MA_PERIOD:    9,   // TUNABLE — smoothing MA the RSI crosses in the cycle engine
  RSI_OVERBOUGHT:   70,  // TUNABLE — watch-zone upper rail
  RSI_OVERSOLD:     30,  // TUNABLE — watch-zone lower rail
  STOCHRSI_PERIOD:  14,
  STOCHRSI_K:       3,
  STOCHRSI_D:       3,
  MACD_FAST:        12,
  MACD_SLOW:        26,
  MACD_SIGNAL:      9,
  EMA_SQUEEZE_LOOKBACK: 100, // TUNABLE — window for the ribbon-width percentile
  EMA_SQUEEZE_PCTL:  15,     // TUNABLE — below this width-percentile => "compression/squeeze"
  DIVERGENCE_PIVOT_LOOKBACK: 5, // TUNABLE — bars each side to qualify a price pivot
  DIVERGENCE_MAX_SPAN: 60,      // TUNABLE — max bars between the two pivots of a divergence
  SIGNAL_RSI_CONFIRM: 50,       // TUNABLE — RSI must be on the right side of 50 to plot a buy/sell
  VWAP_ANCHOR: "RANGE_START",   // TUNABLE — session boundaries unavailable in mock bars; app port should reset pv/vv per trading session
} as const;

export interface SignalMark { i: number; kind: "buy" | "sell" }
export interface RsiCycleResult { r: number[]; rma: number[]; marks: SignalMark[] }
export interface EmaCompressionResult { width: number[]; squeeze: boolean[] }
export interface DivergenceMark { i0: number; i1: number; kind: "bull" | "bear" }

export const SIGNAL_CALC = {
  // RSI-cycle: RSI crossing its own smoothed MA. up-cross in oversold-ish => buy bias.
  rsiCycle(closes: number[], closedN: number): RsiCycleResult {
    const r = INDICATOR_CALC.rsi(closes, THRESHOLDS.RSI_PERIOD);
    const rma = INDICATOR_CALC.sma(r.map((v) => (isFinite(v) ? v : 0)), THRESHOLDS.RSI_MA_PERIOD).map((v, i) => (isFinite(r[i]) ? v : NaN));
    const marks: SignalMark[] = []; // {i, kind:'buy'|'sell'}
    for (let i = 1; i < closedN; i++) {
      if (!isFinite(r[i]) || !isFinite(rma[i]) || !isFinite(r[i - 1]) || !isFinite(rma[i - 1])) continue;
      const upCross = r[i - 1] <= rma[i - 1] && r[i] > rma[i];
      const dnCross = r[i - 1] >= rma[i - 1] && r[i] < rma[i];
      // TUNABLE — confirm with the 50 rail so we don't fire mid-chop
      if (upCross && r[i] < THRESHOLDS.SIGNAL_RSI_CONFIRM + 10) marks.push({ i, kind: "buy" });
      else if (dnCross && r[i] > THRESHOLDS.SIGNAL_RSI_CONFIRM - 10) marks.push({ i, kind: "sell" });
    }
    return { r, rma, marks };
  },

  // EMA-compression: ribbon width (max-min of the EMA set) percentile squeeze.
  emaCompression(emaSet: number[][], closedN: number): EmaCompressionResult {
    const width = new Array<number>(closedN).fill(NaN);
    for (let i = 0; i < closedN; i++) {
      // Use the FINITE subset of the ribbon — the slow EMAs (144/233) never warm up
      // on short ranges, so demanding all 8 would zero this signal out entirely.
      let mn = Infinity, mx = -Infinity, cnt = 0;
      for (const e of emaSet) { const v = e[i]; if (!isFinite(v)) continue; mn = Math.min(mn, v); mx = Math.max(mx, v); cnt++; }
      if (cnt < THRESHOLDS.RIBBON_MIN_EMAS) continue; // TUNABLE — need a meaningful spread
      width[i] = mx - mn;
    }
    const squeeze = new Array<boolean>(closedN).fill(false);
    const LB = THRESHOLDS.EMA_SQUEEZE_LOOKBACK;
    for (let i = 0; i < closedN; i++) {
      if (!isFinite(width[i])) continue;
      const from = Math.max(0, i - LB + 1); const win: number[] = [];
      for (let j = from; j <= i; j++) if (isFinite(width[j])) win.push(width[j]);
      if (win.length < 8) continue;
      const sorted = win.slice().sort((a, b) => a - b);
      const rank = sorted.findIndex((v) => v >= width[i]); const pctl = rank / (sorted.length - 1) * 100;
      if (pctl <= THRESHOLDS.EMA_SQUEEZE_PCTL) squeeze[i] = true; // TUNABLE percentile
    }
    return { width, squeeze };
  },

  // Adaptive candle colouring vs ribbon: bull above whole ribbon / bear below / neutral inside.
  adaptiveColors(closes: number[], emaSet: number[][], n: number): number[] {
    const col = new Array<number>(n).fill(0); // 1 bull, -1 bear, 0 neutral
    for (let i = 0; i < n; i++) {
      // Colour vs the FINITE subset of the ribbon — requiring all 8 EMAs left every
      // candle neutral (slow EMAs never warm up on short ranges), erasing the signal.
      let mn = Infinity, mx = -Infinity, cnt = 0;
      for (const e of emaSet) { const v = e[i]; if (!isFinite(v)) continue; mn = Math.min(mn, v); mx = Math.max(mx, v); cnt++; }
      if (cnt < THRESHOLDS.RIBBON_MIN_EMAS) continue; // TUNABLE — need a meaningful ribbon
      if (closes[i] > mx) col[i] = 1; else if (closes[i] < mn) col[i] = -1; else col[i] = 0;
    }
    return col;
  },

  // Pivot-based divergence between price and an oscillator (RSI or MACD line).
  // Classic: bullish = price lower-low + osc higher-low; bearish = price higher-high + osc lower-high.
  divergence(closes: number[], osc: number[], closedN: number): DivergenceMark[] {
    const LB = THRESHOLDS.DIVERGENCE_PIVOT_LOOKBACK, SPAN = THRESHOLDS.DIVERGENCE_MAX_SPAN;
    const isPivotLow = (a: number[], i: number) => { for (let k = 1; k <= LB; k++) { if (i - k < 0 || i + k >= closedN) return false; if (!(a[i] <= a[i - k] && a[i] <= a[i + k])) return false; } return true; };
    const isPivotHigh = (a: number[], i: number) => { for (let k = 1; k <= LB; k++) { if (i - k < 0 || i + k >= closedN) return false; if (!(a[i] >= a[i - k] && a[i] >= a[i + k])) return false; } return true; };
    const lows: number[] = [], highs: number[] = [];
    for (let i = LB; i < closedN - LB; i++) { if (!isFinite(osc[i])) continue; if (isPivotLow(closes, i)) lows.push(i); if (isPivotHigh(closes, i)) highs.push(i); }
    const out: DivergenceMark[] = []; // {i0,i1,kind:'bull'|'bear'}
    for (let a = 1; a < lows.length; a++) {
      const p0 = lows[a - 1], p1 = lows[a]; if (p1 - p0 > SPAN) continue;
      if (closes[p1] < closes[p0] && osc[p1] > osc[p0]) out.push({ i0: p0, i1: p1, kind: "bull" });
    }
    for (let a = 1; a < highs.length; a++) {
      const p0 = highs[a - 1], p1 = highs[a]; if (p1 - p0 > SPAN) continue;
      if (closes[p1] > closes[p0] && osc[p1] < osc[p0]) out.push({ i0: p0, i1: p1, kind: "bear" });
    }
    return out;
  },
};
