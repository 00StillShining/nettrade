import { useEffect, useRef } from "react";
import type { PortfolioShapeAxis } from "./portfolioShape";
import s from "./Dashboard.module.css";

/**
 * PORTFOLIO SHAPE — a static, honest "woodcut-parchment" pentagon radar
 * (CHART_CRAFT.md radar craft: hand-built canvas-2D, ink-stamp, no
 * chart-junk; VISUAL_DIRECTION.md §5 "woodcut-parchment radar — dark-brown
 * grid on cream, one polygon at ~55% alpha"). Deliberately scoped down from
 * the full NtRadar spec (no target ring / expand modal / EXP registry — that
 * infra doesn't exist yet in this codebase); this is the single static
 * Dashboard radar the task calls for.
 *
 * Renders ONCE per data change (fits the backing store to devicePixelRatio,
 * capped at 2, then draws once) — never mounts/unmounts a canvas per render
 * loop, never re-draws on a timer/scroll (anti-brick rule).
 */

const INK_BROWN = "rgba(43, 36, 28, 0.85)"; // dark warm-ink, woodcut grid/spokes
const GRID_ALPHA_INNER = "rgba(43, 36, 28, 0.16)";
const GRID_ALPHA_OUTER = "rgba(43, 36, 28, 0.55)";
const SPOKE_ALPHA = "rgba(43, 36, 28, 0.22)";
const LABEL_COLOR = "rgba(43, 36, 28, 0.7)";
// Olive/green parchment polygon — VISUAL_DIRECTION §5 radar --radar-* family
// (--radar-max #8a7a3a, olive/gold; the woodcut-parchment tone). Read at draw
// time so it tracks tokens.css without hard-coding a hex here.
const ACCENT_VAR = "--radar-max";

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

function drawRadar(canvas: HTMLCanvasElement, axes: PortfolioShapeAxis[]) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const n = axes.length;
  if (n < 3) return; // guarded — a degenerate radar is never drawn

  const accent = readCssVar(canvas, ACCENT_VAR, "#8a7a3a");
  const cx = w / 2;
  const cy = h / 2 + 6; // nudge down slightly to leave room for the title above
  const R = Math.min(w, h) * 0.36;

  const angle = (i: number) => -Math.PI / 2 + i * ((2 * Math.PI) / n);
  const vertex = (i: number, frac: number) => {
    const a = angle(i);
    return [cx + R * frac * Math.cos(a), cy + R * frac * Math.sin(a)];
  };

  // 1. Pentagon grid web — concentric straight-edged rings at 25/50/75/100%,
  // NOT circles (honest stamped-boundary grammar, not a faint chart web).
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

  // 2. Spokes — hairline center-to-vertex on each axis.
  for (let i = 0; i < n; i++) {
    const [x, y] = vertex(i, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = SPOKE_ALPHA;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 3. Value polygon — the one honest data shape, filled at ~55% alpha
  // (VISUAL_DIRECTION §5), ink-outlined so it reads as a stamped shape.
  ctx.beginPath();
  axes.forEach((axis, i) => {
    const [x, y] = vertex(i, clampFrac(axis.value));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = hexToRgba(accent, 0.55);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Vertex nodes — small ink-then-accent stamped squares.
  axes.forEach((axis, i) => {
    const [x, y] = vertex(i, clampFrac(axis.value));
    ctx.fillStyle = INK_BROWN;
    ctx.fillRect(x - 3, y - 3, 6, 6);
    ctx.fillStyle = accent;
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  });

  // 4. Axis labels — thin ink caption at each rim, ALL-CAPS, condensed.
  ctx.font = "600 9px Oswald, sans-serif";
  ctx.fillStyle = LABEL_COLOR;
  ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const a = angle(i);
    const lx = cx + (R + 16) * Math.cos(a);
    const ly = cy + (R + 16) * Math.sin(a);
    const label = axes[i].label.toUpperCase();
    ctx.textAlign = Math.cos(a) > 0.2 ? "left" : Math.cos(a) < -0.2 ? "right" : "center";
    ctx.fillText(label, lx, ly);
  }
}

function clampFrac(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Accepts either a bare hex ("#2a9d9d") or an already-valid CSS colour and
 * returns an rgba() string at the given alpha. Falls back to the accent at
 * full alpha wrapped in rgba if parsing fails (never throws mid-render). */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex; // already rgba()/named colour from a custom-configured token
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function PortfolioShapeRadar({ axes }: { axes: PortfolioShapeAxis[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Draw once per data change — not a per-frame loop (anti-brick rule).
    drawRadar(canvas, axes);

    // Re-draw once on resize (debounced via rAF) so the radar stays crisp if
    // the window is resized — still not a per-frame/continuous loop.
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (canvasRef.current) drawRadar(canvasRef.current, axes);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [axes]);

  const ariaInsight = axes.length
    ? `Portfolio shape across ${axes.map((a) => `${a.label} ${Math.round(a.value * 100)}%`).join(", ")}`
    : "Portfolio shape: no positions yet";

  return (
    <div className={s.radarWrap}>
      <div className={s.radarTitle}>Portfolio Shape</div>
      <canvas ref={canvasRef} className={s.radarCanvas} role="img" aria-label={ariaInsight} />
      <table className={s.visuallyHidden}>
        <caption>Portfolio shape — five axes derived from current holdings</caption>
        <thead>
          <tr>
            <th scope="col">Axis</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {axes.map((a) => (
            <tr key={a.key}>
              <td>{a.label}</td>
              <td>{Math.round(a.value * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={s.radarSub}>current holdings · health radar arrives with the Performance engine</div>
    </div>
  );
}
