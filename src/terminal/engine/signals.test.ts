/* =========================================================================
   SIGNAL ENGINES — finite-ribbon-subset behaviour + the NON-REPAINTING
   invariant: with closedN frozen, wiggling the live-forming last bar must
   never add/move/remove a historical signal.
   ========================================================================= */
import { describe, it, expect } from "vitest";
import { THRESHOLDS, SIGNAL_CALC } from "./signals";
import { INDICATOR_CALC } from "./indicators";
import { DataEngine } from "./dataEngine";
import { mulberry32 } from "./prng";

function walk(n: number, seed = 5, base = 100, vol = 0.02): number[] {
  const rng = mulberry32(seed); const out: number[] = []; let p = base;
  for (let i = 0; i < n; i++) { p *= 1 + (rng() - 0.5) * vol * 2; out.push(p); }
  return out;
}
const ribbon = (c: number[]) => THRESHOLDS.EMA_PERIODS.map((p) => INDICATOR_CALC.ema(c, p));

// module-scope init: the describe bodies below read the seeded world at
// collection time (before any beforeAll hook would run)
DataEngine.init();

describe("finite-ribbon subset (wave-1 fix)", () => {
  // 160 bars: the 233-EMA NEVER warms up, so a whole-ribbon requirement would
  // blank both signals. The finite-subset logic must still fire.
  const closes = DataEngine.get("NVDA").hist["1M"].slice();
  const emaSet = ribbon(closes);
  const closedN = closes.length - 1;

  it("adaptiveColors emits non-neutral verdicts despite the un-warmed 233-EMA", () => {
    expect(emaSet[emaSet.length - 1].every((v) => !isFinite(v))).toBe(true); // 233 truly never warms
    const col = SIGNAL_CALC.adaptiveColors(closes, emaSet, closes.length);
    expect(col.some((v) => v !== 0)).toBe(true);
    // and before RIBBON_MIN_EMAS EMAs are finite (i < 33), everything stays neutral
    for (let i = 0; i < THRESHOLDS.EMA_PERIODS[3] - 1; i++) expect(col[i]).toBe(0);
  });

  it("emaCompression computes finite widths on the finite subset", () => {
    const { width, squeeze } = SIGNAL_CALC.emaCompression(emaSet, closedN);
    expect(width.length).toBe(closedN);
    expect(squeeze.length).toBe(closedN);
    expect(width.some(isFinite)).toBe(true);
    // width is only defined once >= RIBBON_MIN_EMAS EMAs are finite
    for (let i = 0; i < THRESHOLDS.EMA_PERIODS[3] - 1; i++) expect(width[i]).toBeNaN();
  });
});

describe("NON-REPAINTING: signals identical across ticks within a candle", () => {
  const base = walk(160, 31);
  const closedN = base.length - 1;
  // two snapshots of the same candle: only the live-forming LAST bar differs
  const tickA = base.slice(); tickA[159] = base[159] * 1.02;
  const tickB = base.slice(); tickB[159] = base[159] * 0.97;

  it("rsiCycle marks are frozen", () => {
    const a = SIGNAL_CALC.rsiCycle(tickA, closedN);
    const b = SIGNAL_CALC.rsiCycle(tickB, closedN);
    expect(a.marks).toEqual(b.marks);
    expect(a.marks.every((m) => m.i < closedN)).toBe(true); // never on the live bar
  });

  it("divergence marks are frozen", () => {
    const rsiA = INDICATOR_CALC.rsi(tickA, THRESHOLDS.RSI_PERIOD);
    const rsiB = INDICATOR_CALC.rsi(tickB, THRESHOLDS.RSI_PERIOD);
    const a = SIGNAL_CALC.divergence(tickA, rsiA, closedN);
    const b = SIGNAL_CALC.divergence(tickB, rsiB, closedN);
    expect(a).toEqual(b);
    expect(a.every((d) => d.i1 < closedN)).toBe(true);
  });

  it("emaCompression squeeze flags are frozen", () => {
    const a = SIGNAL_CALC.emaCompression(ribbon(tickA), closedN);
    const b = SIGNAL_CALC.emaCompression(ribbon(tickB), closedN);
    expect(a.squeeze).toEqual(b.squeeze);
    expect(a.width).toEqual(b.width);
  });
});

describe("rsiCycle mechanics", () => {
  it("marks carry the 50-rail confirmation bands", () => {
    const closes = walk(300, 77, 100, 0.04);
    const { r, rma, marks } = SIGNAL_CALC.rsiCycle(closes, closes.length - 1);
    expect(r.length).toBe(closes.length);
    expect(rma.length).toBe(closes.length);
    for (const m of marks) {
      if (m.kind === "buy") expect(r[m.i]).toBeLessThan(THRESHOLDS.SIGNAL_RSI_CONFIRM + 10);
      else expect(r[m.i]).toBeGreaterThan(THRESHOLDS.SIGNAL_RSI_CONFIRM - 10);
    }
  });
});
