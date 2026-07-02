import { useEffect, useRef } from "react";
import type { CompareAxis } from "./compareAxes";
import s from "./Compare.module.css";

/**
 * HOLDING RADAR — a static, honest "woodcut-parchment" pentagon for ONE
 * holding in a head-to-head (VISUAL_DIRECTION.md §5 "Compare"; CHART_CRAFT.md
 * radar craft: hand-built canvas-2D, ink-stamp, no chart-junk). Mirrors the
 * Dashboard's PortfolioShapeRadar canvas idiom (fit-to-dpr-capped-at-2, draw
 * ONCE per data change, redraw only on a debounced resize — never a per-frame
 * loop, anti-brick rule) but is a PER-HOLDING shape, not the portfolio shape.
 *
 * The axes are normalised PAIRWISE across the two compared holdings (see
 * compareAxes.ts), so the two silhouettes genuinely diverge. The polygon fill
 * uses the tone passed in ("a"/"b" pigment, defined locally on .screen) so the
 * two cards read as two distinct shapes; per-axis WINNER vertices are stamped
 * amber (the single SDN accent) so the eye lands on which side leads each axis
 * without relying on colour alone (the a11y table + card figures carry it too).
 */

const INK_BROWN = "rgba(43, 36, 28, 0.85)";
const GRID_ALPHA_INNER = "rgba(43, 36, 28, 0.16)";
const GRID_ALPHA_OUTER = "rgba(43, 36, 28, 0.55)";
const SPOKE_ALPHA = "rgba(43, 36, 28, 0.22)";
const LABEL_COLOR = "rgba(43, 36, 28, 0.7)";

function fitCanvas(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const rect = c.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function readCssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function clampFrac(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** hex ("#rrggbb") → rgba() at the given alpha; passes through non-hex. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

function drawRadar(canvas: HTMLCanvasElement, axes: CompareAxis[], accentVar: string, winners: boolean[]) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const n = axes.length;
  if (n < 3) return; // guarded — a degenerate radar is never drawn

  const accent = readCssVar(canvas, accentVar, "#8a7a3a");
  const amber = readCssVar(canvas, "--amber", "#e8842a");
  const cx = w / 2;
  const cy = h / 2 + 4;
  const R = Math.min(w, h) * 0.34;

  const angle = (i: number) => -Math.PI / 2 + i * ((2 * Math.PI) / n);
  const vertex = (i: number, frac: number) => {
    const a = angle(i);
    return [cx + R * frac * Math.cos(a), cy + R * frac * Math.sin(a)];
  };

  // 1. Pentagon grid web — concentric straight-edged rings (honest stamped
  //    boundary, not a faint chart web).
  const ringFracs = [0.25, 0.5, 0.75, 1];
  ringFracs.forEach((frac, ri) => {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = vertex(i % n, frac);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const isOuter = ri === ringFracs.length - 1;
    ctx.strokeStyle = isOuter ? GRID_ALPHA_OUTER : GRID_ALPHA_INNER;
    ctx.lineWidth = isOuter ? 2 : 1;
    ctx.stroke();
  });

  // 2. Spokes.
  for (let i = 0; i < n; i++) {
    const [x, y] = vertex(i, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = SPOKE_ALPHA;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 3. Value polygon — this holding's honest shape at ~52% alpha, ink-outlined.
  ctx.beginPath();
  axes.forEach((axis, i) => {
    const [x, y] = vertex(i, clampFrac(axis.value));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = hexToRgba(accent, 0.52);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 4. Vertex nodes — WINNING axes stamp amber (the single accent) so the
  //    leading axes pop; losing/tie axes stamp the neutral ink-then-accent.
  axes.forEach((axis, i) => {
    const [x, y] = vertex(i, clampFrac(axis.value));
    const win = winners[i];
    ctx.fillStyle = INK_BROWN;
    ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
    ctx.fillStyle = win ? amber : accent;
    ctx.fillRect(x - 2, y - 2, 4, 4);
  });

  // 5. Axis labels — thin ink caption at each rim, ALL-CAPS, condensed.
  ctx.font = "600 8.5px Oswald, sans-serif";
  ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const a = angle(i);
    const lx = cx + (R + 15) * Math.cos(a);
    const ly = cy + (R + 15) * Math.sin(a);
    // Winning axis label goes amber too, so the marker + label agree.
    ctx.fillStyle = winners[i] ? readCssVar(canvas, "--amber-deep", "#c96a1c") : LABEL_COLOR;
    ctx.textAlign = Math.cos(a) > 0.2 ? "left" : Math.cos(a) < -0.2 ? "right" : "center";
    ctx.fillText(axes[i].label.toUpperCase(), lx, ly);
  }
}

export function HoldingRadar({
  axes,
  accentVar,
  winners,
  label,
}: {
  axes: CompareAxis[];
  /** CSS custom property (on .screen) for this side's polygon pigment. */
  accentVar: string;
  /** Per-axis: true when THIS holding wins the axis (marks the vertex amber). */
  winners: boolean[];
  /** Accessible name, e.g. "Nvidia shape". */
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawRadar(canvas, axes, accentVar, winners);

    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (canvasRef.current) drawRadar(canvasRef.current, axes, accentVar, winners);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [axes, accentVar, winners]);

  const ariaInsight = axes.length
    ? `${label}: ${axes.map((a) => `${a.label} ${a.display}`).join(", ")}`
    : `${label}: not enough shared metrics to draw`;

  return (
    <canvas ref={canvasRef} className={s.radarCanvas} role="img" aria-label={ariaInsight} />
  );
}
