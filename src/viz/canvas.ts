/**
 * Shared canvas primitives — the pure, screen-agnostic helpers that were
 * byte-identical in both Dashboard.tsx and Positions.tsx. Extracted here so the
 * two data screens import ONE copy. Nothing screen-specific lives in this file:
 * the only literal it bakes in is the INK colour (#14110D), which was identical
 * in both screens' local copies of drawDotCluster.
 */

export type Ctx = CanvasRenderingContext2D;
export type Fit = { ctx: Ctx; w: number; h: number };

const INK = "#14110D";

export function line(ctx: Ctx, pts: number[][], col: string, w: number) {
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
}

/* size a canvas's backing store to its CSS box * dpr and pre-scale the ctx */
export function fitCanvas(c: HTMLCanvasElement): Fit {
  const r = c.getBoundingClientRect();
  let w = Math.max(1, Math.round(r.width)),
    h = Math.max(1, Math.round(r.height));
  if (!w || !h) {
    w = c.width || 300;
    h = c.height || 150;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function drawDotCluster(c: HTMLCanvasElement, fade: (x: number, y: number) => number) {
  const ctx = c.getContext("2d")!;
  const W = c.width,
    H = c.height;
  ctx.clearRect(0, 0, W, H);
  const step = 15,
    r = 2.0;
  for (let row = 0, y = 0; y < H; y += step, row++) {
    for (let x = 0; x < W; x += step) {
      const d = fade(x / W, y / H);
      if (Math.random() > d) continue;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x + (row % 2 ? step / 2 : 0), y, r, 0, 7);
      ctx.fill();
    }
  }
}

/* small ▲/▼ triangle drawn as a canvas path (never an emoji glyph) */
export function triCanvas(ctx: Ctx, x: number, y: number, size: number, up: boolean, col: string) {
  ctx.fillStyle = col;
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x - size, y + size);
  } else {
    ctx.moveTo(x, y + size);
    ctx.lineTo(x + size, y - size);
    ctx.lineTo(x - size, y - size);
  }
  ctx.closePath();
  ctx.fill();
}
