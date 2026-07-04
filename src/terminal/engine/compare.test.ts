/* =========================================================================
   COMPARE — settled-verdict determinism, crypto fallbacks, synthetic slots.
   ========================================================================= */
import { describe, it, expect, beforeAll } from "vitest";
import { DataEngine } from "./dataEngine";
import {
  COMPARE_CALC, CMP_AXES, CMP_COLORS, cmpProfile, cmpQuote, cmpIsRoster,
  cmpResolveSym, cmpBuildOverlay,
} from "./compare";

beforeAll(() => { DataEngine.init(); });

describe("COMPARE_CALC.metrics", () => {
  it("is deterministic (a settled verdict, never tick-jittered)", () => {
    const a = COMPARE_CALC.metrics("NVDA");
    const b = COMPARE_CALC.metrics("NVDA");
    expect(b.axes).toEqual(a.axes);
    expect(b.composite).toBe(a.composite);
    expect(b.verdict).toBe(a.verdict);
  });

  it("axes are 1..5 integers and composite is their mean", () => {
    for (const sym of ["NVDA", "AAPL", "SPY", "GME"]) {
      const m = COMPARE_CALC.metrics(sym);
      let sum = 0;
      for (const ax of CMP_AXES) {
        const v = m.axes[ax];
        expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(5);
        expect(Number.isInteger(v)).toBe(true);
        sum += v;
      }
      expect(m.composite).toBeCloseTo(sum / 5, 12);
    }
  });

  it("crypto (BTC-USD) engages the neutral fallbacks: VAL 3 / FCF 3 / PROF 3, moat 3, N/A rows", () => {
    const m = COMPARE_CALC.metrics("BTC-USD");
    expect(m.crypto).toBe(true);
    expect(m.axes.VALUATION).toBe(3);
    expect(m.axes.FCF).toBe(3);
    expect(m.axes.PROFITABILITY).toBe(3);
    expect(m.axes.MOAT).toBe(3);
    expect(m.rows.peg.txt).toBe("N/A");
    expect(m.rows.fcfYield.txt).toBe("N/A");
    expect(m.mos).toBe(0);
  });

  it("verdict gate follows the composite/MoS cutoffs", () => {
    for (const sym of ["NVDA", "AAPL", "SPY", "TSLA", "BTC-USD"]) {
      const m = COMPARE_CALC.metrics(sym);
      if (m.verdict === "STRONG BUY") { expect(m.composite).toBeGreaterThanOrEqual(4.5); expect(m.mos).toBeGreaterThan(20); }
      else if (m.verdict === "BUY") { expect(m.composite).toBeGreaterThanOrEqual(4.0); expect(m.mos).toBeGreaterThan(10); }
      else if (m.verdict === "HOLD") expect(m.composite).toBeGreaterThanOrEqual(3.5);
      else expect(m.composite).toBeLessThan(3.5);
    }
  });
});

describe("synthetic (typed, non-roster) slots never crash", () => {
  it("cmpResolveSym maps short crypto tickers onto roster keys, unknowns pass through", () => {
    expect(cmpResolveSym("BTC")).toBe("BTC-USD");
    expect(cmpResolveSym("NVDA")).toBe("NVDA");
    expect(cmpResolveSym("ZZTOP")).toBe("ZZTOP");
    expect(cmpResolveSym("WAYTOOLONGSYM")).toBe("WAYTOOLON"); // bounded to input maxlength 9
  });

  it("an unknown ticker gets a deterministic synthetic profile + quote + metrics", () => {
    expect(cmpIsRoster("ZZTOP")).toBe(false);
    const p = cmpProfile("ZZTOP");
    expect(p.synthetic).toBe(true);
    expect(p.sector).toBe("_DEFAULT");
    expect(p.pe).toBeNaN();           // -> crypto-style valuation fallback engages
    const q = cmpQuote("ZZTOP");
    expect(q.hist["1M"].length).toBe(160);
    expect(cmpQuote("ZZTOP")).toBe(q); // cached — the same object every read
    const m = COMPARE_CALC.metrics("ZZTOP");
    expect(m.crypto).toBe(true);      // pe=NaN routes through the safe path
    expect(isFinite(m.composite)).toBe(true);
  });
});

describe("cmpBuildOverlay — shared base-100 domain", () => {
  it("normalises every series to 100 at bar 0 and spans a shared min/max", () => {
    const ov = cmpBuildOverlay(["NVDA", "BTC-USD", null], "1M");
    expect(ov.series.length).toBe(2);
    for (const s of ov.series) {
      expect(s.norm[0]).toBeCloseTo(100, 9);
      expect(s.endPct).toBeCloseTo(s.norm[s.norm.length - 1] - 100, 9);
      for (const v of s.norm) { expect(v).toBeGreaterThanOrEqual(ov.min); expect(v).toBeLessThanOrEqual(ov.max); }
    }
    expect(ov.max - ov.min).toBeGreaterThanOrEqual(0.5); // flat-domain guard
    expect(CMP_COLORS.length).toBe(3);                   // one neutral colour per slot
  });

  it("empty slots produce an empty overlay without throwing", () => {
    const ov = cmpBuildOverlay([null, null, null], "1D");
    expect(ov.series).toEqual([]);
  });
});
