// Performance-Truth engine — XIRR (money-weighted return). PURE maths: no
// I/O, no Date.now(), no Math.random(). The caller supplies EVERY dated
// flow — including the terminal portfolio value as the final positive flow
// — so this function is fully deterministic and reproducible on any machine
// (see truth.ts/series.ts for the same purity discipline).
//
// WHY money-weighted (and why it is a DIFFERENT number from the True Gain
// return %): XIRR is the single annualised rate that discounts every dated
// cash flow back to a net present value of zero — it weights each pound by
// how long it was actually invested, so a late top-up that had no time to
// grow does not dilute the rate the way a simple gain/contributions ratio
// would. It answers "what constant annual rate would my actual, dated cash
// movements have had to earn to end at today's value".
//
// HONESTY: this engine NEVER invents a flow. If the caller's flows are
// degenerate (fewer than two, all one sign, or spanning under a day) there
// is no well-defined rate and this returns null — the screen must then show
// "—", never a fabricated figure. The store additionally passes null-worthy
// inputs straight through (e.g. it refuses to compute at all when the
// deposit history is partial — see TruthStore.xirrPct's contract), because a
// missing old deposit would make even a converged rate a lie.

/**
 * One dated cash flow, INVESTOR CONVENTION:
 *   - money you PUT IN (a contribution/deposit, or a buy that consumed cash)
 *     is NEGATIVE,
 *   - money that CAME BACK (a withdrawal, and the terminal portfolio value
 *     the caller appends as the final flow) is POSITIVE.
 * `amountMinor` is an integer minor-units amount carrying its own sign (this
 * is the ONE place in the engine where a signed cash amount is expected — it
 * is a flow, not a stored Money balance).
 */
export interface XirrFlow {
  dateISO: string;
  amountMinor: number;
}

/** Day-count basis: actual days / 365.25, measured from the FIRST flow's date. */
const DAYS_PER_YEAR = 365.25;
const MS_PER_DAY = 86_400_000;

/** Convergence: |NPV| below this many minor units is "zero" (see xirr doc). */
const NPV_TOLERANCE = 0.5;
const MAX_ITERS = 100;

/** Newton-Raphson seed — a 10% annual rate, per the contract. */
const NR_SEED = 0.1;

/** Bisection bracket — the widest economically-meaningful rate band. The low
 * bound is just above -100%/yr (a rate of exactly -1 makes (1+r) zero and the
 * discount factors blow up); the high bound of +1000%/yr comfortably covers
 * any real personal-account return. */
const BISECT_LO = -0.9999;
const BISECT_HI = 10;

interface NormalizedFlow {
  /** Years since the first flow (actual/365.25), always >= 0. */
  years: number;
  amountMinor: number;
}

/**
 * npv — net present value of the flows at annual rate `r`, discounting each
 * flow by (1 + r)^years. With the investor sign convention a solution r
 * exists wherever contributions (negative) and returns (positive) both
 * appear. Guards a non-finite factor (r <= -1) by returning NaN so the
 * caller treats that r as invalid rather than propagating ±Infinity.
 */
function npv(flows: NormalizedFlow[], r: number): number {
  const base = 1 + r;
  if (base <= 0) return NaN; // (1+r)^t undefined/degenerate for r <= -1
  let sum = 0;
  for (const f of flows) {
    sum += f.amountMinor / Math.pow(base, f.years);
  }
  return sum;
}

/**
 * dNpv — analytic derivative d(NPV)/dr. Each term
 *   amount * (1+r)^(-t)  differentiates to  amount * (-t) * (1+r)^(-t-1),
 * i.e. -t * amount / (1+r)^(t+1). Used by Newton-Raphson; NaN-guarded on
 * r <= -1 exactly like npv.
 */
function dNpv(flows: NormalizedFlow[], r: number): number {
  const base = 1 + r;
  if (base <= 0) return NaN;
  let sum = 0;
  for (const f of flows) {
    sum += (-f.years * f.amountMinor) / Math.pow(base, f.years + 1);
  }
  return sum;
}

/**
 * bisection — the robust fallback when Newton-Raphson diverges, oscillates,
 * or hits a zero/NaN derivative. Requires a SIGN CHANGE of NPV across
 * [BISECT_LO, BISECT_HI]; if NPV has the same sign at both ends there is no
 * root in the bracket (e.g. a rate below -99.99%/yr, or a genuinely
 * non-convergent flow set) and this returns null rather than a wrong root.
 * Halves the bracket until |NPV| < tolerance or MAX_ITERS.
 */
function bisection(flows: NormalizedFlow[]): number | null {
  let lo = BISECT_LO;
  let hi = BISECT_HI;
  let fLo = npv(flows, lo);
  let fHi = npv(flows, hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (Math.abs(fLo) < NPV_TOLERANCE) return lo;
  if (Math.abs(fHi) < NPV_TOLERANCE) return hi;
  // No sign change -> no bracketed root -> honest null (never a fake rate).
  if (fLo > 0 === fHi > 0) return null;

  let mid = lo;
  for (let i = 0; i < MAX_ITERS; i++) {
    mid = (lo + hi) / 2;
    const fMid = npv(flows, mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < NPV_TOLERANCE) return mid;
    // Keep the sub-interval that still brackets the sign change.
    if (fLo > 0 === fMid > 0) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
      fHi = fMid;
    }
  }
  return mid; // best estimate after MAX_ITERS of halving
}

/**
 * xirr — the annualised money-weighted rate for a set of dated flows.
 *
 * INPUT: flows in the investor convention (contributions negative;
 * withdrawals AND the terminal portfolio value positive — the CALLER
 * appends that terminal flow, this function never invents it).
 *
 * RETURNS: the annualised rate as a decimal (0.124 = +12.4%/yr), or null.
 *
 * NULL (no honest rate exists) when:
 *   - fewer than 2 flows (nothing to solve),
 *   - all flows share one sign (no break-even rate can exist — you cannot
 *     annualise a return with no money out, or no money in),
 *   - the flows span under a full day (rate is undefined over a zero horizon),
 *   - or neither Newton-Raphson nor bisection converges (|NPV| never falls
 *     below 0.5 minor units within 100 iterations, or no sign change brackets
 *     a root).
 *
 * METHOD: Newton-Raphson from a 10% seed using the analytic derivative;
 * fall back to bisection on [-0.9999, 10] the instant NR diverges (steps
 * outside the bracket), oscillates (NaN/zero derivative), or fails to
 * converge in 100 iterations. Day-count is actual/365.25 from the FIRST
 * flow's date.
 */
export function xirr(flows: XirrFlow[]): number | null {
  // --- degenerate-input guards (contract) --------------------------------
  if (!flows || flows.length < 2) return null;

  // Sort chronologically (codepoint on ISO strings — same convention as the
  // rest of the engine; never mutate the caller's array).
  const ordered = [...flows].sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));

  const firstMs = new Date(ordered[0].dateISO).getTime();
  const lastMs = new Date(ordered[ordered.length - 1].dateISO).getTime();
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return null; // unparsable date -> no honest rate
  // Span guard: under one full day means no meaningful annualisation horizon.
  if (lastMs - firstMs < MS_PER_DAY) return null;

  // All-same-sign guard: a well-defined IRR needs at least one inflow and one
  // outflow. Zero-amount flows don't establish a sign. If every non-zero flow
  // is on the same side, there is no break-even rate — honest null.
  let sawPos = false;
  let sawNeg = false;
  for (const f of ordered) {
    if (f.amountMinor > 0) sawPos = true;
    else if (f.amountMinor < 0) sawNeg = true;
  }
  if (!sawPos || !sawNeg) return null;

  // Normalize to years-since-first (actual/365.25). A per-flow parse guard:
  // any unparsable interior date poisons the whole computation, so bail.
  const normalized: NormalizedFlow[] = [];
  for (const f of ordered) {
    const ms = new Date(f.dateISO).getTime();
    if (!Number.isFinite(ms)) return null;
    normalized.push({ years: (ms - firstMs) / MS_PER_DAY / DAYS_PER_YEAR, amountMinor: f.amountMinor });
  }

  // --- Newton-Raphson from the 10% seed ----------------------------------
  let r = NR_SEED;
  for (let i = 0; i < MAX_ITERS; i++) {
    const f = npv(normalized, r);
    if (!Number.isFinite(f)) break; // stepped into r <= -1 territory -> bisect
    if (Math.abs(f) < NPV_TOLERANCE) return r;

    const d = dNpv(normalized, r);
    if (!Number.isFinite(d) || d === 0) break; // flat/NaN derivative -> bisect

    const next = r - f / d;
    if (!Number.isFinite(next)) break;
    // Diverged outside the economically-meaningful bracket -> hand to bisection
    // rather than chasing a runaway Newton step (this is the rate < -50% /
    // steep-loss path the contract calls out).
    if (next <= BISECT_LO || next >= BISECT_HI) break;

    r = next;
  }

  // --- bisection fallback ------------------------------------------------
  return bisection(normalized);
}
