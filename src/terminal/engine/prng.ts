/* =========================================================================
   TERMINAL 77 — seeded PRNG (ported verbatim from prototypes/terminal-77)

   PARITY IS LAW: every mock number in the terminal flows from these two
   functions with DEFAULT_SEED 77. The user signed off on specific screens;
   change one bit here and every chart, candle, scanner rank and radar shape
   drifts off the approved prototype. Do not "modernise" the math.
   ========================================================================= */

// mulberry32 seeded PRNG — fixed default seed => reproducible screenshots.
// Returns a closure yielding floats in [0,1). The `seed |= 0` coercion is
// load-bearing: seeds arrive as signed XOR products (e.g. 77 ^ fnv1a) and the
// 32-bit wraparound must match the prototype exactly.
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a string hash — the deterministic "personality" seed for a ticker.
// Unsigned (>>> 0) so 'NVDA' always lands on the same 32-bit value.
export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
