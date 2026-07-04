/* =========================================================================
   NEWS — scheduled-lane freezing, earnings sort key, headline impact bands,
   business-day helpers, and the browser build's honest CACHED failover.
   ========================================================================= */
import { describe, it, expect, beforeAll } from "vitest";
import { DataEngine, DEFAULT_ROSTER } from "./dataEngine";
import {
  NewsEngine, NEWS_TIMING_ORDER, NEWS_MACRO_DEFS,
  nextBusinessDay, businessDaysBetween, macroImpactRank, newsCountFor,
} from "./news";

beforeAll(() => { DataEngine.init(); NewsEngine.bump(); });

describe("business-day helpers", () => {
  it("nextBusinessDay skips weekends", () => {
    const fri = new Date(2026, 6, 3); // Fri Jul 3 2026
    const next = nextBusinessDay(fri, 1);
    expect(next.getDay()).toBe(1);    // Monday
    expect(businessDaysBetween(fri, next)).toBe(1);
  });
  it("businessDaysBetween is 0 for same day and counts only weekdays", () => {
    const mon = new Date(2026, 6, 6);
    expect(businessDaysBetween(mon, mon)).toBe(0);
    expect(businessDaysBetween(mon, new Date(2026, 6, 13))).toBe(5); // next Monday
  });
});

describe("EARNINGS lane", () => {
  it("rows are frozen per dataV (scheduled events never flicker on tick)", () => {
    const a = NewsEngine.earnings();
    const b = NewsEngine.earnings();
    expect(b).toBe(a); // the same cached array — literally frozen between bumps
  });

  it("sort key = date ASC, then timing order BMO<AMC<TAS, then mcap DESC", () => {
    const rows = NewsEngine.earnings();
    expect(rows.length).toBe(DEFAULT_ROSTER.length);
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1], c = rows[i];
      const dp = p.date.getTime(), dc = c.date.getTime();
      expect(dp <= dc).toBe(true);
      if (dp === dc) {
        const tp = NEWS_TIMING_ORDER[p.timing], tc = NEWS_TIMING_ORDER[c.timing];
        expect(tp <= tc).toBe(true);
        if (tp === tc) expect(p.marketCap >= c.marketCap).toBe(true);
      }
    }
  });

  it("EPS estimate ties back to price/PE and is null for crypto (pe=NaN)", () => {
    const rows = NewsEngine.earnings();
    const btc = rows.find((r) => r.sym === "BTC-USD");
    expect(btc?.epsEstimated).toBeNull();
    const nvda = rows.find((r) => r.sym === "NVDA");
    const q = DataEngine.get("NVDA");
    expect(nvda?.epsEstimated).toBeCloseTo((q.last / 64.2) / 4, 6);
  });

  it("held-qty flows through the injected seam (default = flat book)", () => {
    const rows = NewsEngine.earnings();
    rows.forEach((r) => expect(r.heldQty).toBe(0)); // engine default; state.ts installs the real book
  });
});

describe("MACRO lane", () => {
  it("carries the diegetic five in schema order (date ASC, impact DESC)", () => {
    const rows = NewsEngine.macro();
    expect(rows.length).toBe(NEWS_MACRO_DEFS.length);
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1], c = rows[i];
      expect(p.date.getTime() <= c.date.getTime()).toBe(true);
      if (p.date.getTime() === c.date.getTime()) expect(macroImpactRank(p.impact) >= macroImpactRank(c.impact)).toBe(true);
    }
  });
});

describe("HEADLINES scoring (market-news-analyst port)", () => {
  it("impact = priceScore × breadth × forward, with the documented multipliers", () => {
    for (const sym of DEFAULT_ROSTER) {
      const h = NewsEngine.scoreHeadline(sym);
      const ad = Math.abs(h.dayPct);
      const priceScore = ad >= 10 ? 10 : ad >= 5 ? 7 : ad >= 2 ? 4 : ad >= 1 ? 2 : 1;
      const fwdMult = ad < 1 ? 1.0 : (h.fwdLabel === "TREND CONFIRMATION" ? 1.25 : 0.75);
      expect(h.impact).toBeCloseTo(priceScore * h.breadthMult * fwdMult, 10);
    }
  });
  it("SPY reads SYSTEMIC (3x) and crypto/AI names read SECTOR-WIDE (1.5x)", () => {
    expect(NewsEngine.scoreHeadline("SPY").breadthLabel).toBe("SYSTEMIC");
    expect(NewsEngine.scoreHeadline("SPY").breadthMult).toBe(3);
    expect(NewsEngine.scoreHeadline("BTC-USD").breadthLabel).toBe("SECTOR-WIDE");
    expect(NewsEngine.scoreHeadline("NVDA").breadthMult).toBe(1.5); // AI tag
  });
  it("headline order is frozen impact-DESC per refresh", () => {
    const rows = NewsEngine.headlines();
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].impact >= rows[i].impact).toBe(true);
    expect(NewsEngine.headlines()).toBe(rows); // cached until the next bump
  });
});

describe("honest browser failover", () => {
  it("tryLive() resolves false and flips the feed to CACHED (no fetch path exists)", async () => {
    const ok = await NewsEngine.tryLive(); // [LIVE SEAM: Tauri-Rust only] swaps this in the app port
    expect(ok).toBe(false);
    expect(NewsEngine.live).toBe(false);
    expect(NewsEngine.cached).toBe(true);
  });
  it("newsCountFor stays within roster bounds", () => {
    expect(newsCountFor("HEADLINES")).toBe(DEFAULT_ROSTER.length);
    expect(newsCountFor("EARNINGS")).toBeGreaterThanOrEqual(0);
    expect(newsCountFor("EARNINGS")).toBeLessThanOrEqual(DEFAULT_ROSTER.length);
  });
});
