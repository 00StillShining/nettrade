import { useEffect, useMemo, useRef, useState } from "react";
import type { TimeSeriesPoint } from "../../engine/types";
import { fmtMinor, Triangle } from "../shared/format";
import s from "./ValueChart.module.css";

/**
 * ValueChart — the honest canvas equity curve (docs/CHART_CRAFT.md's
 * ValueChart craft spec + VISUAL_DIRECTION.md §5 Performance "splash").
 * Renders ONLY the caller-supplied `value`/`netDeposits` series — a sparse
 * or empty series is the CORRECT, honest output for a new user (never
 * fabricated/interpolated). Per-screen accent = lime (the Performance
 * binding in CHART_CRAFT's pigment map); the net-deposits benchmark is
 * always the dashed --purple reference, never a solid fill.
 *
 * NOTE ON THE OLD CRAFT-DOC LOOK: CHART_CRAFT.md's ValueChart section was
 * written for the retired "cream & pigment / comic-collage" language
 * (parallelogram tiles, `.tlHead`/`.ex` expand chip, EXP modal registry).
 * That infrastructure doesn't exist in this rebuild — this component takes
 * the CRAFT (3-pass ink/accent-dk/accent line, purple dashed benchmark,
 * ink+accent node squares, data-derived y-domain, scrub layer, 4 states,
 * aria) and skins it onto the current SDN cream-panel look
 * (SCREEN_PATTERNS.md §7): no click-to-expand modal, no marble — just the
 * canvas splash inside the Performance dossier's left panel.
 */

export type ChartState = "loading" | "error" | "empty" | "ready";

export interface ValueChartStats {
  currentValueMinor: number | null;
  netContributionsMinor: number | null;
  trueGainMinor: number | null;
  trueGainPct: number | null;
  periodHighMinor: number | null;
  periodLowMinor: number | null;
}

export interface ValueChartProps {
  /** The plotted "your value" series — engine's valueSeries() output, already
   * filtered to the active period. Empty array -> "empty" state. */
  value: TimeSeriesPoint[];
  /** The plotted "merely deposited" benchmark — engine's netDepositsSeries()
   * output, already filtered to the active period. */
  netDeposits: TimeSeriesPoint[];
  stats: ValueChartStats;
  state: ChartState;
  onRetry?: () => void;
  accent?: "lime" | "teal";
  currency: string;
  locale?: string;
  className?: string;
}

interface PlotPoint {
  atISO: string;
  x: number;
  valueMinor: number | null;
  netDepositsMinor: number | null;
}

const INK = "#2b241c";
const PAD_L = 54; // room for the £ axis labels
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 22;

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

/** Axis tick label — compact Intl notation (£1.2k / £550), never a
 * hard-coded "/1000" that misreads small accounts as all-zero (CHART_CRAFT
 * §9 honesty: gridline step must stay readable at ANY domain range). */
function fmtAxisTick(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(0)}`;
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Merge the two series onto one honest, chronologically-sorted x-axis: every
 * distinct dated point from EITHER series gets a slot; a series with no
 * observation at that date carries `null` there (drawn as a gap, never
 * interpolated — CHART_CRAFT §9 honesty contract / series.ts's no-fabrication
 * rule). This is what lets value/netDeposits be sampled on different real
 * dates (e.g. deposits land on the 15th, snapshots on the 1st) without
 * inventing a value for either series on the other's date. */
function mergeAxis(value: TimeSeriesPoint[], netDeposits: TimeSeriesPoint[]): PlotPoint[] {
  const dates = Array.from(new Set([...value.map((p) => p.atISO), ...netDeposits.map((p) => p.atISO)])).sort();
  const valueMap = new Map(value.map((p) => [p.atISO, p.valueMinor]));
  const depositsMap = new Map(netDeposits.map((p) => [p.atISO, p.valueMinor]));
  return dates.map((atISO, i) => ({
    atISO,
    x: i,
    valueMinor: valueMap.get(atISO) ?? null,
    netDepositsMinor: depositsMap.get(atISO) ?? null,
  }));
}

/** The tooltip's horizontal translateX%, clamped so a tooltip anchored near
 * the plot's left/right edge never overflows the panel: fully centered
 * (-50%) in the middle of the plot, sliding to fully left-aligned (0%) near
 * x=0 and fully right-aligned (-100%) near the last point. */
function tooltipXOffsetPct(x: number, count: number): number {
  if (count <= 1) return -50;
  const frac = x / (count - 1);
  // Ramp over the outer ~15% of the plot on each side; flat -50% in the middle.
  const EDGE = 0.15;
  if (frac < EDGE) return -50 * (frac / EDGE);
  if (frac > 1 - EDGE) return -50 - 50 * ((frac - (1 - EDGE)) / EDGE);
  return -50;
}

/**
 * drawChart — the hand-built canvas draw, following CHART_CRAFT's ValueChart
 * idiom (3-pass ink/accent-dk/accent line, area gradient, purple dashed
 * deposits benchmark + faint area, ink+accent node squares, data-derived
 * y-domain, house-texture gridline beat). `progress` (0..1) drives the
 * one-shot entrance redraw (CANVAS redraw, not a DOM/CSS animation).
 */
function drawChart(
  canvas: HTMLCanvasElement,
  points: PlotPoint[],
  progress: number,
  depositsProgress: number,
  scrubIndex: number | null,
  currency: string,
) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (points.length === 0) return;

  const accent = readCssVar(canvas, "--accent", "#7a9a3a");
  const accentDk = readCssVar(canvas, "--accent-dk", "#5c7529");
  const purple = readCssVar(canvas, "--purple", "#5d5a86");
  const gridAlpha = "rgba(43, 36, 28, 0.12)";
  const ruleAlpha = "rgba(43, 36, 28, 0.18)";
  const tickText = "rgba(43, 36, 28, 0.66)";

  const plotW = Math.max(1, w - PAD_L - PAD_R);
  const plotH = Math.max(1, h - PAD_T - PAD_B);

  // ---- Data-derived y-domain (CHART_CRAFT §9): min/max from value ∪
  // netDeposits, honest labelled padding, NEVER a fixed range so a different
  // account can't be drawn dishonestly. Per CHART_CRAFT §12/§9: "if the
  // domain doesn't include zero, that is a labelled value-axis range, not a
  // hidden truncation" — so the domain is NOT force-anchored to zero (that
  // would waste vertical resolution on accounts whose whole history sits
  // well above £0, e.g. a mock/real account that never dipped near zero);
  // the axis labels (fmtAxisTick, drawn at every gridline) are what makes a
  // non-zero-including range honest rather than a silent truncation.
  const allVals: number[] = [];
  for (const p of points) {
    if (p.valueMinor !== null) allVals.push(p.valueMinor);
    if (p.netDepositsMinor !== null) allVals.push(p.netDepositsMinor);
  }
  if (allVals.length === 0) return;
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const span = Math.max(rawMax - rawMin, 1);
  const pad = span * 0.08;
  const domainMin = rawMin - pad;
  const domainMax = rawMax + pad;
  const domainSpan = Math.max(domainMax - domainMin, 1);

  const xOf = (i: number) => PAD_L + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const yOf = (v: number) => PAD_T + plotH - ((v - domainMin) / domainSpan) * plotH;

  // 1. Gridlines — quiet sub-layer, dashed structural rule + Space-Mono £ labels.
  const steps = 4;
  ctx.font = "600 10px 'Space Mono', monospace";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= steps; i++) {
    const v = domainMin + (domainSpan * i) / steps;
    const y = yOf(v);
    ctx.strokeStyle = i === 0 ? ruleAlpha : gridAlpha;
    ctx.lineWidth = i === 0 ? 1.5 : 1;
    if (i === 0) {
      ctx.setLineDash([6, 4]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(w - PAD_R, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = tickText;
    ctx.textAlign = "right";
    ctx.fillText(fmtAxisTick(v, currency), PAD_L - 8, y);
  }

  // 2. Net-deposits benchmark — faint purple area + dashed purple line
  // (never a solid fill; reference only). Staggered opacity via
  // depositsProgress so it draws in slightly behind the value line.
  const depositPoints = points.filter((p) => p.netDepositsMinor !== null);
  if (depositPoints.length > 0) {
    ctx.globalAlpha = depositsProgress;
    if (depositPoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(xOf(depositPoints[0].x), h - PAD_B);
      for (const p of depositPoints) ctx.lineTo(xOf(p.x), yOf(p.netDepositsMinor!));
      ctx.lineTo(xOf(depositPoints[depositPoints.length - 1].x), h - PAD_B);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(purple, 0.16);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = purple;
    ctx.lineWidth = 2;
    depositPoints.forEach((p, i) => {
      const x = xOf(p.x);
      const y = yOf(p.netDepositsMinor!);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // ---- The value series, honestly (SPARSE-aware): consecutive REAL
  // observations are connected; null slots exist only where the OTHER series
  // has a point, so no unobserved value is ever invented between two missing
  // snapshots (series.ts's no-fabrication rule extends to the draw layer too).
  const valuePoints = points.filter((p) => p.valueMinor !== null);
  const progressCount = Math.max(0, Math.round(valuePoints.length * progress));
  const visibleValuePoints = valuePoints.slice(0, progressCount === 0 && progress > 0 ? 1 : progressCount);

  if (visibleValuePoints.length >= 2) {
    // 3. Value area — accent vertical gradient.
    const grad = ctx.createLinearGradient(0, PAD_T, 0, h - PAD_B);
    grad.addColorStop(0, hexToRgba(accent, 0.32));
    grad.addColorStop(1, hexToRgba(accent, 0.03));
    ctx.beginPath();
    ctx.moveTo(xOf(visibleValuePoints[0].x), h - PAD_B);
    for (const p of visibleValuePoints) ctx.lineTo(xOf(p.x), yOf(p.valueMinor!));
    ctx.lineTo(xOf(visibleValuePoints[visibleValuePoints.length - 1].x), h - PAD_B);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 4. Value line, 3 passes: ink shadow -> accent-dk underline -> accent overline.
    const strokeLine = (color: string, width: number, offset: number) => {
      ctx.beginPath();
      visibleValuePoints.forEach((p, i) => {
        const x = xOf(p.x) + offset;
        const y = yOf(p.valueMinor!) + offset;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    };
    strokeLine("rgba(43, 36, 28, 0.25)", 3, 2);
    strokeLine(accentDk, 3.5, 0);
    strokeLine(accent, 2, 0);
  } else if (visibleValuePoints.length === 1) {
    // SPARSE state (1 real point): draw the single honest point, no line.
    // (handled by the node-square pass below)
  }

  // 5. Node squares — ink then accent, at each REAL observed point (not
  // every merged-axis slot) so sparse data reads as honest dots, never a
  // fabricated dense line.
  for (const p of visibleValuePoints) {
    const x = xOf(p.x);
    const y = yOf(p.valueMinor!);
    const isScrubbed = scrubIndex !== null && p.x === scrubIndex;
    const size = isScrubbed ? 5 : 3;
    ctx.fillStyle = INK;
    ctx.fillRect(x - size - 1, y - size - 1, (size + 1) * 2, (size + 1) * 2);
    ctx.fillStyle = accent;
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
  }

  // Scrub crosshair — ink dashed vertical rule at the scrubbed index.
  if (scrubIndex !== null) {
    const scrubPoint = points.find((p) => p.x === scrubIndex);
    if (scrubPoint) {
      const x = xOf(scrubPoint.x);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(43, 36, 28, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, h - PAD_B);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 6. X-axis labels — first / last dated point, Space Mono. The formatter is
  // SPAN-AWARE (see makeDateLabeller) so a short window (e.g. a 1M filter)
  // shows day-level dates rather than two merged points both rounding to the
  // same "Jun 26" month label — ambiguous labels are their own honesty bug
  // (CHART_CRAFT §11: the aria/label must match the actually-drawn series).
  const labelFor = makeDateLabeller(points);
  ctx.fillStyle = tickText;
  ctx.textBaseline = "alphabetic";
  ctx.font = "600 10px 'Space Mono', monospace";
  if (points.length > 0) {
    ctx.textAlign = "left";
    ctx.fillText(labelFor(points[0].atISO), PAD_L, h - 6);
    ctx.textAlign = "right";
    ctx.fillText(labelFor(points[points.length - 1].atISO), w - PAD_R, h - 6);
  }
}

/** Builds a date label formatter whose granularity matches the actual span of
 * `points` — day-level ("15 Jun") when the window is short enough that
 * month-level labels would collide/repeat (e.g. a 1M period filter), else
 * month-level ("Jun 26"). Re-created per draw (cheap: one Intl instance) so
 * it always reflects the CURRENT point set rather than a stale global cache
 * keyed only on locale. */
function makeDateLabeller(points: PlotPoint[]): (iso: string) => string {
  const locale = navigator.language || "en-GB";
  const ms = points.map((p) => new Date(p.atISO).getTime()).filter((n) => !Number.isNaN(n));
  const spanDays = ms.length >= 2 ? (Math.max(...ms) - Math.min(...ms)) / 86_400_000 : Infinity;
  const fmt = new Intl.DateTimeFormat(
    locale,
    spanDays < 60 ? { day: "numeric", month: "short" } : { month: "short", year: "2-digit" },
  );
  return (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return fmt.format(d);
  };
}

/** Derives the worded key-insight aria-label from stats via Intl (CHART_CRAFT
 * §11) — never a hard-coded example, always templated from the real numbers. */
function ariaSummaryFrom(stats: ValueChartStats, points: PlotPoint[], currency: string, locale: string): string {
  const n = points.filter((p) => p.valueMinor !== null).length;
  if (n === 0) return "No performance history recorded yet.";
  const money = (m: number | null) => (m === null ? "an unknown amount" : fmtMinor(m, currency));
  const gainWord =
    stats.trueGainMinor === null
      ? ""
      : stats.trueGainMinor >= 0
        ? `up ${money(Math.abs(stats.trueGainMinor))}`
        : `down ${money(Math.abs(stats.trueGainMinor))}`;
  const pctWord =
    stats.trueGainPct === null
      ? ""
      : ` (${stats.trueGainPct >= 0 ? "+" : "−"}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.abs(stats.trueGainPct * 100))}%)`;
  return `Portfolio value ${money(stats.currentValueMinor)}, ${gainWord}${pctWord} all-time versus ${money(stats.netContributionsMinor)} net deposits; ${n} recorded point${n === 1 ? "" : "s"} in the selected window.`;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function ValueChart({
  value,
  netDeposits,
  stats,
  state,
  onRetry,
  accent = "lime",
  currency,
  locale,
  className,
}: ValueChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();
  const resolvedLocale = locale || navigator.language || "en-GB";

  const points = useMemo(() => mergeAxis(value, netDeposits), [value, netDeposits]);
  // Same span-aware labeller the canvas draw uses, so the DOM tooltip + the
  // visually-hidden data-mirror table never disagree with the drawn axis
  // labels (CHART_CRAFT §11: the label must match the drawn series).
  const labelFor = useMemo(() => makeDateLabeller(points), [points]);
  const realValueCount = useMemo(() => points.filter((p) => p.valueMinor !== null).length, [points]);
  const effectiveState: ChartState = state === "ready" && realValueCount === 0 ? "empty" : state;
  const isSparse = effectiveState === "ready" && realValueCount > 0 && realValueCount <= 2;

  // ---- One-shot progressive entrance (canvas redraw of a 0->1 progress var,
  // NOT a DOM/CSS animation — CHART_CRAFT §7 / actuality-ui skill §4). After
  // it completes the chart is static: no loop, no re-animate.
  const [progress, setProgress] = useState(reducedMotion ? 1 : 0);
  const [depositsProgress, setDepositsProgress] = useState(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (effectiveState !== "ready" || realValueCount === 0) return;
    if (reducedMotion) {
      setProgress(1);
      setDepositsProgress(1);
      return;
    }
    setProgress(0);
    setDepositsProgress(0);
    let raf = 0;
    const start = performance.now();
    const DUR = 420;
    const DEPOSIT_STAGGER = 120;
    const tick = (now: number) => {
      const t = now - start;
      setProgress(Math.min(1, t / DUR));
      setDepositsProgress(Math.min(1, Math.max(0, t - DEPOSIT_STAGGER) / DUR));
      if (t < DUR + DEPOSIT_STAGGER) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entrance should
    // re-run only when the underlying data identity changes, not every render.
  }, [points, effectiveState, realValueCount, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || effectiveState !== "ready") return;
    drawChart(canvas, points, progress, depositsProgress, scrubIndex, currency);

    // Re-draw once webfonts land (CHART_CRAFT §4: draw only after
    // document.fonts.ready). The animated entrance self-heals via its rAF
    // redraws, but the prefers-reduced-motion path draws exactly ONCE — a
    // first paint before Space Mono loads would otherwise leave the axis/£
    // labels permanently in the fallback monospace.
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled && canvasRef.current) {
        drawChart(canvasRef.current, points, progress, depositsProgress, scrubIndex, currency);
      }
    });

    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (canvasRef.current) drawChart(canvasRef.current, points, progress, depositsProgress, scrubIndex, currency);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [points, progress, depositsProgress, scrubIndex, effectiveState, currency]);

  const scrubbedPoint = scrubIndex !== null ? points.find((p) => p.x === scrubIndex) ?? null : null;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (points.length === 0 || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const plotW = Math.max(1, rect.width - PAD_L - PAD_R);
    const frac = Math.min(1, Math.max(0, (relX - PAD_L) / plotW));
    const idx = Math.round(frac * (points.length - 1));
    setScrubIndex(Math.min(points.length - 1, Math.max(0, idx)));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const current = scrubIndex ?? points.length - 1;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setScrubIndex(Math.max(0, current - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setScrubIndex(Math.min(points.length - 1, current + 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setScrubIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setScrubIndex(points.length - 1);
    }
  };

  const ariaLabel = ariaSummaryFrom(stats, points, currency, resolvedLocale);

  return (
    <div className={`${s.wrap} ${className ?? ""}`} data-accent={accent}>
      {effectiveState === "loading" && (
        <div className={s.stateBox}>
          <div className={s.skeletonLine} />
          <div className={s.skeletonLine} style={{ width: "70%" }} />
          <div className={s.skeletonLine} style={{ width: "40%" }} />
        </div>
      )}

      {effectiveState === "error" && (
        <div className={s.stateBox}>
          <p className={s.stateMsg}>Couldn&rsquo;t load your performance history.</p>
          {onRetry && (
            <button type="button" className={s.retryBtn} onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}

      {effectiveState === "empty" && (
        <div className={s.stateBox}>
          <p className={s.stateMsg}>
            No history yet — Actuality records your value each sync; your curve grows from here.
          </p>
        </div>
      )}

      {effectiveState === "ready" && (
        <>
          <div className={s.plotBody} ref={wrapRef}>
            <canvas ref={canvasRef} className={s.canvas} role="img" aria-label={ariaLabel} />
            <div
              className={s.scrubLayer}
              tabIndex={0}
              role="slider"
              aria-label="Scrub the equity curve by period"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, points.length - 1)}
              aria-valuenow={scrubIndex ?? Math.max(0, points.length - 1)}
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerMove}
              onPointerLeave={() => setScrubIndex(null)}
              onKeyDown={handleKeyDown}
              onFocus={() => setScrubIndex((i) => i ?? points.length - 1)}
              onBlur={() => setScrubIndex(null)}
            />
            {isSparse && (
              <div className={s.sparseNote}>Only {realValueCount} recorded point{realValueCount === 1 ? "" : "s"} so far — your curve grows as Actuality syncs.</div>
            )}
            {scrubbedPoint && (scrubbedPoint.valueMinor !== null || scrubbedPoint.netDepositsMinor !== null) && (
              <div
                className={s.tooltip}
                style={{
                  left: `${points.length > 1 ? (scrubbedPoint.x / (points.length - 1)) * 100 : 50}%`,
                  // Anchor edge scales from centered -> left-aligned near the
                  // plot's left edge -> right-aligned near its right edge, so
                  // the square tooltip never overflows the panel while
                  // scrubbing the first/last points.
                  transform: `translateX(${tooltipXOffsetPct(scrubbedPoint.x, points.length)}%)`,
                }}
              >
                <div className={s.tooltipDate}>{labelFor(scrubbedPoint.atISO)}</div>
                {scrubbedPoint.valueMinor !== null ? (
                  <>
                    <div className={s.tooltipValue}>{fmtMinor(scrubbedPoint.valueMinor, currency)}</div>
                    {scrubbedPoint.netDepositsMinor !== null &&
                      (() => {
                        const delta = scrubbedPoint.valueMinor! - scrubbedPoint.netDepositsMinor!;
                        const zero = delta === 0;
                        return (
                          <div className={zero ? s.tooltipDelta : `${s.tooltipDelta} ${delta > 0 ? s.gain : s.loss}`}>
                            {!zero && <Triangle up={delta > 0} className={s.tooltipTri} />}
                            {zero ? "±" : delta > 0 ? "+" : "−"}
                            {fmtMinor(Math.abs(delta), currency)} vs deposits
                          </div>
                        );
                      })()}
                  </>
                ) : (
                  // No value SNAPSHOT landed on this exact date (honest —
                  // never fabricated) — still show the real net-deposits
                  // reading that DID land here, rather than a blank tooltip.
                  <div className={s.tooltipDelta}>
                    {fmtMinor(scrubbedPoint.netDepositsMinor!, currency)} deposited &middot; no value sync this date
                  </div>
                )}
              </div>
            )}
          </div>
          <table className={s.visuallyHidden}>
            <caption>Portfolio value vs net deposits by period</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Value</th>
                <th scope="col">Net deposits</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.atISO}>
                  <td>{labelFor(p.atISO)}</td>
                  <td>{p.valueMinor !== null ? fmtMinor(p.valueMinor, currency) : "—"}</td>
                  <td>{p.netDepositsMinor !== null ? fmtMinor(p.netDepositsMinor, currency) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default ValueChart;
