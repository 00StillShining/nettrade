/**
 * Deterministic ticker "portrait" glyph — an honest, GENERATED abstract mark
 * seeded from the ticker string. Deliberately NOT a real (or fake) company
 * logo: no fetch, no lookup table, no brand marks. Two honest ingredients:
 *   1. The ticker's 1-3 letter initials, set in the display font.
 *   2. A small deterministic geometric motif (a few overlapping shapes)
 *      derived from a hash of the ticker string, so the same ticker always
 *      renders the same glyph (stable across renders/sessions) without ever
 *      pretending to be a "real" logo.
 *
 * Pure/no side effects — safe to call during render.
 */

/** Tiny deterministic string hash (djb2 variant) -> unsigned 32-bit int. */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Strip the Trading 212 instrument suffix (e.g. "_US_EQ") for initials. */
function baseSymbol(ticker: string): string {
  return ticker.split("_")[0] ?? ticker;
}

/** 1-3 letter initials shown on the glyph ground, e.g. "NVDA" -> "NVD". */
export function tickerInitials(ticker: string): string {
  const base = baseSymbol(ticker).replace(/[^A-Za-z0-9]/g, "");
  return (base.slice(0, 3) || "?").toUpperCase();
}

export interface TickerGlyphMotif {
  /** Hue-independent motif id (0-4) selecting which shape combination to draw. */
  variant: number;
  /** Rotation in degrees for the motif group. */
  rotate: number;
  /** 0..1 seeds for shape placement, purely deterministic per ticker. */
  seedA: number;
  seedB: number;
  seedC: number;
}

/** Derive a stable, purely-geometric motif from the ticker string. */
export function tickerMotif(ticker: string): TickerGlyphMotif {
  const h = hashString(baseSymbol(ticker));
  return {
    variant: h % 5,
    rotate: (h >>> 3) % 360,
    seedA: ((h >>> 5) % 100) / 100,
    seedB: ((h >>> 11) % 100) / 100,
    seedC: ((h >>> 17) % 100) / 100,
  };
}
