/* =========================================================================
   TERMINAL 77 — RADAR (the pentagon fingerprint, ported from drawRadar)

   One component, two modes:
     staged=true  (Positions FINGERPRINT): label chips only; the polygon
                  tweens as an order is staged (VOLATILITY/SENTIMENT bump).
     staged=false (Watchlist / reference): numeric axis values at vertices.

   SVG, 200ms rAF tween toward the target scores, reduced-motion gate (dur=0).
   The tween state is keyed by `id` in a module map — exactly the prototype's
   radarAnim[wrap.id] — so remounts resume from the last displayed shape and
   two radars on one screen never share a tween.

   Rendering is IMPERATIVE (innerHTML into a ref'd .radar-wrap), a verbatim
   port of the prototype's string-built SVG: React owns the wrapper div only,
   so the rAF tween can rewrite polygon points every frame without fighting
   the reconciler. Redraws on prop change AND on every DataEngine tick
   (radar axes read dayPct, which walks every 1–2s).
   ========================================================================= */

import { useEffect, useRef } from "react";
import { DataEngine, RADAR_AXES, radarScores, clamp, lerp, type RadarAxis } from "../engine/dataEngine";
import { prefersReduced } from "../bus";

type Scores = Record<RadarAxis, number>;
const radarAnim: Record<string, Scores> = {}; // id -> currently DISPLAYED scores (tween source)

function pentaPoint(cx: number, cy: number, r: number, i: number, val: number): [number, number] {
  const ang = -Math.PI / 2 + i * (2 * Math.PI / 5);
  const rr = r * (val / 10);
  return [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr];
}

// wide viewBox with generous margins so outboard label chips never clip
const W = 360, H = 320, CX = 180, CY = 158, R = 92;
// per-axis label placement: text-anchor + dy tuned per vertex so chips sit clear
const LABELPOS: { ta: "middle" | "start" | "end"; dx: number; dy: number }[] = [
  { ta: "middle", dx: 0,  dy: -8 },  // 0 top      MOMENTUM
  { ta: "start",  dx: 6,  dy: 4 },   // 1 upper-r  VALUE
  { ta: "start",  dx: 4,  dy: 14 },  // 2 lower-r  VOLATILITY
  { ta: "end",    dx: -4, dy: 14 },  // 3 lower-l  LIQUIDITY
  { ta: "end",    dx: -6, dy: 4 },   // 4 upper-l  SENTIMENT
];

function polyStr(scores: Scores): string {
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) { const [x, y] = pentaPoint(CX, CY, R, i, scores[RADAR_AXES[i]]); pts.push(x.toFixed(1) + "," + y.toFixed(1)); }
  return pts.join(" ");
}
function vertsStr(scores: Scores): string {
  let s = "";
  for (let i = 0; i < 5; i++) { const [x, y] = pentaPoint(CX, CY, R, i, scores[RADAR_AXES[i]]); s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#D9942B" stroke="#23201A" stroke-width="1"/>`; }
  return s;
}

function drawRadar(wrap: HTMLElement, id: string, sym: string, stagedQty: number, staged: boolean, animRef: { raf: number }): void {
  const target = radarScores(sym, stagedQty);
  const cur: Scores = radarAnim[id] || { ...target };
  radarAnim[id] = cur;

  // static frame: web rings + axes + outboard teal label chips
  const web: string[] = [];
  for (let ring = 1; ring <= 5; ring++) {
    const pts: string[] = [];
    for (let i = 0; i < 5; i++) { const [x, y] = pentaPoint(CX, CY, R, i, ring * 2); pts.push(x.toFixed(1) + "," + y.toFixed(1)); }
    web.push(`<polygon points="${pts.join(" ")}" fill="none" stroke="rgba(35,32,26,.20)" stroke-width="1"/>`);
  }
  let axes = "", labels = "";
  for (let i = 0; i < 5; i++) {
    const [ax, ay] = pentaPoint(CX, CY, R, i, 10);
    axes += `<line x1="${CX}" y1="${CY}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="rgba(35,32,26,.26)" stroke-width="1"/>`;
    const [lx, ly] = pentaPoint(CX, CY, R + 14, i, 10);
    const lp = LABELPOS[i]; const lab = RADAR_AXES[i];
    // reference mode (watchlist): show numeric value at vertex; staged mode (positions): label only
    const num = staged ? "" : target[lab].toFixed(0);
    // widths: condensed label ~5.6px/char, mono numeral ~6.4px/char (kept as its own run)
    const labW = lab.length * 5.6, numW = num ? num.length * 6.4 + 5 : 0;
    const cw = labW + numW + 10, ch = 15;
    const tx = lx + lp.dx, ty = ly + lp.dy;
    const rectX = lp.ta === "middle" ? tx - cw / 2 : lp.ta === "end" ? tx - cw : tx;
    // label in condensed; numeral in IBM Plex Mono ('all numerals in the app are mono')
    const labX = rectX + 5 + labW / 2;
    const numText = num
      ? `<text x="${(rectX + cw - 5 - numW / 2 + 2.5).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" fill="#EDE4CE" font-family="'IBM Plex Mono',monospace" font-weight="600" font-size="9.5" letter-spacing="0">${num}</text>`
      : "";
    labels += `<g font-weight="700" font-size="10.5" letter-spacing="0.4">
      <rect x="${rectX.toFixed(1)}" y="${(ty - 11).toFixed(1)}" width="${cw.toFixed(1)}" height="${ch}" fill="#5D8B80"/>
      <text x="${labX.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" fill="#EDE4CE" font-family="'Barlow Condensed',sans-serif">${lab}</text>${numText}</g>`;
  }

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Instrument fingerprint radar. Axes: momentum, value, volatility, liquidity, sentiment.">
    ${web.join("") + axes + labels}
    <polygon data-poly points="${polyStr(cur)}" fill="rgba(217,148,43,.35)" stroke="#D9942B" stroke-width="2"/>
    <g data-verts>${vertsStr(cur)}</g>
  </svg>`;

  // animate 200ms toward target (staged preview / data change)
  const poly = wrap.querySelector("[data-poly]") as SVGPolygonElement | null;
  const vg = wrap.querySelector("[data-verts]") as SVGGElement | null;
  const start = { ...cur }; const t0 = performance.now(); const dur = prefersReduced ? 0 : 200;
  cancelAnimationFrame(animRef.raf);
  const step = (now: number) => {
    const t = dur ? clamp((now - t0) / dur, 0, 1) : 1;
    RADAR_AXES.forEach((a) => { cur[a] = lerp(start[a], target[a], t); });
    if (poly) poly.setAttribute("points", polyStr(cur));
    if (vg) vg.innerHTML = vertsStr(cur);
    if (t < 1) animRef.raf = requestAnimationFrame(step);
  };
  animRef.raf = requestAnimationFrame(step);
}

export default function Radar({ id, sym, stagedQty = 0, staged = false, className }: {
  /** stable per-mount key for the tween store (e.g. "posRadar", "wRadar", "cmpRadar-0") */
  id: string;
  sym: string;
  stagedQty?: number;
  staged?: boolean;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef({ raf: 0 });

  useEffect(() => {
    const wrap = wrapRef.current; if (!wrap) return;
    const anim = animRef.current;
    const draw = () => drawRadar(wrap, id, sym, stagedQty, staged, anim);
    draw();
    // redraw on every tick: MOMENTUM/SENTIMENT track the walking dayPct
    const unsub = DataEngine.subscribe(draw);
    return () => { unsub(); cancelAnimationFrame(anim.raf); };
  }, [id, sym, stagedQty, staged]);

  return <div className={className ?? "radar-wrap"} ref={wrapRef} />;
}
