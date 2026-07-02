import type { Position } from "../../adapters/trading212";

/**
 * COMPARE AXES — the honest, derived pentagon axes for a HEAD-TO-HEAD of TWO
 * holdings (VISUAL_DIRECTION.md §5 "Compare"; SCREEN_PATTERNS.md §4 honest-data
 * rule; CHART_CRAFT.md radar honesty rule: never invent an axis value).
 *
 * This is a PER-HOLDING radar, NOT the Dashboard's PORTFOLIO-shape radar. The
 * whole point of the two silhouettes is that they read against each other, so
 * every axis is normalised PAIRWISE across ONLY the two compared holdings
 * (relative 0..1), not against some absolute scale. A vertex at 1.0 therefore
 * means "this holding leads the OTHER on this axis" — never "good" in the
 * abstract. Because the shapes are relative, a bigger polygon is not
 * intrinsically "better"; we mark the PER-AXIS winner in amber and label each
 * axis plainly so the shape is read honestly, not as a score.
 *
 * HONEST OMISSION: an axis whose raw metric can't be computed for a holding
 * (e.g. Return % with zero cost basis, Price-vs-avg with a missing avg price)
 * is dropped from the WHOLE comparison — we never fabricate or zero-fill it.
 * With <3 shared axes the radar can't be drawn (see the caller's guard).
 */

/** A single raw metric for ONE holding, before pairwise normalisation. */
export interface AxisMetric {
  key: AxisKey;
  label: string;
  /** Raw signed value in its own unit (minor units, ratio, etc.). */
  raw: number;
  /** Human-readable value for the a11y table / tooltip (already formatted-ish). */
  display: string;
}

export type AxisKey = "value" | "return" | "alloc" | "priceVsAvg" | "quantity";

/** One normalised axis of the pentagon for ONE holding (0..1, pairwise). */
export interface CompareAxis {
  key: AxisKey;
  label: string;
  /** 0..1 relative to the OTHER compared holding (bigger = leads on this axis). */
  value: number;
  /** The raw signed metric (for the winner test + a11y readout). */
  raw: number;
  display: string;
}

/** The two holdings' aligned axis sets + which side wins each axis. */
export interface CompareShape {
  /** Axis rows in a stable order, each carrying BOTH holdings' normalised value. */
  axes: {
    key: AxisKey;
    label: string;
    a: { value: number; raw: number; display: string };
    b: { value: number; raw: number; display: string };
    /** "a" | "b" | "tie" — the per-axis winner (marked amber). */
    winner: "a" | "b" | "tie";
  }[];
  /** Convenience: just holding A's polygon (for HoldingRadar). */
  axesA: CompareAxis[];
  /** Convenience: just holding B's polygon (for HoldingRadar). */
  axesB: CompareAxis[];
  /** Count of axes A leads on (excludes ties) — drives the hero verdict. */
  aWins: number;
  bWins: number;
}

function isFiniteNum(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Raw metrics for one holding. Returns null for any axis that can't be honestly
 * computed for THIS holding, so the caller can drop it from BOTH sides.
 */
function rawMetrics(p: Position, totalValue: number): Partial<Record<AxisKey, AxisMetric>> {
  const out: Partial<Record<AxisKey, AxisMetric>> = {};
  const ccy = p.accountCurrency || "GBP";
  const instCcy = p.instrumentCurrency || ccy;

  // NOTE: absolute market VALUE is deliberately NOT a radar axis. alloc.raw =
  // currentValueMinor / totalValue uses the SAME totalValue divisor for both
  // holdings, so a Value axis and an Allocation axis are perfectly collinear
  // under pairwise normalisation — they'd produce identical ratios and pick the
  // same winner, silently double-weighting size in the silhouette + the
  // aWins/bWins tally. Allocation is kept as the portfolio-relative size axis;
  // absolute Market Value stays visible as a dossier stat in Compare.tsx.

  // RETURN % — unrealised P/L ÷ cost basis. OMITTED if no cost basis (can't
  // form a percentage) — never zero-filled.
  if (p.totalCostMinor > 0) {
    const r = p.unrealizedPlMinor / p.totalCostMinor;
    if (isFiniteNum(r)) {
      out.return = { key: "return", label: "Return %", raw: r, display: fmtSignedPct(r) };
    }
  }

  // ALLOCATION — share of the whole portfolio. OMITTED if the portfolio has no
  // value (degenerate; nothing to allocate against).
  if (totalValue > 0) {
    const a = p.currentValueMinor / totalValue;
    if (isFiniteNum(a)) {
      out.alloc = { key: "alloc", label: "Allocation", raw: a, display: fmtSignedPct(a, false) };
    }
  }

  // PRICE vs AVG — signed % the current price sits above/below your average
  // entry (a price-pure momentum read, instrument ccy, FX-agnostic by design).
  // OMITTED if avg price is zero/unknown.
  if (p.avgPriceMinor > 0) {
    const d = (p.currentPriceMinor - p.avgPriceMinor) / p.avgPriceMinor;
    if (isFiniteNum(d)) {
      out.priceVsAvg = { key: "priceVsAvg", label: "Price vs Avg", raw: d, display: fmtSignedPct(d) };
    }
  }

  // QUANTITY — share count held (an honest size axis distinct from value).
  if (isFiniteNum(p.quantity)) {
    out.quantity = {
      key: "quantity",
      label: "Quantity",
      raw: p.quantity,
      display: `${fmtNum(p.quantity)} sh · ${instCcy}`,
    };
  }

  return out;
}

/** Stable axis order for the radar (drawn clockwise from top). "value" is
 * intentionally excluded — it is collinear with "alloc" (see rawMetrics). The
 * remaining four axes are genuinely independent (return %, portfolio share,
 * price-vs-avg, quantity). */
const AXIS_ORDER: AxisKey[] = ["return", "alloc", "priceVsAvg", "quantity"];

/**
 * Pairwise-normalise ONE axis's two raw values to 0..1 each.
 *
 * We normalise BOTH values against the pair's magnitude from a shared baseline
 * so the laggard's radius reflects how close it actually is — the leader still
 * sits at 1.0, but 100 vs 90 reads CLOSE while 100 vs 5 reads FAR. This
 * preserves proportion (honest-chart law, CHART_CRAFT/SCREEN_PATTERNS §4)
 * instead of erasing magnitude by pinning every non-tied laggard to the floor.
 * A small floor (0.14) still keeps the smaller shape visible (a zero-radius
 * spike reads as "missing", which would be dishonest). If both raw values are
 * equal both sit mid-rim (0.5) — a true tie.
 *
 * Signed metrics (Return %, Price vs Avg) can be negative. When the laggard is
 * negative, anchoring the baseline at the laggard itself would pin EVERY
 * negative laggard to the floor (−3% vs +2% would read identically to −90% vs
 * +90%), erasing magnitude. Instead we switch to a SYMMETRIC scale about zero:
 * the shared magnitude m = max(|lo|, |hi|) maps 0 → mid-rim and ±m →
 * floor/rim, so the size of the gap is preserved honestly. The zero-baseline
 * path is kept for the non-negative case (100 vs 5 → 0.18 reads far, 100 vs 90
 * → 0.91 reads close).
 */
function normalisePair(rawA: number, rawB: number): { a: number; b: number } {
  const FLOOR = 0.14;
  const lo = Math.min(rawA, rawB);
  const hi = Math.max(rawA, rawB);
  if (lo < 0) {
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    if (m <= 0) return { a: 0.5, b: 0.5 };
    const scale = (v: number) => FLOOR + ((v + m) / (2 * m)) * (1 - FLOOR);
    return { a: scale(rawA), b: scale(rawB) };
  }
  const range = hi; // baseline is 0 for the non-negative case
  if (range <= 0) return { a: 0.5, b: 0.5 };
  const scale = (v: number) => FLOOR + (v / range) * (1 - FLOOR);
  return { a: scale(rawA), b: scale(rawB) };
}

/** Per-axis winner from the RAW metric (higher raw wins; ties within epsilon). */
function axisWinner(rawA: number, rawB: number): "a" | "b" | "tie" {
  const eps = Math.max(Math.abs(rawA), Math.abs(rawB)) * 1e-6;
  if (Math.abs(rawA - rawB) <= eps) return "tie";
  return rawA > rawB ? "a" : "b";
}

/**
 * Build the aligned CompareShape for TWO holdings. `totalValue` is the whole
 * portfolio's value (for the Allocation axis) — pass the sum across ALL the
 * user's holdings, not just these two, so allocation stays honest.
 */
export function computeCompareShape(a: Position, b: Position, totalValue: number): CompareShape {
  const mA = rawMetrics(a, totalValue);
  const mB = rawMetrics(b, totalValue);

  const axes: CompareShape["axes"] = [];
  const axesA: CompareAxis[] = [];
  const axesB: CompareAxis[] = [];
  let aWins = 0;
  let bWins = 0;

  for (const key of AXIS_ORDER) {
    const ra = mA[key];
    const rb = mB[key];
    // Honest omission: keep an axis ONLY if BOTH holdings can compute it.
    if (!ra || !rb) continue;

    const norm = normalisePair(ra.raw, rb.raw);
    const winner = axisWinner(ra.raw, rb.raw);
    if (winner === "a") aWins++;
    else if (winner === "b") bWins++;

    axes.push({
      key,
      label: ra.label,
      a: { value: norm.a, raw: ra.raw, display: ra.display },
      b: { value: norm.b, raw: rb.raw, display: rb.display },
      winner,
    });
    axesA.push({ key, label: ra.label, value: norm.a, raw: ra.raw, display: ra.display });
    axesB.push({ key, label: rb.label, value: norm.b, raw: rb.raw, display: rb.display });
  }

  return { axes, axesA, axesB, aWins, bWins };
}

/* --------------------------- small local formatters --------------------------
 * Money/qty use the SAME shared helpers as every screen via re-export wrappers
 * so the a11y `display` strings match the visible figures. We import the shared
 * fmtMinor/fmtQty rather than re-implement (single source of truth). */
import { fmtQty, fmtPct } from "../shared/format";

function fmtNum(n: number): string {
  return fmtQty(n);
}
/** Signed percent for the a11y readout. `showSign` off for allocation (a
 * share is never negative, so a "+" would be noise). */
function fmtSignedPct(ratio: number, showSign = true): string {
  const mag = fmtPct(ratio);
  if (!showSign) return mag;
  if (ratio === 0) return mag;
  return `${ratio > 0 ? "+" : "−"}${mag}`;
}
