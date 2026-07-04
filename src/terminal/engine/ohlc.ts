/* =========================================================================
   TERMINAL 77 — OHLC ENGINE (ported verbatim from prototypes/terminal-77)

   The engine's histories are single close-price paths. Here we derive plausible
   OHLC + volume per bar deterministically (seeded), so candles are reproducible.
   SEAM: in the app port, PORTFOLIO becomes the real snapshot equity curve and the
   roster/typed series become real OHLC from the LiveProvider — this generator is
   the MOCK stand-in only. Kept isolated so swapping it out touches nothing else.
   ========================================================================= */

import { mulberry32, seedFromString } from "./prng";
import {
  DataEngine, genHistory, HIST_POINTS, RANGE_VOLSCALE, RANGE_DRIFTSCALE,
  type Range,
} from "./dataEngine";

export interface Bar { o: number; h: number; l: number; c: number; v: number }

export function ohlcFromCloses(closes: number[], seed: number, volBase: number): Bar[] {
  const rng = mulberry32(seed >>> 0);
  const bars: Bar[] = []; let prevClose = closes[0];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const o = i === 0 ? c * (0.999 + rng() * 0.002) : prevClose;
    const span = Math.abs(c - o) + (Math.abs(c) * 0.002 * (0.4 + rng())); // intrabar range around the move
    const hi = Math.max(o, c) + span * (0.3 + rng() * 0.7);
    const lo = Math.min(o, c) - span * (0.3 + rng() * 0.7);
    const vol = Math.max(1, volBase * (0.5 + rng() * 1.2) * (1 + Math.abs(c - o) / (Math.abs(c) || 1) * 8));
    bars.push({ o, h: hi, l: Math.max(lo, 0.0001), c, v: vol });
    prevClose = c;
  }
  return bars;
}

// Seeded GBM close path for an ARBITRARY (typed, unknown) symbol — hash for the seed.
export function genSyntheticCloses(sym: string, points: number, range: Range): number[] {
  const seed = seedFromString("SYN|" + sym) ^ (range.charCodeAt(0) * 197);
  const rng = mulberry32(seed >>> 0);
  // deterministic personality from the hash so the same ticker always looks the same
  const h = seedFromString(sym);
  const base = 20 + (h % 480);                  // $20–$500
  const vol = 0.012 + ((h >> 7) % 40) / 1000;   // 1.2%–5.2% daily
  const drift = (((h >> 3) % 21) - 10) / 12000; // small ± drift
  const vs = RANGE_VOLSCALE[range] || 1, ds = RANGE_DRIFTSCALE[range] || 1;
  const v = vol * vs, dr = drift * ds * 0.5;
  const startFactor = range === "1Y" ? 0.7 : range === "1M" ? 0.88 : range === "1W" ? 0.965 : 0.992;
  let price = base * startFactor; const arr = new Array<number>(points);
  for (let i = 0; i < points; i++) {
    const u1 = rng() || 1e-9, u2 = rng(); const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    price = Math.max(price * (1 + dr + v * z), base * 0.12); arr[i] = price;
  }
  return arr;
}

/* Seeded SIMULATED portfolio equity curve (clearly labelled). Blends roster paths
   weighted by held qty so it reads like a real book; falls back to a smooth GBM.

   PORT NOTE — pure-engine boundary: the prototype read State.positions and
   State.cash (page globals) directly. The engine must not import the state
   singleton (calc/render separation; also keeps the module graph acyclic), so
   the caller passes the BOOK — cash + positions — explicitly. state.ts owns
   the convenience call. The math inside is verbatim: sum weighted, range-scaled
   component paths; normalise so the LAST point equals the current real book
   equity (cash + market value) for a truthful right edge. */
export interface Book { cash: number; positions: Record<string, { qty: number; avgCost: number }> }

export function genPortfolioCloses(points: number, range: Range, book: Book): number[] {
  const held = Object.keys(book.positions).filter((s) => book.positions[s].qty > 0);
  if (!held.length) return genSyntheticCloses("PORTFOLIO", points, range);
  const comps = held.map((s) => {
    const sd = (DataEngine.seed ^ seedFromString(s)) ^ (range.charCodeAt(0) * 131);
    return { series: genHistory(s, points, sd, range), qty: book.positions[s].qty };
  });
  const arr = new Array<number>(points).fill(0);
  for (let i = 0; i < points; i++) { let e = book.cash; comps.forEach((c) => { e += c.series[i] * c.qty; }); arr[i] = e; }
  // current real book equity (== the prototype's computeEquity().total)
  let mv = 0;
  for (const sym of held) { mv += book.positions[sym].qty * DataEngine.get(sym).last; }
  const total = book.cash + mv;
  const scale = total / arr[points - 1];
  for (let i = 0; i < points; i++) arr[i] *= scale;
  return arr;
}

// re-export the range point counts alongside the generators that consume them —
// the Performance screen sizes every series load off HIST_POINTS[range].
export { HIST_POINTS };
