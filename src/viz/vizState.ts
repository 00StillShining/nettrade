/**
 * Shared in-frame VIZ STATE overlay — the 4 mandated chart states from
 * docs/CHART_CRAFT.md §10 / §12, drawn ON the same <canvas> as the real viz so a
 * chart never reflows its tile. Branch on STATE, not on data presence.
 *
 *   "live"    — the real draw runs untouched (default).
 *   "empty"   — stamped ink message + CTA, no bare axes.
 *   "loading" — a skeleton in the viz's OWN silhouette (dashed hollow ink marks)
 *               + one hard-edged translateX sweep (the sole sanctioned loop).
 *   "error"   — stamped ink cause + an --orange Retry chip (orange = warning role,
 *               never the accent).
 *   "stale"   — the REAL draw(c,big) is rendered first (dimmed via globalAlpha),
 *               then a dashed-ink hatch band + an Intl "STALE · {age}" chip on top.
 *
 * The screen passes a single `state` (default "live") into each draw fn; the draw
 * fn calls `applyVizState(...)` which returns `false` when it fully handled the
 * frame (empty/loading/error) so the real drawing is skipped, or `true` when the
 * real draw should still run (live, or stale's dimmed underlay + post-hatch).
 */

import { fitCanvas, type Ctx } from "./canvas";

export type VizState = "live" | "empty" | "loading" | "error" | "stale";

const INK = "#14110D";
const ORANGE = "#FF5A1F";
const CREAM2 = "#F2ECE0";
const HATCH = "rgba(20,17,13,.5)";

/* one hard-edged sweep phase shared by every loading skeleton (sole loop) */
let sweepRAF = 0;
const sweepSubs = new Set<() => void>();
export function startVizLoadingLoop(redrawAll: () => void) {
  sweepSubs.add(redrawAll);
  if (sweepRAF) return () => sweepSubs.delete(redrawAll);
  const tick = () => {
    sweepSubs.forEach((fn) => fn());
    sweepRAF = sweepSubs.size ? requestAnimationFrame(tick) : 0;
  };
  sweepRAF = requestAnimationFrame(tick);
  return () => {
    sweepSubs.delete(redrawAll);
    if (!sweepSubs.size && sweepRAF) {
      cancelAnimationFrame(sweepRAF);
      sweepRAF = 0;
    }
  };
}
const sweepPhase = () => (performance.now() % 1400) / 1400;

function stamp(ctx: Ctx, x: number, y: number, text: string, font: string, col: string, align: CanvasTextAlign) {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.fillStyle = "rgba(20,17,13,.28)";
  ctx.fillText(text, x + 2, y + 2);
  ctx.fillStyle = col;
  ctx.fillText(text, x, y);
}

/* dashed hollow ghost line across the plot — the loading silhouette */
function ghostLine(ctx: Ctx, W: number, H: number, big: boolean) {
  const padL = big ? 70 : 40,
    padR = big ? 40 : 24,
    padT = big ? 40 : Math.min(110, H * 0.28),
    padB = big ? 50 : 40;
  const x0 = padL,
    x1 = W - padR,
    y0 = padT,
    y1 = H - padB;
  ctx.save();
  ctx.strokeStyle = "rgba(20,17,13,.12)";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const yy = y0 + ((y1 - y0) * g) / 4;
    ctx.beginPath();
    ctx.moveTo(x0, yy);
    ctx.lineTo(x1, yy);
    ctx.stroke();
  }
  ctx.setLineDash([7, 6]);
  ctx.strokeStyle = "rgba(20,17,13,.34)";
  ctx.lineWidth = big ? 4 : 2.5;
  const pts = 7;
  ctx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const x = x0 + ((x1 - x0) * i) / pts;
    const y = y0 + (y1 - y0) * (0.5 + 0.32 * Math.sin(i * 0.9 + 0.6));
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // one hard-edged sweep band
  const ph = sweepPhase();
  const bw = (x1 - x0) * 0.18;
  const bx = x0 - bw + (x1 - x0 + bw * 2) * ph;
  ctx.fillStyle = "rgba(20,17,13,.06)";
  ctx.fillRect(Math.max(x0, bx), y0, Math.min(bw, x1 - Math.max(x0, bx)), y1 - y0);
  ctx.restore();
}

/* dashed-ink hatch band + stale chip, painted OVER the dimmed real draw */
export function drawStaleHatch(ctx: Ctx, W: number, H: number, big: boolean, age: string) {
  ctx.save();
  ctx.globalAlpha = 1;
  // hatch band across the top inside edge
  const bandH = big ? 18 : 12;
  ctx.fillStyle = "rgba(20,17,13,.06)";
  ctx.fillRect(0, 0, W, bandH);
  ctx.strokeStyle = HATCH;
  ctx.lineWidth = 1;
  for (let x = -H; x < W; x += big ? 12 : 9) {
    ctx.beginPath();
    ctx.moveTo(x, bandH);
    ctx.lineTo(x + bandH, 0);
    ctx.stroke();
  }
  // STALE · age chip (square, ink border, hard offset)
  const txt = "STALE · " + age;
  ctx.font = (big ? "700 13px" : "700 10px") + " 'Space Mono'";
  ctx.textAlign = "left";
  const tw = ctx.measureText(txt).width;
  const px = big ? 14 : 10,
    chH = big ? 24 : 18;
  const cx = W - tw - px * 2 - (big ? 12 : 8),
    cy = big ? 8 : 6;
  ctx.fillStyle = INK;
  ctx.fillRect(cx + 3, cy + 3, tw + px * 2, chH);
  ctx.fillStyle = ORANGE;
  ctx.fillRect(cx, cy, tw + px * 2, chH);
  ctx.fillStyle = INK;
  ctx.fillText(txt, cx + px, cy + chH * 0.68);
  ctx.restore();
}

/**
 * Returns true if the caller should still run its real draw(c,big) AFTER this
 * (live → on a clean frame; stale → on a dimmed frame, then call drawStaleHatch).
 * Returns false if this fully painted the frame (empty / loading / error).
 *
 * For stale, the caller dims via the returned alpha (already set on ctx) — it
 * should reset ctx.globalAlpha = 1 and call drawStaleHatch(...) once its marks
 * are down. `staleAge` defaults to a relative label.
 */
export function applyVizState(
  c: HTMLCanvasElement,
  big: boolean,
  state: VizState,
  opts?: { emptyMsg?: string; cta?: string; errorMsg?: string; staleAge?: string; label?: string },
): boolean {
  if (state === "live") return true;
  if (state === "stale") {
    // caller draws the real viz dimmed; set the alpha and let it run
    const ctx = c.getContext("2d");
    if (ctx) ctx.globalAlpha = 0.55;
    return true;
  }
  const { ctx, w: W, h: H } = fitCanvas(c);
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2,
    cy = H / 2;
  if (state === "loading") {
    ghostLine(ctx, W, H, big);
    stamp(
      ctx,
      cx,
      H - (big ? 18 : 12),
      "LOADING…",
      (big ? "700 14px" : "700 10px") + " 'Space Mono'",
      "rgba(20,17,13,.5)",
      "center",
    );
    return false;
  }
  if (state === "empty") {
    const msg = opts?.emptyMsg ?? "NO DATA YET";
    const cta = opts?.cta ?? "Fund the account to grow your curve";
    stamp(ctx, cx, cy - (big ? 8 : 4), msg, (big ? "900 30px" : "900 18px") + " 'Anton'", INK, "center");
    stamp(
      ctx,
      cx,
      cy + (big ? 26 : 16),
      cta,
      (big ? "600 14px" : "600 10px") + " 'Oswald'",
      "rgba(20,17,13,.6)",
      "center",
    );
    return false;
  }
  // error
  const msg = opts?.errorMsg ?? "COULD NOT LOAD";
  stamp(ctx, cx, cy - (big ? 14 : 9), msg, (big ? "900 26px" : "900 16px") + " 'Anton'", INK, "center");
  // Retry chip in --orange (warning role)
  const rtxt = "↻ RETRY";
  ctx.font = (big ? "700 15px" : "700 11px") + " 'Oswald'";
  ctx.textAlign = "center";
  const rw = ctx.measureText(rtxt).width + (big ? 36 : 26);
  const rh = big ? 34 : 24;
  const rx = cx - rw / 2,
    ry = cy + (big ? 8 : 5);
  ctx.fillStyle = INK;
  ctx.fillRect(rx + 4, ry + 4, rw, rh);
  ctx.fillStyle = ORANGE;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.fillStyle = CREAM2;
  ctx.fillText(rtxt, cx, ry + rh * 0.68);
  return false;
}
