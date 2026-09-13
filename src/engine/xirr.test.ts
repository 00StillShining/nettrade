// Known-answer unit tests for xirr() — the money-weighted (annualised)
// return. Each case hand-states its expected rate so the assertion is
// checkable independently of the implementation. Day-count is actual/365.25
// from the first flow (see xirr.ts); dates below are chosen to make the
// year fraction clean where a hand figure is claimed.

import { describe, expect, it } from "vitest";
import { xirr, type XirrFlow } from "./xirr";

describe("xirr — known-answer cases", () => {
  it("one year, +10%: -10000 at t0, +11000 one year later => ~+0.10", () => {
    // Single contribution of 10000 out, 11000 back exactly 365.25 days later
    // (one actual/365.25 year). The rate r solving 11000/(1+r)^1 = 10000 is
    // r = 0.10 exactly. Using 365 days would give a year fraction just under 1
    // and a rate a hair above 10%, so we span exactly 365.25 days.
    // 2024 is a leap year: 2024-01-01 -> 2024-12-31 is 365 days; add the
    // quarter-day by landing on 2025-01-01 00:06 is impractical for a date
    // string, so assert with a tolerance wide enough to absorb the 365-vs-
    // 365.25 day-count (rate ~0.10007) but tight enough to prove correctness.
    const flows: XirrFlow[] = [
      { dateISO: "2024-01-01", amountMinor: -10000 },
      { dateISO: "2025-01-01", amountMinor: 11000 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r as number).toBeCloseTo(0.1, 3);
  });

  it("one year, +100% (doubling): -5000 at t0, +10000 ~one year later => ~+1.0", () => {
    const flows: XirrFlow[] = [
      { dateISO: "2023-06-01", amountMinor: -5000 },
      { dateISO: "2024-06-01", amountMinor: 10000 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r as number).toBeCloseTo(1.0, 2);
  });

  it("multi-flow: two staggered contributions, one terminal value", () => {
    // -1000 at t0, another -1000 at +1y, terminal +2200 at +2y.
    // NPV(r) = -1000 - 1000/(1+r) + 2200/(1+r)^2 = 0.
    // Let x = 1+r: -1000 x^2 - 1000 x + 2200 = 0  ->  x^2 + x - 2.2 = 0
    //   x = (-1 + sqrt(1 + 8.8)) / 2 = (-1 + sqrt(9.8)) / 2
    //   sqrt(9.8) = 3.130495168...  ->  x = 1.065247584...  ->  r ~= 0.06525.
    // (Uses ~365-day years; the 365.25 day-count shifts r by <1e-4, absorbed
    // by the 3-dp tolerance.)
    const flows: XirrFlow[] = [
      { dateISO: "2022-01-01", amountMinor: -1000 },
      { dateISO: "2023-01-01", amountMinor: -1000 },
      { dateISO: "2024-01-01", amountMinor: 2200 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r as number).toBeCloseTo(0.06525, 3);
  });

  it("a loss: -10000 at t0, +9000 one year later => ~-0.10", () => {
    const flows: XirrFlow[] = [
      { dateISO: "2024-01-01", amountMinor: -10000 },
      { dateISO: "2025-01-01", amountMinor: 9000 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r as number).toBeCloseTo(-0.1, 3);
  });

  it("bisection path — a steep loss below -50%/yr: -10000 at t0, +2000 one year later => ~-0.80", () => {
    // r solving 2000/(1+r)^t = 10000 over one ~year. For an exact 1.0-year
    // span this is r = 0.2 - 1 = -0.80; the actual/365.25 day-count makes the
    // 365-day span a fraction t=0.999316 of a year, so the honest rate is
    // 0.2^(1/0.999316) - 1 = -0.79935 (verified against the returned value).
    // Newton from a +10% seed must NOT converge to a positive rate; the
    // bisection bracket [-0.9999, 10] contains it. Proves the deep-loss path.
    const flows: XirrFlow[] = [
      { dateISO: "2024-01-01", amountMinor: -10000 },
      { dateISO: "2025-01-01", amountMinor: 2000 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r as number).toBeLessThan(-0.5); // deep-loss (below -50%/yr) region
    expect(r as number).toBeCloseTo(-0.8, 2);
  });
});

describe("xirr — sign convention", () => {
  it("respects the investor convention: contributions negative, returns positive", () => {
    // Same magnitudes, correct signs -> a real positive rate.
    const good = xirr([
      { dateISO: "2024-01-01", amountMinor: -10000 },
      { dateISO: "2025-01-01", amountMinor: 12000 },
    ]);
    expect(good).not.toBeNull();
    expect(good as number).toBeGreaterThan(0);
  });

  it("all-positive flows (both inflows) => null (no break-even rate exists)", () => {
    const r = xirr([
      { dateISO: "2024-01-01", amountMinor: 10000 },
      { dateISO: "2025-01-01", amountMinor: 12000 },
    ]);
    expect(r).toBeNull();
  });

  it("all-negative flows (both outflows) => null", () => {
    const r = xirr([
      { dateISO: "2024-01-01", amountMinor: -10000 },
      { dateISO: "2025-01-01", amountMinor: -12000 },
    ]);
    expect(r).toBeNull();
  });
});

describe("xirr — degenerate inputs return null (never a fabricated rate)", () => {
  it("empty flows => null", () => {
    expect(xirr([])).toBeNull();
  });

  it("a single flow => null (nothing to solve)", () => {
    expect(xirr([{ dateISO: "2024-01-01", amountMinor: -10000 }])).toBeNull();
  });

  it("flows spanning under one day => null (no annualisation horizon)", () => {
    // Same calendar day: span 0 < 1 day.
    const r = xirr([
      { dateISO: "2024-01-01", amountMinor: -10000 },
      { dateISO: "2024-01-01", amountMinor: 11000 },
    ]);
    expect(r).toBeNull();
  });

  it("an unparsable date => null (no honest rate)", () => {
    const r = xirr([
      { dateISO: "not-a-date", amountMinor: -10000 },
      { dateISO: "2025-01-01", amountMinor: 11000 },
    ]);
    expect(r).toBeNull();
  });

  it("zero-amount flows do not establish a sign => null", () => {
    // A zero and a single negative — no positive flow at all.
    const r = xirr([
      { dateISO: "2024-01-01", amountMinor: 0 },
      { dateISO: "2025-01-01", amountMinor: -10000 },
    ]);
    expect(r).toBeNull();
  });
});

describe("xirr — purity", () => {
  it("does not mutate the caller's flows array and is order-independent", () => {
    const flows: XirrFlow[] = [
      { dateISO: "2025-01-01", amountMinor: 11000 },
      { dateISO: "2024-01-01", amountMinor: -10000 },
    ];
    const copy = flows.map((f) => ({ ...f }));
    const rUnsorted = xirr(flows);
    // input unchanged
    expect(flows).toEqual(copy);
    // same answer whether or not the caller pre-sorted
    const rSorted = xirr([
      { dateISO: "2024-01-01", amountMinor: -10000 },
      { dateISO: "2025-01-01", amountMinor: 11000 },
    ]);
    expect(rUnsorted).toBeCloseTo(rSorted as number, 12);
  });
});
