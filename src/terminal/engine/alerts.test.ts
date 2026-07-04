/* =========================================================================
   ALERTS — IBD distribution-day tape classification, FTD state machine, and
   the watch LATCH (ARMED->TRIGGERED once, jitter can never re-arm).
   ========================================================================= */
import { describe, it, expect, beforeAll } from "vitest";
import { DataEngine } from "./dataEngine";
import type { Bar } from "./ohlc";
import {
  ALERT_TH, ibdDistribution, ibdRiskBand, ibdCombine, IBD_EXPOSURE,
  ftdState, computeRegime, evaluateWatches, alertPredicate, alertWatchNow,
  type Watch, type RiskBand,
} from "./alerts";

beforeAll(() => { DataEngine.init(); });

/* flat synthetic tape: h=l=c so nothing ever trips the +5% high invalidation */
function flatTape(n: number, close = 100, vol = 100): Bar[] {
  return Array.from({ length: n }, () => ({ o: close, h: close, l: close, c: close, v: vol }));
}
/* stamp a Distribution Day at index k: -1% close on higher volume, next bar recovers */
function stampDD(bars: Bar[], k: number): void {
  const prev = bars[k - 1].c;
  const c = prev * 0.99; // -1% <= -0.2% decline
  bars[k] = { o: prev, h: c, l: c, c, v: bars[k - 1].v + 50 };
  // recovery bar keeps the tape level without a +5% high (100 < 99*1.05)
  if (k + 1 < bars.length) bars[k + 1] = { o: c, h: prev, l: c, c: prev, v: bars[k - 1].v };
}

describe("ibdDistribution — synthetic tape with a KNOWN DD count", () => {
  it("clean tape counts zero and classifies NORMAL", () => {
    const bars = flatTape(40);
    const dd = ibdDistribution(bars);
    expect(dd.d25).toBe(0);
    const { band } = ibdRiskBand(dd, bars.map((b) => b.c));
    expect(band).toBe("NORMAL");
  });

  it("3 aged DDs (ages 16/18/20) -> d25=3, d15=0, d5=0 -> CAUTION", () => {
    const bars = flatTape(40);
    stampDD(bars, 19); stampDD(bars, 21); stampDD(bars, 23); // ages 20 / 18 / 16
    const dd = ibdDistribution(bars);
    expect(dd.d5).toBe(0); expect(dd.d15).toBe(0); expect(dd.d25).toBe(3);
    expect(ibdRiskBand(dd, bars.map((b) => b.c)).band).toBe("CAUTION");
  });

  it("2 recent DDs (ages <=5) trip d5>=2 -> HIGH", () => {
    const bars = flatTape(40);
    stampDD(bars, 35); stampDD(bars, 37); // ages 4 / 2
    const dd = ibdDistribution(bars);
    expect(dd.d5).toBe(2);
    expect(ibdRiskBand(dd, bars.map((b) => b.c)).band).toBe("HIGH");
  });

  it("a DD older than 25 sessions expires by age", () => {
    const bars = flatTape(40);
    stampDD(bars, 10); // age = 39-10 = 29 > 25
    expect(ibdDistribution(bars).d25).toBe(0);
  });

  it("a +5% post-DD high invalidates the record", () => {
    const bars = flatTape(40);
    stampDD(bars, 30);                       // DD close = 99
    bars[34] = { o: 100, h: 99 * 1.06, l: 100, c: 100, v: 100 }; // high >= 99*1.05
    expect(ibdDistribution(bars).d25).toBe(0);
  });
});

describe("ibdCombine — NDX-weighted dual-index rules", () => {
  const cases: [RiskBand, RiskBand, RiskBand][] = [
    ["SEVERE", "NORMAL", "SEVERE"],
    ["NORMAL", "SEVERE", "SEVERE"],
    ["HIGH", "NORMAL", "HIGH"],
    ["NORMAL", "HIGH", "HIGH"],
    ["CAUTION", "CAUTION", "HIGH"], // caution on both -> escalate
    ["CAUTION", "NORMAL", "CAUTION"],
    ["NORMAL", "CAUTION", "CAUTION"],
    ["NORMAL", "NORMAL", "NORMAL"],
  ];
  it.each(cases)("ndx=%s spy=%s -> %s", (ndx, spy, want) => {
    expect(ibdCombine(ndx, spy)).toBe(want);
  });
  it("exposure policy maps every band", () => {
    expect(IBD_EXPOSURE.NORMAL.ceiling).toBe(100);
    expect(IBD_EXPOSURE.SEVERE.ceiling).toBe(50);
  });
});

describe("ftdState — rally state machine", () => {
  it("insufficient history reads NO SIGNAL", () => {
    expect(ftdState(flatTape(5)).state).toBe("NO SIGNAL");
  });

  it("a steady uptrend reads NO SIGNAL / MARKET IN UPTREND", () => {
    const bars: Bar[] = Array.from({ length: 60 }, (_, i) => {
      const c = 80 + i * 0.5; return { o: c, h: c + 0.5, l: c - 0.5, c, v: 100 };
    });
    const r = ftdState(bars);
    expect(r.state).toBe("NO SIGNAL");
    expect(r.hint).toContain("UPTREND");
  });

  it("correction -> rally attempt -> Day-4 +1.57% on higher vol => FTD CONFIRMED", () => {
    const closes: number[] = [];
    for (let i = 0; i < 20; i++) closes.push(80 + i * (20 / 19));            // rise to 100
    closes.push(99, 98, 97, 96, 95);                                          // 5 down days, -5% (>=3%, >=3 down)
    closes.push(95.5, 95.6, 95.7);                                            // Day 1..3 (rally attempt)
    closes.push(97.2);                                                        // Day 4: +1.567% (>= FTD_GAIN_REC)
    closes.push(97.3, 97.4, 97.5);                                            // holds above the FTD-day low
    const bars: Bar[] = closes.map((c, i) => ({
      o: c, h: c + 0.5, l: c - 0.5, c,
      v: i === 28 ? 150 : 100,                                                // higher volume ON the FTD day only
    }));
    const r = ftdState(bars);
    expect(r.state).toBe("FTD CONFIRMED");
    expect(r.day).toBe(4);
    expect(r.level).toBe("ok");
    expect(r.hint).toContain("RECOMMENDED");
    expect(r.lowLvl).toBe(94.5);         // swing-low bar's low (95 - 0.5)
    expect(r.ftdLvl).toBe(97.2 - 0.5);   // FTD day's low becomes the watch level
    expect(ALERT_TH.FTD_GAIN_REC).toBe(1.5);
  });
});

describe("computeRegime — seed-77 world is deterministic", () => {
  it("returns the same verdict on repeated computes (settled, non-repainting)", () => {
    const a = computeRegime();
    const b = computeRegime();
    expect(b.band).toBe(a.band);
    expect(b.spyDD.d25).toBe(a.spyDD.d25);
    expect(b.ndxDD.d25).toBe(a.ndxDD.d25);
    expect(b.ftd.state).toBe(a.ftd.state);
    expect(["NORMAL", "CAUTION", "HIGH", "SEVERE"]).toContain(a.band);
  });
});

describe("watch latching", () => {
  const mk = (sym: string, op: ">" | "<", level: number): Watch =>
    ({ id: 1, sym, metric: "PRICE", op, level, state: "ARMED", firedAt: null, now: null });

  it("ARMED -> TRIGGERED on first cross; jitter can never re-arm", () => {
    const flags: Record<string, boolean> = {};
    const w = mk("NVDA", ">", 1); // trivially crossed (price ~126)
    const changed = evaluateWatches([w], (sym, on) => { flags[sym] = on; });
    expect(changed).toBe(true);
    expect(w.state).toBe("TRIGGERED");
    expect(w.firedAt).toMatch(/^\d{2}:\d{2}$/);
    expect(flags["NVDA"]).toBe(true);
    // simulate a jitter tick that no longer satisfies the predicate
    w.level = 1e9;
    const changed2 = evaluateWatches([w], (sym, on) => { flags[sym] = on; });
    expect(changed2).toBe(false);        // latched — nothing changed
    expect(w.state).toBe("TRIGGERED");   // it does NOT re-arm
  });

  it("an uncrossed watch stays ARMED with a live NOW readout", () => {
    const w = mk("NVDA", ">", 1e9);
    const changed = evaluateWatches([w], () => { throw new Error("must not flag"); });
    expect(changed).toBe(false);
    expect(w.state).toBe("ARMED");
    expect(w.now).toBe(DataEngine.get("NVDA").last);
  });

  it("alertWatchNow RSI reads CLOSED bars only and alertPredicate handles null", () => {
    const w: Watch = { id: 9, sym: "NVDA", metric: "RSI", op: "<", level: 30, state: "ARMED", firedAt: null, now: null };
    const now = alertWatchNow(w);
    expect(now === null || (now >= 0 && now <= 100)).toBe(true);
    expect(alertPredicate(null, ">", 0)).toBe(false);
  });
});
