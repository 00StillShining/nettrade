/* =========================================================================
   INDICATOR MATH — hand-checked expectations on tiny known inputs, plus the
   wave-1 review-fix invariants (StochRSI re-mask, MACD finite-seed) that the
   brief requires to stay intact.
   ========================================================================= */
import { describe, it, expect } from "vitest";
import { INDICATOR_CALC, lttb, type Pt } from "./indicators";
import { mulberry32 } from "./prng";

// deterministic pseudo-random walk for the warm-up/window tests
function walk(n: number, seed = 42, base = 100, vol = 0.02): number[] {
  const rng = mulberry32(seed); const out: number[] = []; let p = base;
  for (let i = 0; i < n; i++) { p *= 1 + (rng() - 0.5) * vol * 2; out.push(p); }
  return out;
}

describe("INDICATOR_CALC hand-checked math", () => {
  it("sma: [1,2,3,4,5] period 3 -> [NaN,NaN,2,3,4]", () => {
    const r = INDICATOR_CALC.sma([1, 2, 3, 4, 5], 3);
    expect(r[0]).toBeNaN(); expect(r[1]).toBeNaN();
    expect(r[2]).toBe(2); expect(r[3]).toBe(3); expect(r[4]).toBe(4);
  });

  it("ema: [2,4,6,8] period 2 seeds with SMA then smooths -> [NaN,3,5,7]", () => {
    const r = INDICATOR_CALC.ema([2, 4, 6, 8], 2);
    expect(r[0]).toBeNaN();
    expect(r[1]).toBe(3);              // SMA seed of first 2
    expect(r[2]).toBeCloseTo(5, 12);   // 6*(2/3) + 3*(1/3)
    expect(r[3]).toBeCloseTo(7, 12);   // 8*(2/3) + 5*(1/3)
  });

  it("stdev: [1,2,3,4] period 2 -> population stdev 0.5 each window", () => {
    const r = INDICATOR_CALC.stdev([1, 2, 3, 4], 2);
    expect(r[0]).toBeNaN();
    expect(r[1]).toBeCloseTo(0.5, 12); expect(r[2]).toBeCloseTo(0.5, 12); expect(r[3]).toBeCloseTo(0.5, 12);
  });

  it("bollinger on a constant series collapses every band onto the mid", () => {
    const c = new Array(30).fill(50);
    const bb = INDICATOR_CALC.bollinger(c, 20, 1, 2);
    expect(bb.mid[29]).toBe(50);
    expect(bb.upIn[29]).toBe(50); expect(bb.dnIn[29]).toBe(50);
    expect(bb.upOut[29]).toBe(50); expect(bb.dnOut[29]).toBe(50);
  });

  it("trueRange: first bar is h-l; later bars respect prior close gaps", () => {
    const h = [10, 12], l = [8, 11], c = [9, 11.5];
    const tr = INDICATOR_CALC.trueRange(h, l, c);
    expect(tr[0]).toBe(2);            // 10-8
    // max(12-11, |12-9|, |11-9|) = 3 (gap vs prior close dominates)
    expect(tr[1]).toBe(3);
  });

  it("rsi: monotonically rising closes read 100 after warm-up, NaN before", () => {
    const c = Array.from({ length: 20 }, (_, i) => 100 + i);
    const r = INDICATOR_CALC.rsi(c, 14);
    for (let i = 0; i < 14; i++) expect(r[i]).toBeNaN();
    for (let i = 14; i < 20; i++) expect(r[i]).toBe(100); // avgL === 0 branch
  });

  it("vwap: with h=l=c it is the cumulative volume-weighted mean", () => {
    const c = [10, 20], v = [1, 1];
    const r = INDICATOR_CALC.vwap(c, c, c, v);
    expect(r[0]).toBe(10); expect(r[1]).toBe(15);
  });

  it("atr warm-up: NaN until period-1, Wilder-smoothed after", () => {
    const n = 30; const c = walk(n, 7);
    const h = c.map((x) => x * 1.01), l = c.map((x) => x * 0.99);
    const a = INDICATOR_CALC.atr(h, l, c, 14);
    for (let i = 0; i < 13; i++) expect(a[i]).toBeNaN();
    for (let i = 13; i < n; i++) expect(isFinite(a[i])).toBe(true);
  });

  it("superTrend emits ±1 direction once ATR warms up", () => {
    const n = 60; const c = walk(n, 9);
    const h = c.map((x) => x * 1.01), l = c.map((x) => x * 0.99);
    const st = INDICATOR_CALC.superTrend(h, l, c, 10, 3);
    expect(st.dir[5]).toBeNaN(); // pre-ATR
    for (let i = 10; i < n; i++) {
      expect(Math.abs(st.dir[i])).toBe(1);
      expect(isFinite(st.line[i])).toBe(true);
    }
  });
});

describe("wave-1 review fixes stay intact", () => {
  it("StochRSI: finite K and D after warm-up on 120 bars, re-masked NaN before", () => {
    const c = walk(120, 13);
    const { k, d } = INDICATOR_CALC.stochRsi(c, 14, 14, 3, 3);
    // warm-ups re-masked: k before rsiP+stochP+kP-1 (=30), d before +dP-1 more (=32)
    for (let i = 0; i < 30; i++) expect(k[i]).toBeNaN();
    for (let i = 0; i < 32; i++) expect(d[i]).toBeNaN();
    for (let i = 32; i < 120; i++) {
      expect(isFinite(k[i])).toBe(true);
      expect(isFinite(d[i])).toBe(true);
      expect(k[i]).toBeGreaterThanOrEqual(0); expect(k[i]).toBeLessThanOrEqual(100);
      expect(d[i]).toBeGreaterThanOrEqual(0); expect(d[i]).toBeLessThanOrEqual(100);
    }
  });

  it("MACD: signal is NaN before its finite seed (never fabricated over the warm-up)", () => {
    const c = walk(60, 21);
    const { macd, signal, hist } = INDICATOR_CALC.macd(c, 12, 26, 9);
    const s0 = macd.findIndex(isFinite);
    expect(s0).toBe(25); // slow-26 EMA warms at index 25
    const sigStart = s0 + 8; // 9-EMA of the finite macd region seeds at its own index 8
    for (let i = 0; i < sigStart; i++) { expect(signal[i]).toBeNaN(); expect(hist[i]).toBeNaN(); }
    for (let i = sigStart; i < 60; i++) {
      expect(isFinite(signal[i])).toBe(true);
      expect(hist[i]).toBeCloseTo(macd[i] - signal[i], 12);
    }
  });
});

describe("lttb downsample", () => {
  const pts: Pt[] = Array.from({ length: 100 }, (_, i) => ({ x: i, y: Math.sin(i / 7) * 50 }));
  it("passes through when threshold >= n or 0", () => {
    expect(lttb(pts, 100)).toBe(pts);
    expect(lttb(pts, 500)).toBe(pts);
    expect(lttb(pts, 0)).toBe(pts);
  });
  it("keeps exactly `threshold` points including the first and last", () => {
    const out = lttb(pts, 20);
    expect(out.length).toBe(20);
    expect(out[0]).toBe(pts[0]);
    expect(out[out.length - 1]).toBe(pts[pts.length - 1]);
    // monotone x (order preserved)
    for (let i = 1; i < out.length; i++) expect(out[i].x).toBeGreaterThan(out[i - 1].x);
  });
});
