/* =========================================================================
   TERMINAL 77 — CANVAS HELPERS (ported verbatim from prototypes/terminal-77)

   fitCanvas / drawGlowLine / seriesToPts / sparkPath — the four primitives
   every chart in the terminal is built from. [S2] LAW: phosphor glow is drawn
   IN CANVAS as multi-pass strokes at decreasing alpha / increasing width —
   never CSS filter:drop-shadow (that class of filter bricked v1 in WKWebView).
   ========================================================================= */

export interface FitResult {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  degenerate: boolean;
}

/** Size a canvas's backing store to its CSS box × devicePixelRatio (capped 2). */
export function fitCanvas(cv: HTMLCanvasElement): FitResult {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect();
  // Guard against degenerate sizes: during the CRT power-off the #screen is
  // scaleY(0.006), so getBoundingClientRect() collapses. Sizing the backing
  // store to that squashes the chart into horizontal bands. Fall back to the
  // element's offset box (unaffected by the transform) when the rect is tiny.
  let w = Math.floor(r.width), h = Math.floor(r.height);
  if (h < 20 || w < 20) { w = cv.offsetWidth || w; h = cv.offsetHeight || h; }
  w = Math.max(2, w); h = Math.max(2, h);
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, degenerate: (r.height < 20 || r.width < 20) };
}

export interface GlowOpts {
  core?: number;
  passes?: { w: number; a: number }[];
}

// [S2] phosphor glow drawn IN CANVAS: multi-pass strokes at decreasing alpha /
// increasing width — no CSS filter:drop-shadow (WKWebView-safe).
export function drawGlowLine(ctx: CanvasRenderingContext2D, pts: [number, number][], color: string, opts: GlowOpts = {}): void {
  const passes = opts.passes || [
    { w: (opts.core || 1.6) + 7, a: 0.06 },
    { w: (opts.core || 1.6) + 4, a: 0.10 },
    { w: (opts.core || 1.6) + 2, a: 0.18 },
    { w: (opts.core || 1.6),     a: 1.0 },
  ];
  passes.forEach((pass) => {
    ctx.beginPath();
    pts.forEach((p, i) => { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.strokeStyle = color; ctx.globalAlpha = pass.a; ctx.lineWidth = pass.w;
    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

/** Map a value series into canvas [x,y] points across the padded plot area. */
export function seriesToPts(series: number[], w: number, h: number, padX: number, padTop: number, padBot: number): [number, number][] {
  const min = Math.min(...series), max = Math.max(...series); const rng = (max - min) || 1;
  return series.map((v, i) => [
    padX + (i / (series.length - 1)) * (w - 2 * padX),
    padTop + (1 - (v - min) / rng) * (h - padTop - padBot),
  ]);
}

/** SVG path `d` for a sparkline (roster cards, idx chips). */
export function sparkPath(series: number[], w: number, h: number, pad = 2): string {
  const n = series.length; const min = Math.min(...series), max = Math.max(...series);
  const rng = (max - min) || 1;
  return series.map((v, i) => {
    const x = pad + (i / (n - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / rng) * (h - 2 * pad);
    return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ");
}
