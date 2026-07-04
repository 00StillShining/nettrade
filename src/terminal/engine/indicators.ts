/* =========================================================================
   TERMINAL 77 — INDICATOR MATH (ported verbatim from prototypes/terminal-77)

   INDICATOR_CALC: pure math (no DOM, no canvas). All inputs are arrays.
   Every function returns arrays aligned to the input length; the warm-up
   region is filled with NaN so renderers can skip it honestly (no fabricated
   early values).

   The wave-1 review fixes are INTACT and load-bearing:
   • StochRSI zero-fills the raw warm-up for the rolling-sum SMA, then
     RE-MASKS each smoothing's own warm-up (sma() would otherwise
     NaN-poison forever).
   • MACD's signal EMA is seeded on the macd line's FINITE region ONLY —
     never over the NaN warm-up (which would fabricate signal/hist before a
     9-EMA exists).
   • VWAP is anchored-from-range-start, NOT session VWAP — see the note on
     vwap() and THRESHOLDS.VWAP_ANCHOR in signals.ts.
   ========================================================================= */

export interface BollingerBands { mid: number[]; upIn: number[]; dnIn: number[]; upOut: number[]; dnOut: number[] }
export interface SuperTrendResult { line: number[]; dir: number[] } // dir: +1 up / -1 down (NaN warm-up)
export interface StochRsiResult { k: number[]; d: number[] }
export interface MacdResult { macd: number[]; signal: number[]; hist: number[] }

export const INDICATOR_CALC = {
  ema(vals: number[], period: number): number[] {
    const out = new Array<number>(vals.length).fill(NaN);
    const k = 2 / (period + 1); let prev: number | undefined;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i]; if (!isFinite(v)) continue;
      if (prev === undefined) {
        // seed with SMA of the first `period` values
        if (i >= period - 1) { let s = 0, c = 0; for (let j = i - period + 1; j <= i; j++) { s += vals[j]; c++; } prev = s / c; out[i] = prev; }
      } else { prev = v * k + prev * (1 - k); out[i] = prev; }
    }
    return out;
  },
  sma(vals: number[], period: number): number[] {
    const out = new Array<number>(vals.length).fill(NaN); let s = 0;
    for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= period) s -= vals[i - period]; if (i >= period - 1) out[i] = s / period; }
    return out;
  },
  stdev(vals: number[], period: number): number[] {
    const out = new Array<number>(vals.length).fill(NaN);
    for (let i = period - 1; i < vals.length; i++) {
      let m = 0; for (let j = i - period + 1; j <= i; j++) m += vals[j]; m /= period;
      let v = 0; for (let j = i - period + 1; j <= i; j++) { const d = vals[j] - m; v += d * d; } out[i] = Math.sqrt(v / period);
    }
    return out;
  },
  // Dual Bollinger: returns {mid, upIn, dnIn, upOut, dnOut}
  bollinger(closes: number[], period: number, sIn: number, sOut: number): BollingerBands {
    const mid = this.sma(closes, period), sd = this.stdev(closes, period);
    const upIn: number[] = [], dnIn: number[] = [], upOut: number[] = [], dnOut: number[] = [];
    for (let i = 0; i < closes.length; i++) {
      upIn[i] = mid[i] + sIn * sd[i]; dnIn[i] = mid[i] - sIn * sd[i];
      upOut[i] = mid[i] + sOut * sd[i]; dnOut[i] = mid[i] - sOut * sd[i];
    }
    return { mid, upIn, dnIn, upOut, dnOut };
  },
  // True Range series
  trueRange(h: number[], l: number[], c: number[]): number[] {
    const out = new Array<number>(c.length).fill(NaN);
    for (let i = 0; i < c.length; i++) {
      if (i === 0) { out[i] = h[i] - l[i]; continue; }
      out[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    }
    return out;
  },
  // Wilder-smoothed ATR
  atr(h: number[], l: number[], c: number[], period: number): number[] {
    const tr = this.trueRange(h, l, c); const out = new Array<number>(c.length).fill(NaN);
    let prev: number | undefined;
    for (let i = 0; i < c.length; i++) {
      if (i < period - 1) continue;
      if (prev === undefined) { let s = 0; for (let j = 0; j < period; j++) s += tr[j]; prev = s / period; out[i] = prev; }
      else { prev = (prev * (period - 1) + tr[i]) / period; out[i] = prev; }
    }
    return out;
  },
  // SuperTrend (ATR bands, direction flips). Returns {line, dir[]} dir: +1 up / -1 down
  superTrend(h: number[], l: number[], c: number[], period: number, mult: number): SuperTrendResult {
    const atr = this.atr(h, l, c, period); const n = c.length;
    const line = new Array<number>(n).fill(NaN); const dir = new Array<number>(n).fill(NaN);
    let finalUp = NaN, finalDn = NaN, prevDir = 1;
    for (let i = 0; i < n; i++) {
      if (!isFinite(atr[i])) { continue; }
      const mid = (h[i] + l[i]) / 2;
      const basicUp = mid + mult * atr[i], basicDn = mid - mult * atr[i];
      finalUp = (isFinite(finalUp) && (basicUp < finalUp || c[i - 1] > finalUp)) ? basicUp : (isFinite(finalUp) ? finalUp : basicUp);
      finalDn = (isFinite(finalDn) && (basicDn > finalDn || c[i - 1] < finalDn)) ? basicDn : (isFinite(finalDn) ? finalDn : basicDn);
      // decide direction
      if (!isFinite(dir[i - 1])) prevDir = 1;
      if (c[i] > finalUp) prevDir = 1; else if (c[i] < finalDn) prevDir = -1;
      dir[i] = prevDir;
      line[i] = prevDir === 1 ? finalDn : finalUp;
    }
    return { line, dir };
  },
  // Wilder RSI
  rsi(closes: number[], period: number): number[] {
    const n = closes.length; const out = new Array<number>(n).fill(NaN);
    let avgG: number | undefined, avgL: number | undefined;
    for (let i = 1; i < n; i++) {
      const ch = closes[i] - closes[i - 1]; const g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i < period) { continue; }
      if (avgG === undefined || avgL === undefined) {
        let sg = 0, sl = 0; for (let j = 1; j <= period; j++) { const d = closes[j] - closes[j - 1]; sg += Math.max(d, 0); sl += Math.max(-d, 0); }
        avgG = sg / period; avgL = sl / period;
      } else { avgG = (avgG * (period - 1) + g) / period; avgL = (avgL * (period - 1) + l) / period; }
      const rs = avgL === 0 ? 100 : avgG / avgL;
      out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + rs);
    }
    return out;
  },
  // Stochastic RSI -> {k, d}
  stochRsi(closes: number[], rsiP: number, stochP: number, kP: number, dP: number): StochRsiResult {
    const r = this.rsi(closes, rsiP); const n = closes.length;
    const raw = new Array<number>(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (i < rsiP + stochP) continue;
      let lo = Infinity, hi = -Infinity;
      for (let j = i - stochP + 1; j <= i; j++) { if (!isFinite(r[j])) { lo = NaN; break; } lo = Math.min(lo, r[j]); hi = Math.max(hi, r[j]); }
      if (!isFinite(lo)) continue;
      raw[i] = hi === lo ? 0 : (r[i] - lo) / (hi - lo) * 100;
    }
    // sma() runs a rolling sum that NaN-poisons forever off the raw warm-up, so
    // zero-fill the warm-up for the running sum then re-mask each smoothing's own warm-up.
    const k = this.sma(raw.map((v) => (isFinite(v) ? v : 0)), kP).map((v, i) => (i >= rsiP + stochP + kP - 1 ? v : NaN));
    const d = this.sma(k.map((v) => (isFinite(v) ? v : 0)), dP).map((v, i) => (i >= rsiP + stochP + kP + dP - 2 ? v : NaN));
    return { k, d };
  },
  // MACD -> {macd, signal, hist}
  macd(closes: number[], fast: number, slow: number, sig: number): MacdResult {
    const ef = this.ema(closes, fast), es = this.ema(closes, slow);
    const macd = closes.map((_, i) => (isFinite(ef[i]) && isFinite(es[i]) ? ef[i] - es[i] : NaN));
    // signal = EMA of macd seeded on its finite region ONLY (never over the
    // NaN-warm-up zero-fill, which would fabricate signal/hist before a 9-EMA exists).
    const s0 = macd.findIndex(isFinite);
    const sigArr = s0 < 0 ? [] : this.ema(macd.slice(s0), sig);
    const signal = macd.map((_v, i) => (s0 >= 0 && i >= s0 && isFinite(sigArr[i - s0]) ? sigArr[i - s0] : NaN));
    const hist = macd.map((v, i) => (isFinite(v) && isFinite(signal[i]) ? v - signal[i] : NaN));
    return { macd, signal, hist };
  },
  // VWAP (cumulative typical-price * vol / cumulative vol). NOTE: pv/vv never reset,
  // so on 1W/1M/1Y this is anchored-from-range-start, NOT session VWAP — see
  // THRESHOLDS.VWAP_ANCHOR. Defensible: mock bars carry no session boundaries; the
  // app port should reset pv/vv per trading session.
  vwap(h: number[], l: number[], c: number[], vol: number[]): number[] {
    const out = new Array<number>(c.length).fill(NaN); let pv = 0, vv = 0;
    for (let i = 0; i < c.length; i++) { const tp = (h[i] + l[i] + c[i]) / 3; pv += tp * vol[i]; vv += vol[i]; out[i] = vv ? pv / vv : NaN; }
    return out;
  },
};

/* ---- LTTB downsample (Largest-Triangle-Three-Buckets) — extrema-preserving,
        for LINE-form series only. Returns array of {x,y}. ---- */
export interface Pt { x: number; y: number }

export function lttb(points: Pt[], threshold: number): Pt[] {
  const n = points.length;
  if (threshold >= n || threshold === 0) return points;
  const sampled: Pt[] = [points[0]];
  const bucket = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucket) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucket) + 1, n);
    let avgX = 0, avgY = 0; const cnt = rangeEnd - rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) { avgX += points[j].x; avgY += points[j].y; }
    if (cnt > 0) { avgX /= cnt; avgY /= cnt; }
    const rangeOffs = Math.floor(i * bucket) + 1;
    const rangeTo = Math.floor((i + 1) * bucket) + 1;
    const pa = points[a]; let maxArea = -1, next = rangeOffs;
    for (let j = rangeOffs; j < rangeTo; j++) {
      const area = Math.abs((pa.x - avgX) * (points[j].y - pa.y) - (pa.x - points[j].x) * (avgY - pa.y)) * 0.5;
      if (area > maxArea) { maxArea = area; next = j; }
    }
    sampled.push(points[next]); a = next;
  }
  sampled.push(points[n - 1]);
  return sampled;
}
