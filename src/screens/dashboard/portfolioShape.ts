import type { Position } from "../../adapters/trading212";

/**
 * PORTFOLIO SHAPE — five honest, derived axes computed ONLY from the current
 * Position[] snapshot (SCREEN_PATTERNS.md §4 honest-data rule; CHART_CRAFT.md
 * radar honesty rule: never invent an axis value). Each axis is normalised to
 * 0..1 with all divisions guarded against empty/zero denominators.
 *
 * Deliberately titled "PORTFOLIO SHAPE", not "account health" — there is no
 * realised P/L, cash, or risk data yet (that arrives with the Performance
 * engine), so the radar only ever describes what today's open positions look
 * like, never a fabricated wellness score.
 */

export interface PortfolioShapeAxis {
  key: string;
  label: string;
  /** 0..1, already normalised — see the formula comment at each call site. */
  value: number;
}

export interface PortfolioShape {
  axes: PortfolioShapeAxis[];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function computePortfolioShape(positions: Position[]): PortfolioShape {
  const n = positions.length;

  const totalValue = positions.reduce((sum, p) => sum + p.currentValueMinor, 0);
  const totalInvested = positions.reduce((sum, p) => sum + p.totalCostMinor, 0);
  const totalUnrealised = positions.reduce((sum, p) => sum + p.unrealizedPlMinor, 0);

  // 1. BREADTH = min(positions.length / 20, 1)
  const breadth = clamp01(n / 20);

  // 2. BALANCE = 1 − Σ(share²) over share = currentValueMinor / totalValue
  //    (Herfindahl-Hirschman evenness — 1 = perfectly even, →0 = one holding
  //    dominates). Guarded: no value → treat as 0 (nothing to balance).
  let balance = 0;
  if (totalValue > 0) {
    const hhi = positions.reduce((sum, p) => {
      const share = p.currentValueMinor / totalValue;
      return sum + share * share;
    }, 0);
    balance = clamp01(1 - hhi);
  }

  // 3. WINNERS = (# positions with unrealizedPlMinor > 0) / positions.length
  const winners = n > 0 ? clamp01(positions.filter((p) => p.unrealizedPlMinor > 0).length / n) : 0;

  // 4. IN PROFIT = Σ(currentValueMinor of positions with unrealizedPlMinor > 0) / totalValue
  let inProfit = 0;
  if (totalValue > 0) {
    const profitValue = positions
      .filter((p) => p.unrealizedPlMinor > 0)
      .reduce((sum, p) => sum + p.currentValueMinor, 0);
    inProfit = clamp01(profitValue / totalValue);
  }

  // 5. RETURN = clamp01((totalUnrealised/totalInvested + 0.10) / 0.20)
  //    -10%..+10% maps to 0..1, 0.5 = flat. Guarded: no invested capital → 0.5 (flat/unknown).
  let ret = 0.5;
  if (totalInvested > 0) {
    const returnRatio = totalUnrealised / totalInvested;
    ret = clamp01((returnRatio + 0.1) / 0.2);
  }

  return {
    axes: [
      { key: "breadth", label: "Breadth", value: breadth },
      { key: "balance", label: "Balance", value: balance },
      { key: "winners", label: "Winners", value: winners },
      { key: "inProfit", label: "In Profit", value: inProfit },
      { key: "return", label: "Return", value: ret },
    ],
  };
}
