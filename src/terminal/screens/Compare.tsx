/* =========================================================================
   TERMINAL 77 — COMPARE (id=compare, WND-0x8B) — side-by-side VALUE FINGERPRINT

   Port of the prototype's renderCompare / cmpRenderSlots / cmpDrawWell /
   cmpDrawRadar / cmpRenderDelta / cmpTick. Answers: of the 2-3 picked
   symbols, which is the better instrument RIGHT NOW — richer value
   fingerprint, cheaper on PEG/FCF, wider moat — and where each wins/loses.

   WHO OWNS WHAT (the Dashboard update discipline, applied here):
   • STRUCTURE IS JSX — slot chips, range toggle, radar band cells (header +
     verdict chip + caption), well legend. Re-rendered ONLY on user-state
     changes (slot fill/clear/cycle, range, roster events) via
     stateSubscribe(force). All math comes from engine/compare.ts +
     state.cmpGetMetrics — NEVER recomputed here (settled-verdict law).
   • CANVAS/SVG ARE IMPERATIVE — the base-100 overlay is a <canvas> ref
     (drawWell, in-canvas glow [S2]); each pentagon is innerHTML into a ref'd
     .cmp-radarsvg host so the 200ms rAF tween can rewrite polygon points
     every frame without fighting the reconciler (same trick as Radar.tsx).
   • THE DELTA TABLE IS innerHTML on a ref'd scroll div (the prototype's
     string-built ledger, statusChip-free) — rebuilt on full repaints only;
     between candles the tick patcher refreshes ONLY the live 1D% cells in
     place through [data-cmpday] (no table rebuild / no focus thrash).

   NON-REPAINTING LAW (the approved behaviour): the five-dim radars +
   fundamental delta rows are SETTLED verdicts — cached by state.cmpGetMetrics
   and recomputed only on a closed-candle roll (cmpBumpMetrics) or a
   slot/range change, never on every mock tick. Only the base-100 price
   overlay + the day% badges repaint live, and only on the 1D range.

   PALETTE DISCIPLINE: line identity is the three NEUTRALS (paper-cream /
   warm-brown / cool-grey — CMP_COLORS); teal = info chrome; the ACTIVE slot's
   orange focus ring is a verb (press C = act here); gain/loss colour touches
   ONLY market numbers (day% / base-100 endpoints); the BEST delta cell is a
   3px orange LEFT-BORDER + ▲ "look-here" flag — never an orange fill; the
   verdict is an ink/teal statusChip (word + pips), never green/red.

   KEYBOARD: the shell already dispatches C (cycle active slot) and D (clear
   active slot) against state; ◀▶ roster fill routes through selectInstrument
   → Compare.picker.fill (state.ts). The typed-SYM input handles its own
   Enter (needs THIS screen's DOM) — no registerKeyExtra required.
   ========================================================================= */

import { useEffect, useReducer, useRef } from "react";
import {
  DataEngine, RANGES, arrow, glClass, clamp, lerp, type Range,
} from "../engine/dataEngine";
import {
  CMP_AXES, CMP_COLORS, CMP_DELTA_ROWS, cmpProfile, cmpQuote, cmpResolveSym,
  cmpBuildOverlay, type CmpAxis,
} from "../engine/compare";
import {
  stateSubscribe, notifyState, Compare, cmpFilledSlots, cmpGetMetrics, cmpBumpMetrics,
} from "../state";
import { fitCanvas, drawGlowLine } from "../components/canvas";
import { registerRedraw, gotoScreen, prefersReduced } from "../bus";
import Roster from "../components/Roster";
import StatusChip from "../components/StatusChip";

/* ---------------- module-scoped tween + tick state (prototype page-scope) ----------------
   cmpRadarAnim persists across screen visits (like the prototype's page-lifetime
   let) so returning to COMPARE resumes each pentagon from its last displayed
   shape instead of snapping. cmpRadarRaf tracks the running tween per cell so a
   redraw cancels the previous loop (the prototype leaked those loops; since both
   loops share the same `cur` object, cancelling is the safe equivalent). */
type CmpScores = Record<CmpAxis, number>;
const cmpRadarAnim: Record<string, CmpScores> = {};
const cmpRadarRaf: Record<string, number> = {};
let cmpLastClosedN: number | null = null;

/* --- one CMP pentagon (5 VALUE axes) into a cell host. Same pentaPoint geometry as the
   trading radar so the shapes are literally comparable; per-slot neutral fill; 200ms tween
   guarded by prefersReduced. Verbatim port of the prototype's cmpDrawRadar. */
function cmpDrawRadar(svgHost: HTMLElement, slotIndex: number, sym: string): void {
  const m = cmpGetMetrics(sym);
  const target = {} as CmpScores;
  CMP_AXES.forEach((a) => { target[a] = m.axes[a] * 2; }); // 1..5 -> pentagon 1..10
  const key = "cmp" + slotIndex;
  const cur: CmpScores = cmpRadarAnim[key] || { ...target };
  cmpRadarAnim[key] = cur;
  const col = CMP_COLORS[slotIndex] || CMP_COLORS[0];
  const W = 240, H = 210, cx = 120, cy = 104, R = 66;
  const LABELPOS = [
    { ta: "middle", dx: 0,  dy: -7 },
    { ta: "start",  dx: 5,  dy: 3 },
    { ta: "start",  dx: 3,  dy: 12 },
    { ta: "end",    dx: -3, dy: 12 },
    { ta: "end",    dx: -5, dy: 3 },
  ] as const;
  const SHORT: Record<CmpAxis, string> = { VALUATION: "VAL", MOAT: "MOAT", FCF: "FCF", PROFITABILITY: "PROF", GROWTH: "GRO" };
  function pt(i: number, val: number): [number, number] {
    const ang = -Math.PI / 2 + i * (2 * Math.PI / 5); const rr = R * (val / 10);
    return [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr];
  }
  function frame(): string {
    let web = "";
    for (let ring = 1; ring <= 5; ring++) {
      const ps: string[] = [];
      for (let i = 0; i < 5; i++) { const [x, y] = pt(i, ring * 2); ps.push(x.toFixed(1) + "," + y.toFixed(1)); }
      web += `<polygon points="${ps.join(" ")}" fill="none" stroke="rgba(35,32,26,.18)" stroke-width="1"/>`;
    }
    let axes = "", labels = "";
    for (let i = 0; i < 5; i++) {
      const [ax, ay] = pt(i, 10);
      axes += `<line x1="${cx}" y1="${cy}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="rgba(35,32,26,.22)" stroke-width="1"/>`;
      const [lx, ly] = pt(i, 10); const lp = LABELPOS[i]; const lab = CMP_AXES[i]; const val = m.axes[lab];
      const short = SHORT[lab];
      const labW = short.length * 5.2 + val.toFixed(0).length * 6 + 12, ch = 14;
      const tx = lx + lp.dx * 1.6, ty = ly + lp.dy;
      let rectX = lp.ta === "middle" ? tx - labW / 2 : lp.ta === "end" ? tx - labW : tx;
      rectX = clamp(rectX, 1, W - labW - 1);
      labels += `<g font-size="9.5" font-weight="700" letter-spacing="0.3">
        <rect x="${rectX.toFixed(1)}" y="${(ty - 10).toFixed(1)}" width="${labW.toFixed(1)}" height="${ch}" fill="#5D8B80"/>
        <text x="${(rectX + 5).toFixed(1)}" y="${ty.toFixed(1)}" fill="#EDE4CE" font-family="'Barlow Condensed',sans-serif">${short}</text>
        <text x="${(rectX + labW - 5).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="end" fill="#EDE4CE" font-family="'IBM Plex Mono',monospace" font-size="9">${val.toFixed(0)}</text></g>`;
    }
    return web + axes + labels;
  }
  function polyStr(sc: CmpScores): string {
    const ps: string[] = [];
    for (let i = 0; i < 5; i++) { const [x, y] = pt(i, sc[CMP_AXES[i]]); ps.push(x.toFixed(1) + "," + y.toFixed(1)); }
    return ps.join(" ");
  }
  function vertsStr(sc: CmpScores): string {
    let s = "";
    for (let i = 0; i < 5; i++) { const [x, y] = pt(i, sc[CMP_AXES[i]]); s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${col}" stroke="#23201A" stroke-width="1"/>`; }
    return s;
  }
  const fillRGBA = col === "#EDE4CE" ? "rgba(237,228,206,.28)" : col === "#C79A5E" ? "rgba(199,154,94,.30)" : "rgba(148,167,155,.30)";
  svgHost.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Value fingerprint for ${sym}. Axes: valuation, moat, FCF, profitability, growth.">
    ${frame()}
    <polygon id="${key}-poly" points="${polyStr(cur)}" fill="${fillRGBA}" stroke="${col}" stroke-width="2"/>
    <g id="${key}-verts">${vertsStr(cur)}</g>
  </svg>`;
  const poly = svgHost.querySelector<SVGPolygonElement>("#" + key + "-poly");
  const vg = svgHost.querySelector<SVGGElement>("#" + key + "-verts");
  const start = { ...cur }; const t0 = performance.now(); const dur = prefersReduced ? 0 : 200;
  cancelAnimationFrame(cmpRadarRaf[key] || 0);
  const step = (now: number) => {
    const t = dur ? clamp((now - t0) / dur, 0, 1) : 1;
    CMP_AXES.forEach((a) => { cur[a] = lerp(start[a], target[a], t); });
    if (poly) poly.setAttribute("points", polyStr(cur));
    if (vg) vg.innerHTML = vertsStr(cur);
    if (t < 1) cmpRadarRaf[key] = requestAnimationFrame(step);
  };
  cmpRadarRaf[key] = requestAnimationFrame(step);
}

export default function CompareScreen() {
  const [, force] = useReducer((n: number) => n + 1, 0);

  const wellRef = useRef<HTMLCanvasElement | null>(null);
  const slotsRef = useRef<HTMLDivElement | null>(null);
  const deltaRef = useRef<HTMLDivElement | null>(null);
  // one host per slot for the imperative pentagon draw (React owns the div only;
  // innerHTML survives re-renders because the JSX declares no children for it)
  const radarHosts = useRef<(HTMLDivElement | null)[]>([null, null, null]);

  /* ================= SHARED NORMALIZED PRICE WELL (cmpDrawWell, verbatim) =================
     dotted grid + base-100 guide + one glow line/slot. Line colours are neutral
     (paper/brown/grey); direction is read from the base-100 endpoint, not hue. */
  function drawWell(): void {
    const cv = wellRef.current; if (!cv) return;
    const { ctx, w, h, degenerate } = fitCanvas(cv); if (degenerate) return;
    ctx.clearRect(0, 0, w, h);
    const ov = cmpBuildOverlay(Compare.picker.slots, Compare.range);
    const padX = 12, padTop = 12, padBot = 20;
    const min = ov.min, max = ov.max, rng = (max - min) || 1;
    const yOf = (v: number) => padTop + (1 - (v - min) / rng) * (h - padTop - padBot);
    // dotted teal gridlines + % labels (axis is % vs start, NOT dollars — honest base-100 label)
    ctx.strokeStyle = "rgba(93,139,128,.26)"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.textAlign = "left";
    for (let g = 0; g <= 4; g++) {
      const val = max - (g / 4) * (max - min); const y = padTop + (g / 4) * (h - padTop - padBot);
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(w - padX, y); ctx.stroke();
      ctx.fillStyle = "rgba(93,139,128,.75)"; ctx.fillText((val - 100 >= 0 ? "+" : "") + (val - 100).toFixed(1) + "%", padX + 2, y - 2);
    }
    ctx.setLineDash([]);
    // solid base-100 reference line
    const y100 = yOf(100);
    ctx.strokeStyle = "rgba(237,228,206,.35)"; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(padX, y100); ctx.lineTo(w - padX, y100); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(237,228,206,.55)"; ctx.textAlign = "right"; ctx.fillText("BASE 100", w - padX - 2, y100 - 3); ctx.textAlign = "left";
    // one glow line per slot, in its neutral slot colour
    ov.series.forEach((s) => {
      if (s.norm.length < 2) return;
      const col = CMP_COLORS[s.i] || CMP_COLORS[0];
      const pts: [number, number][] = s.norm.map((v, i) => [padX + (i / (s.norm.length - 1)) * (w - 2 * padX), yOf(v)]);
      drawGlowLine(ctx, pts, col, { core: 1.7 });
      // endpoint dot
      const ep = pts[pts.length - 1];
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ep[0], ep[1], 2.6, 0, 7); ctx.fill();
    });
    if (!ov.series.length) {
      ctx.fillStyle = "rgba(237,228,206,.5)"; ctx.font = '12px "IBM Plex Mono", monospace'; ctx.textAlign = "center";
      ctx.fillText("NO SLOTS FILLED — PRESS C, THEN PICK A ROSTER CARD", w / 2, h / 2); ctx.textAlign = "left";
    }
  }

  /* ================= RADAR BAND DRAW (renderCompare's cell-draw pass) ================= */
  function drawRadars(): void {
    cmpFilledSlots().forEach((o) => {
      const host = radarHosts.current[o.i];
      if (host) cmpDrawRadar(host, o.i, o.sym);
    });
  }

  /* ================= DELTA TABLE (cmpRenderDelta, verbatim string build) =================
     one row per headline metric, one column per slot + a signed Δ vs SLOT-1. The BEST cell
     per row gets a 3px orange LEFT-BORDER + ▲ (a "look-here" flag) — NEVER an orange fill. */
  function renderDelta(): void {
    const scroll = deltaRef.current; if (!scroll) return;
    const filled = cmpFilledSlots();
    if (filled.length < 2) {
      scroll.innerHTML = `<div class="cmp-empty">FILL AT LEAST <b>TWO SLOTS</b> TO COMPARE.<br>Press <b>C</b> to focus a slot, then click a roster card or type a SYM&#9002;.</div>`;
      return;
    }
    const metricsBy = filled.map((o) => ({ i: o.i, sym: o.sym, m: cmpGetMetrics(o.sym) }));
    const s1 = metricsBy[0]; // Δ is measured vs SLOT-1 (the leftmost filled slot)
    const headCols = metricsBy.map((x) => `<th>${x.sym.replace("-USD", "")}</th>`).join("");
    const body = CMP_DELTA_ROWS.map((rowDef) => {
      // find the winning slot for this row (skip N/A values)
      let bestIdx = -1; let bestVal: number | null = null;
      metricsBy.forEach((x, ci) => {
        const r = x.m.rows[rowDef.key]; if (!isFinite(r.val)) return;
        if (bestVal === null || (r.betterHigh ? r.val > bestVal : r.val < bestVal)) { bestVal = r.val; bestIdx = ci; }
      });
      const cells = metricsBy.map((x, ci) => {
        const r = x.m.rows[rowDef.key];
        const best = ci === bestIdx;
        // market-number rows keep gain/loss colour; classification rows stay ink
        const numCls = r.mkt ? "mono " + glClass(r.val) : "mono";
        const bmark = best ? '<span class="bmark">&#9650;</span>' : "";
        // the live 1D% row's cells carry [data-cmpday=slotIndex] so the tick patcher refreshes them in place
        const dayAttr = rowDef.key === "day" ? ` data-cmpday="${x.i}"` : "";
        return `<td class="${numCls}${best ? " cmp-best" : ""}"${dayAttr}>${bmark}${r.txt}</td>`;
      }).join("");
      // signed Δ vs SLOT-1 (only for numeric, non-market rows; market row shows spread in points)
      let deltaCell = '<td class="mono" style="color:var(--ink-soft)">&#8212;</td>';
      const rLast = metricsBy[metricsBy.length - 1].m.rows[rowDef.key], r1 = s1.m.rows[rowDef.key];
      if (metricsBy.length >= 2 && isFinite(rLast.val) && isFinite(r1.val)) {
        const d = rLast.val - r1.val;
        const unit = rowDef.key === "moatScore" ? "" : (rowDef.key === "peg" ? "" : (rowDef.key === "day" ? " pt" : "%"));
        deltaCell = `<td class="mono">${d >= 0 ? "+" : ""}${d.toFixed(2)}${unit}</td>`;
      }
      return `<tr>
        <td class="l cmp-metric">${rowDef.label}<div class="cmp-sub">${rowDef.note}</div></td>
        ${cells}
        ${deltaCell}
      </tr>`;
    }).join("");
    scroll.innerHTML = `<table class="ledger">
      <thead><tr><th class="l">METRIC</th>${headCols}<th>&#916; vs SLOT-1</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  /* ================= TICK (cmpTick — NON-REPAINTING, verbatim gating) =================
     only the base-100 price overlay + day% badges repaint live on 1D; the five-dim radars
     + fundamental delta rows are SETTLED verdicts — recomputed only on a closed candle roll
     (cmpBumpMetrics) or a slot/range change, never on every mock tick. */
  function onTick(): void {
    // DEAD UNTIL ENGINE ROLLS 1M/1Y BARS — DataEngine.tick() only rolls hist['1D'], so
    // hist['1M'] length is constant and closedN never changes: cmpBumpMetrics() + the
    // settled-verdict re-render below never fire on the mock walk. Wired for the live seam.
    const spy = DataEngine.get("SPY"); const closedN = Math.max(0, spy.hist["1M"].length - 1);
    if (cmpLastClosedN !== null && closedN !== cmpLastClosedN) { cmpBumpMetrics(); cmpLastClosedN = closedN; force(); return; }
    cmpLastClosedN = closedN;
    // live layers only: the slot day% badges + the base-100 overlay (1D range moves intraday).
    // Synthetic (unlisted) slots read a static MOCK-derived day% — honest: no live engine feeds them.
    slotsRef.current?.querySelectorAll<HTMLElement>(".cmp-slot").forEach((el) => {
      const i = parseInt(el.dataset.slot || "", 10); const sym = Compare.picker.slots[i]; if (!sym) return;
      const q = cmpQuote(sym); const pc = el.querySelector<HTMLElement>(".pct");
      if (pc) { pc.className = "pct mono " + glClass(q.dayPct); pc.textContent = `${arrow(q.dayPct)}${Math.abs(q.dayPct).toFixed(2)}%`; }
    });
    if (Compare.range === "1D") {
      drawWell();
      // refresh only the live 1D% delta-row cells (no full table rebuild / no focus thrash).
      cmpFilledSlots().forEach((o) => {
        const q = cmpQuote(o.sym);
        const cell = deltaRef.current?.querySelector<HTMLElement>(`[data-cmpday="${o.i}"]`);
        if (cell) {
          cell.className = "mono " + glClass(q.dayPct) + (cell.classList.contains("cmp-best") ? " cmp-best" : "");
          const bmark = cell.classList.contains("cmp-best") ? '<span class="bmark">&#9650;</span>' : "";
          cell.innerHTML = `${bmark}${arrow(q.dayPct)} ${Math.abs(q.dayPct).toFixed(2)}%`;
        }
      });
    }
  }

  /* ---------------- wiring: structure re-render + tick patch channels ---------------- */
  useEffect(() => {
    const unsubState = stateSubscribe(force);   // slot fill/clear/cycle, range, roster events
    const unsubTick = DataEngine.subscribe(onTick);
    // shell calls on window-resize (debounced) AND mid power-off + at settle — the exact
    // prototype resize handler: re-fit the well, redraw each filled pentagon.
    const unsubRedraw = registerRedraw(() => { drawWell(); drawRadars(); });
    return () => { unsubState(); unsubTick(); unsubRedraw(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after EVERY render (mount + each state-driven re-render): full repaint — the
  // prototype's renderCompare(), minus the JSX-owned parts (slots/legend/band shells).
  useEffect(() => { drawWell(); drawRadars(); renderDelta(); });

  // legend data is computed at render time only (prototype parity: cmpTick never
  // refreshed the legend; it settles on the next structure re-render).
  const ov = cmpBuildOverlay(Compare.picker.slots, Compare.range);

  return (
    <section id="compare" className="appscreen active">
      <div className="screenbody">
        {/* HERO: one visual-comparison card — normalized price overlays + side-by-side radars */}
        <div className="card cmp-main">
          <span className="plabel" id="cmpPlabel">COMPARE // SIDE-BY-SIDE · MODEL: BUFFETT–DUAN 5-DIM</span>
          <div className="cmp-head">
            <span className="chip teal" style={{ marginRight: 2 }}>SLOTS</span>
            {/* the slot picker rail: filled slots show SYM + colour key + day%; the empty slot is a
                diegetic SYM⟩ input + hint; the ACTIVE slot carries the orange focus ring (legal verb use) */}
            <div className="cmp-slots" id="cmpSlots" ref={slotsRef}>
              {Compare.picker.slots.map((sym, i) => {
                const active = i === Compare.picker.active;
                const col = CMP_COLORS[i];
                if (!sym) {
                  return (
                    <div
                      key={i}
                      className={"cmp-slot empty" + (active ? " active" : "")}
                      data-slot={i}
                      onClick={(ev) => {
                        // don't steal focus from the field (prototype guard)
                        if ((ev.target as HTMLElement).matches("input[data-slotinput]")) return;
                        Compare.picker.active = i; notifyState();
                      }}
                    >
                      <span className="swatch" style={{ background: col }} />
                      <span className="slotno">SLOT {i + 1}</span>
                      <span className="pfx">SYM⟩</span>
                      <input
                        className="mono" maxLength={9} placeholder="TYPE…" spellCheck={false}
                        autoComplete="off" data-slotinput={i}
                        onKeyDown={(e) => {
                          // typed-symbol commit; letters must not fire Q/E/C/D while typing
                          // (the shell's `editing` gate covers it; stopPropagation for parity)
                          if (e.key === "Enter") {
                            const raw = e.currentTarget.value.trim().toUpperCase();
                            if (raw) { Compare.picker.set(i, cmpResolveSym(raw)); e.currentTarget.blur(); notifyState(); }
                          }
                          e.stopPropagation();
                        }}
                      />
                      <span className="empt">{active ? "· ACTIVE" : "PRESS C"}</span>
                    </div>
                  );
                }
                const q = cmpQuote(sym); const p = cmpProfile(sym);
                return (
                  <div
                    key={i}
                    className={"cmp-slot" + (active ? " active" : "")}
                    data-slot={i}
                    onClick={() => { Compare.picker.active = i; notifyState(); }}
                  >
                    <span className="swatch" style={{ background: col }} />
                    <span className="slotno">SLOT {i + 1}</span>
                    <span className="sym">{sym.replace("-USD", "")}</span>
                    <span className="nm">{p.name}</span>
                    {/* live badge — the tick patcher rewrites className+text in place between renders */}
                    <span className={"pct mono " + glClass(q.dayPct)}>{arrow(q.dayPct)}{Math.abs(q.dayPct).toFixed(2)}%</span>
                  </div>
                );
              })}
            </div>
            {/* shared range toggle: recompute settled metrics for the new range, then full re-render */}
            <div className="rangetog" id="cmpRangeTog">
              {RANGES.map((r: Range) => (
                <button
                  key={r}
                  className={r === Compare.range ? "on" : ""}
                  onClick={() => { Compare.range = r; cmpBumpMetrics(); notifyState(); }}
                >{r}</button>
              ))}
            </div>
          </div>
          <div className="cmp-stage">
            <div className="cmp-wellhead">
              <span className="cmp-welltag">NORMALIZED · BASE 100</span>
              {/* legend keyed to the price well — neutral swatch + end% (a market number) */}
              <div className="cmp-welllegend" id="cmpWellLegend">
                {ov.series.length ? ov.series.map((s) => {
                  const col = CMP_COLORS[s.i] || CMP_COLORS[0]; const up = s.endPct >= 0;
                  return (
                    <span key={s.i} className="cmp-lg">
                      <span className="sw" style={{ background: col }} />
                      <span className="lgsym">{s.sym.replace("-USD", "")}</span>
                      <span className={"lgend " + glClass(s.endPct)}>{up ? "▲" : "▼"} {up ? "+" : ""}{s.endPct.toFixed(1)}%</span>
                    </span>
                  );
                }) : <span className="cmp-lg" style={{ color: "var(--ink-soft)" }}>— NO SLOTS FILLED —</span>}
              </div>
            </div>
            <div className="cmp-well" id="cmpWell">
              <canvas id="cmpOverlay" ref={wellRef} />
            </div>
            {/* radar band: one cell per slot (filled = pentagon + verdict; empty = diegetic empty state) */}
            <div className="cmp-radarband" id="cmpRadarBand">
              {Compare.picker.slots.map((sym, i) => {
                const active = i === Compare.picker.active; const col = CMP_COLORS[i];
                if (!sym) {
                  return (
                    <div
                      key={i} className="cmp-radarcell empty" data-slot={i}
                      onClick={() => { Compare.picker.active = i; notifyState(); }}
                    >
                      <div className="cmp-radar-empt">
                        SLOT {i + 1} · <b>EMPTY</b><br />
                        {active ? "ACTIVE — pick a roster card or type SYM⟩" : "press C to focus"}
                      </div>
                    </div>
                  );
                }
                const m = cmpGetMetrics(sym);
                return (
                  <div
                    key={i} className="cmp-radarcell" data-slot={i}
                    onClick={() => { Compare.picker.active = i; notifyState(); }}
                  >
                    <div className="cmp-radartop">
                      <span className="swatch" style={{ background: col }} />
                      <span className="sym">{sym.replace("-USD", "")}</span>
                      <span className="verdict">
                        <StatusChip
                          word={m.verdict} level={m.verdictLevel}
                          pips={m.verdict === "STRONG BUY" ? 4 : m.verdict === "BUY" ? 3 : m.verdict === "HOLD" ? 2 : 1}
                        />
                      </span>
                    </div>
                    {/* imperative pentagon host — cmpDrawRadar owns its innerHTML (tween-safe) */}
                    <div className="cmp-radarsvg" ref={(el) => { radarHosts.current[i] = el; }} />
                    <div className="cmp-radarcap">
                      COMPOSITE <b>{m.composite.toFixed(1)}/5</b>{m.crypto ? " · MODEL N/A (CRYPTO)" : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* SUPPORTING: key-stat delta table (internal-scroll; BEST cell = orange left-tick) */}
        <div className="card cmp-deltacard">
          <div className="cmp-deltahead">
            <span className="plabel" style={{ position: "static" }}>DELTA // KEY STATS · MODEL</span>
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginLeft: "auto" }}>DERIVED — NOT AUDITED FINANCIALS</span>
          </div>
          {/* renderDelta owns this scroll div's innerHTML (rebuilt on repaints; 1D% cells tick-patched) */}
          <div className="cmp-deltascroll" id="cmpDeltaScroll" ref={deltaRef} />
        </div>
        <div className="cmp-roster-wrap"><Roster /></div>
      </div>
      <div className="hintbar screen-hints">
        <span className="h"><kbd>Q</kbd><kbd>E</kbd><span className="t">CYCLE APPS</span></span>
        <span className="h"><kbd>C</kbd><span className="t">SLOT</span></span>
        <span className="h"><kbd>D</kbd><span className="t">CLEAR</span></span>
        <span className="h"><kbd>◀</kbd><kbd>▶</kbd><span className="t">FILL SLOT</span></span>
      </div>
      <div className="escback" onClick={() => gotoScreen("dash")}><kbd>ESC</kbd><span>BACK</span></div>
    </section>
  );
}
