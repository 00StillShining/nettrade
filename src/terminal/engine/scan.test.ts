/* =========================================================================
   SCANNER — fail-conservative + N/A discipline over the seed-77 world.
   ========================================================================= */
import { describe, it, expect, beforeAll } from "vitest";
import { DataEngine, DEFAULT_ROSTER } from "./dataEngine";
import { SCAN_CALC, SCAN_PRESETS, SCAN_METHOD, scanCountFor } from "./scan";

beforeAll(() => { DataEngine.init(); });

describe("VCP fails conservative at 160 bars", () => {
  it("no roster symbol can match VCP (SMA200/rising-200 criteria are unverifiable)", () => {
    // hist['1M'] = 160 bars -> 159 closed. sma200 is NaN and c3 is hard-false, so the
    // trend template can reach at most 4 of 7 (57.2 < 85) -> matched must be false for
    // EVERY symbol. This is the "mathematically unreachable — dead heroes" property the
    // prototype documents; a silently-passing SMA criterion would break it.
    for (const sym of DEFAULT_ROSTER) {
      const r = SCAN_CALC.vcp(sym);
      expect(r.matched).toBe(false);
      expect(isFinite(r.score)).toBe(true); // still scored (shown dimmed), never hidden
      expect(r.flag).toBe("VCP");
    }
  });
});

describe("crypto N/A discipline (never zero-scored)", () => {
  it.each(["BTC-USD", "ETH-USD"])("%s reads N/A on CANSLIM and DIVPULL", (sym) => {
    const c = SCAN_CALC.canslim(sym);
    expect(c.na).toBe(true);
    expect(c.score).toBeNaN();       // NaN, NOT 0 — statusChip renders the dashed chip
    expect(c.matched).toBe(false);
    const d = SCAN_CALC.divpull(sym);
    expect(d.na).toBe(true);
    expect(d.score).toBeNaN();
    expect(d.matched).toBe(false);
  });

  it("zero-div equities (TSLA) also read N/A on DIVPULL", () => {
    const d = SCAN_CALC.divpull("TSLA");
    expect(d.na).toBe(true);
  });

  it("BURST/VCP still evaluate crypto (price-only screeners)", () => {
    const b = SCAN_CALC.burst("BTC-USD");
    expect(isFinite(b.score)).toBe(true);
    expect(b.na).toBeUndefined();
  });
});

describe("ALL dispatch + determinism", () => {
  it("run('ALL') returns a finite best-of verdict for every roster symbol", () => {
    for (const sym of DEFAULT_ROSTER) {
      const r = SCAN_CALC.run("ALL", sym);
      expect(isFinite(r.score)).toBe(true);
      expect(typeof r.grade).toBe("string");
      expect(["ok", "warn", "high"]).toContain(r.level);
    }
  });

  it("scores are deterministic across repeated runs (memo-safe, non-repainting)", () => {
    const first = DEFAULT_ROSTER.map((s) => SCAN_CALC.run("ALL", s).score);
    const second = DEFAULT_ROSTER.map((s) => SCAN_CALC.run("ALL", s).score);
    expect(second).toEqual(first);
  });

  it("scanCountFor never exceeds the roster and matches per-symbol truth", () => {
    for (const p of SCAN_PRESETS) {
      const n = scanCountFor(p.key);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(DEFAULT_ROSTER.length);
      const manual = DEFAULT_ROSTER.filter((s) => SCAN_CALC.run(p.key, s).matched).length;
      expect(n).toBe(manual);
    }
  });

  it("every preset ships its honest method one-liner", () => {
    for (const p of SCAN_PRESETS) expect(SCAN_METHOD[p.key]).toBeTruthy();
  });
});
