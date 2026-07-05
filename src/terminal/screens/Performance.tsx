/* =========================================================================
   TERMINAL 77 — PERFORMANCE (UPGRADE 4 — the analysis deck; PERFORMANCE.chz)

   Port of the prototype's #perf section + renderPerf/perfLoadSeries/perfCalc/
   perfDrawBase/perfDrawPanes/perfDrawOverlay/perfSyncPanes/perfBuildRail/
   perfToggle/perfTick/perfResize. Division of labour in the app:

     • state.ts owns the DATA half — Perf state, PERF_TOGGLES/perfOn/PERF_FLAT,
       perfLoadSeries() (source/range → bars + closedN + tag, non-repainting
       law) and the memoised perfCalc(). NOTHING here re-implements math.
     • Terminal.tsx owns the KEYS — 1–9 quick-toggles and I (rail) already
       mutate perfOn/Perf.railHidden + notifyState(); this screen just
       re-renders. No registerKeyExtra needed: the only editing field (the SYM
       input) handles its own Enter and stopPropagation()s like the prototype.
     • THIS file owns the LOOK — markup (exact terminal.css class names), the
       layered canvases, the legend, and the pointer/click wiring.

   The prototype's DOM-injection points map to React so:
     • perfBuildRail  → the rail is JSX from PERF_TOGGLES (re-rendered on any
       notifyState; chips key by id so toggling only flips classes).
     • perfSyncPanes  → the panes are JSX from perfActivePanes() (keyed by
       pane id, so React adds/removes <canvas> elements exactly when the
       prototype's innerHTML swap did — the repaint effect then draws them).
     • renderPerf     → the mount effect (load once if empty) + the
       after-every-render repaint effect.
     • perfResize     → registerRedraw(drawAll): the shell calls it on window
       resize (debounced) and around the CRT power-off (fitCanvas's
       offsetWidth fallback is collapse-safe).

   UPDATE DISCIPLINE (the setTickText law):
     • STRUCTURE (head chrome, rail, panes list) re-renders via stateSubscribe.
     • TICKS extend only the live-forming last candle (perfTick verbatim):
       patch #perfLast through a ref + setTickText, redraw base+panes. The
       crosshair OVERLAY redraws only on pointer move — never on a tick.
     • The LEGEND is imperative innerHTML on a ref (prototype string form) so
       hover scrubbing never forces a React render.
   ========================================================================= */

import { useEffect, useReducer, useRef, type ReactElement, type Ref } from "react";
import {
  DataEngine, UNIVERSE, RANGES, clamp, lerp, fmtUSD, fmtNum, fmtMoney, type Range,
} from "../engine/dataEngine";
import { THRESHOLDS } from "../engine/signals";
import { lttb } from "../engine/indicators";
import {
  State, stateSubscribe, notifyState, computeEquity,
  Perf, perfOn, PERF_TOGGLES, PERF_FLAT, perfLoadSeries, perfCalc,
  type PerfCalc, type PerfSource,
} from "../state";
import { fitCanvas } from "../components/canvas";
import { setTickText } from "../components/dom";
import { registerRedraw, gotoScreen, prefersReduced } from "../bus";
import Roster from "../components/Roster";
// LIVE Performance-Truth deck (worker B — may tsc-drift until truthStore.ts lands; keep the usage).
import { TruthStore, startHistorySync } from "../engine/truthStore";
import type { TimeSeriesPoint } from "../../engine/types";

// VITE_MOCK builds must be a NO-OP for the whole live path (design builds stay SIMULATED candles).
const IS_MOCK = import.meta.env.VITE_MOCK === "1";

/** "as of HH:MM" body + staleness from an ISO sync time. null iso → null (no
 *  claim). >10min old → stale (the poller may have failed silently). (item 34) */
function asOf(iso: string | null): { text: string; stale: boolean } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const stale = Date.now() - t > 10 * 60_000;
  return { text: `${hh}:${mm}`, stale };
}

/* The TRUTH DECK is active only in a live build, on the PORTFOLIO source, when the
   history sync has produced a real PerformanceTruth. Everything else (ROSTER, TYPED,
   the mock build) keeps the SIMULATED candle deck untouched. This one predicate gates
   the head chrome, the chart-area swap, the rail hide, AND the candle tick/repaint so
   the two worlds never fight over the same canvases. */
function truthDeckActive(): boolean {
  return !IS_MOCK && Perf.source === "PORTFOLIO" && !!TruthStore.truth;
}

/* ================= PURE CANVAS GEOMETRY (prototype helpers, verbatim) ================= */

/** x for bar index i across the padded plot width (all layers share one x-scale). */
function perfXOf(i: number, w: number, padX: number): number {
  const n = Perf.bars.length;
  return padX + (n <= 1 ? 0 : (i / (n - 1)) * (w - 2 * padX));
}
/** candle body width — 66% of the per-bar slot, floored so 240 bars stay visible. */
function perfBarW(w: number, padX: number): number {
  const n = Perf.bars.length;
  return Math.max(1.5, (w - 2 * padX) / n * 0.66);
}
/** which sub-panes are active (drives the JSX pane list, in fixed order). */
function perfActivePanes(): string[] {
  return ["rsi", "stoch", "macd", "atr"].filter((id) => perfOn[id]);
}

/* LTTB guard for LINE-form series: past PERF_LTTB_MAX visible finite points,
   stroke an extrema-preserving downsample keyed on x=index so xOf() still maps
   correctly. (The 1Y range is 240 bars — this is future-proofing for a live
   seam that returns richer history, not a hot path today.) */
const PERF_LTTB_MAX = 1500;
function perfStrokeLine(ctx: CanvasRenderingContext2D, arr: number[], xOf: (i: number) => number, yOf: (v: number) => number): void {
  let finite = 0;
  for (let i = 0; i < arr.length; i++) if (isFinite(arr[i])) finite++;
  ctx.beginPath(); let started = false;
  if (finite > PERF_LTTB_MAX) {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < arr.length; i++) { if (isFinite(arr[i])) pts.push({ x: i, y: arr[i] }); }
    const s = lttb(pts, PERF_LTTB_MAX);
    for (const p of s) {
      const x = xOf(p.x), y = yOf(p.y);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
  } else {
    for (let i = 0; i < arr.length; i++) {
      if (!isFinite(arr[i])) continue;
      const x = xOf(i), y = yOf(arr[i]);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}
function perfLineSeries(ctx: CanvasRenderingContext2D, arr: number[], w: number, padX: number, yOf: (v: number) => number, color: string, lw: number, dash?: number[]): void {
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
  perfStrokeLine(ctx, arr, (i) => perfXOf(i, w, padX), yOf);
  ctx.setLineDash([]);
}
function perfDrawRibbon(ctx: CanvasRenderingContext2D, C: PerfCalc, w: number, padX: number, yOf: (v: number) => number): void {
  // 8 EMAs, teal→orange gradient by period (in-canvas, no CSS). Fast on top.
  const set = C.emaSet;
  for (let k = set.length - 1; k >= 0; k--) {
    const t = k / (set.length - 1); // 0 fast .. 1 slow
    // interpolate teal(93,139,128) -> orange(217,148,43)
    const r = Math.round(lerp(217, 93, t)), g = Math.round(lerp(148, 139, t)), b = Math.round(lerp(43, 128, t));
    perfLineSeries(ctx, set[k], w, padX, yOf, `rgba(${r},${g},${b},.9)`, k < 2 ? 1.6 : 1.1);
  }
}
function perfDrawBollinger(ctx: CanvasRenderingContext2D, C: PerfCalc, w: number, padX: number, yOf: (v: number) => number): void {
  const bb = C.bb!;
  perfLineSeries(ctx, bb.upOut, w, padX, yOf, "rgba(93,139,128,.7)", 1.2);
  perfLineSeries(ctx, bb.dnOut, w, padX, yOf, "rgba(93,139,128,.7)", 1.2);
  perfLineSeries(ctx, bb.upIn,  w, padX, yOf, "rgba(93,139,128,.4)", 1);
  perfLineSeries(ctx, bb.dnIn,  w, padX, yOf, "rgba(93,139,128,.4)", 1);
  perfLineSeries(ctx, bb.mid,   w, padX, yOf, "rgba(93,139,128,.55)", 1, [4, 4]);
}
function perfDrawSuperTrend(ctx: CanvasRenderingContext2D, C: PerfCalc, w: number, padX: number, yOf: (v: number) => number): void {
  // one polyline per direction run: green while dir=+1, brick while dir=-1
  // (market colours on market geometry — palette law holds).
  const { line, dir } = C.super!;
  ctx.lineWidth = 1.8; let started = false; let curDir: number | null = null;
  for (let i = 0; i < line.length; i++) {
    if (!isFinite(line[i])) { started = false; continue; }
    const x = perfXOf(i, w, padX), y = yOf(line[i]);
    if (!started || dir[i] !== curDir) {
      if (started) ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y);
      curDir = dir[i]; ctx.strokeStyle = curDir === 1 ? "#4CAF6E" : "#B23A2F"; started = true;
    } else ctx.lineTo(x, y);
  }
  if (started) ctx.stroke();
}
function perfDrawDivergence(ctx: CanvasRenderingContext2D, divs: { i0: number; i1: number; kind: "bull" | "bear" }[], closes: number[], w: number, padX: number, yOf: (v: number) => number, color: string, tag: string): void {
  ctx.lineWidth = 1.4; ctx.font = '9px "IBM Plex Mono", monospace';
  divs.forEach((d) => {
    const x0 = perfXOf(d.i0, w, padX), y0 = yOf(closes[d.i0]);
    const x1 = perfXOf(d.i1, w, padX), y1 = yOf(closes[d.i1]);
    ctx.strokeStyle = color; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color; const lbl = (d.kind === "bull" ? "▲" : "▼") + tag;
    ctx.fillText(lbl, x1 + 3, (y0 + y1) / 2);
  });
}
function perfTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, up: boolean): void {
  ctx.beginPath();
  if (up) { ctx.moveTo(x, y - s); ctx.lineTo(x - s, y + s); ctx.lineTo(x + s, y + s); }
  else { ctx.moveTo(x, y + s); ctx.lineTo(x - s, y - s); ctx.lineTo(x + s, y - s); }
  ctx.closePath(); ctx.fill();
}

export default function Performance() {
  const [, force] = useReducer((n: number) => n + 1, 0);

  // ---- refs: the candle canvas layers + the two imperative text surfaces ----
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const lastRef = useRef<HTMLSpanElement | null>(null);
  // ---- ref: the TRUTH DECK canvas (net-deposits step + recorded value line) ----
  const truthCvRef = useRef<HTMLCanvasElement | null>(null);
  // ---- item 23: the TOTAL GAIN hero value element (stamped on a real sync) ----
  const heroValRef = useRef<HTMLSpanElement | null>(null);
  // ---- item 34: the TRUTH DECK head "as of HH:MM" stamp ----
  const truthAsofRef = useRef<HTMLDivElement | null>(null);
  // item 23: the last REAL total-gain we've stamped (minor units). Stamp only when
  // a live sync moves it; `undefined` = not yet seen (first reveal doesn't stamp).
  const lastGainMinor = useRef<number | undefined>(undefined);

  /* ================= DRAW BASE (candles + volume + overlays + signal marks) =================
     The "static-ish" layer — redrawn on tick/toggle/resize but NOT on pointer
     move (the crosshair lives on #perfOverlay so scrubbing is cheap). */
  function drawBase(): void {
    const cv = baseRef.current; if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    const bars = Perf.bars; if (!bars.length) return;
    const C = perfCalc();
    const padX = 10, padTop = 10, padBot = 16;
    const volH = perfOn.vol ? Math.min(46, h * 0.22) : 0;
    const priceBot = h - padBot - volH;
    // price extent — include visible overlays so bands aren't clipped
    let mn = Infinity, mx = -Infinity;
    for (const b of bars) { mn = Math.min(mn, b.l); mx = Math.max(mx, b.h); }
    if (perfOn.bb && C.bb) {
      for (let i = 0; i < C.bb.upOut.length; i++) {
        if (isFinite(C.bb.upOut[i])) { mx = Math.max(mx, C.bb.upOut[i]); mn = Math.min(mn, C.bb.dnOut[i]); }
      }
    }
    const rng = (mx - mn) || 1;
    const yOf = (p: number): number => padTop + (1 - (p - mn) / rng) * (priceBot - padTop);
    // gridlines + axis labels (teal dotted, mono)
    ctx.strokeStyle = "rgba(93,139,128,.24)"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = "rgba(93,139,128,.75)";
    for (let g = 0; g <= 4; g++) {
      const y = padTop + (g / 4) * (priceBot - padTop);
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(w - padX, y); ctx.stroke();
      // span-aware decimals (the honest-axis rule: tight ranges never print duplicates)
      const val = mx - (g / 4) * rng; const dp = rng < 1 ? 3 : rng < 8 ? 2 : (val < 10 ? 3 : 0);
      ctx.fillText(fmtNum(val, dp), padX + 2, y - 2);
    }
    ctx.setLineDash([]);
    // VOLUME histogram (under price)
    if (perfOn.vol && volH > 0) {
      let vmax = 0; for (const b of bars) vmax = Math.max(vmax, b.v);
      const bw = perfBarW(w, padX);
      for (let i = 0; i < bars.length; i++) {
        const x = perfXOf(i, w, padX); const bh = (bars[i].v / vmax) * (volH - 4);
        const up = bars[i].c >= bars[i].o;
        ctx.fillStyle = up ? "rgba(76,175,110,.42)" : "rgba(178,58,47,.42)";
        ctx.fillRect(x - bw / 2, h - padBot - bh, bw, bh);
      }
      ctx.strokeStyle = "rgba(93,139,128,.20)";
      ctx.beginPath(); ctx.moveTo(padX, h - padBot); ctx.lineTo(w - padX, h - padBot); ctx.stroke();
    }
    // OVERLAYS drawn under candles: Bollinger, EMA ribbon, VWAP, SuperTrend
    if (perfOn.bb && C.bb) perfDrawBollinger(ctx, C, w, padX, yOf);
    if (perfOn.ribbon) perfDrawRibbon(ctx, C, w, padX, yOf);
    if (perfOn.vwap && C.vwap) perfLineSeries(ctx, C.vwap, w, padX, yOf, "#7FBBAD", 1.4, [5, 3]);
    if (perfOn.super && C.super) perfDrawSuperTrend(ctx, C, w, padX, yOf);
    // CANDLES
    const bw = perfBarW(w, padX);
    const adaptive = perfOn.adaptive ? C.adaptive : undefined;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i]; const x = perfXOf(i, w, padX);
      let col: string;
      if (adaptive) { const a = adaptive[i]; col = a > 0 ? "#4CAF6E" : a < 0 ? "#B23A2F" : "#5D8B80"; } // bull/bear/neutral vs ribbon
      else col = b.c >= b.o ? "#4CAF6E" : "#B23A2F";
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      // wick
      ctx.beginPath(); ctx.moveTo(x, yOf(b.h)); ctx.lineTo(x, yOf(b.l)); ctx.stroke();
      // body
      const yo = yOf(b.o), yc = yOf(b.c); const top = Math.min(yo, yc); const bod = Math.max(1, Math.abs(yc - yo));
      ctx.fillRect(x - bw / 2, top, bw, bod);
    }
    ctx.globalAlpha = 1;
    // EMA SQUEEZE bands (subtle orange underlay ticks at squeeze bars)
    if (perfOn.squeeze && C.squeeze) {
      ctx.fillStyle = "rgba(217,148,43,.16)";
      for (let i = 0; i < C.squeeze.squeeze.length; i++) {
        if (C.squeeze.squeeze[i]) { const x = perfXOf(i, w, padX); ctx.fillRect(x - bw / 2, padTop, bw, priceBot - padTop); }
      }
    }
    // DIVERGENCE lines (price pane, from RSI + MACD divergences) — closed candles only
    if (perfOn.div) {
      perfDrawDivergence(ctx, C.divRsi || [], C.c, w, padX, yOf, "#B23A2F", "R");
      perfDrawDivergence(ctx, C.divMacd || [], C.c, w, padX, yOf, "#D9942B", "M");
    }
    // BUY/SELL signal plots (▲▼ at closed candles)
    if (perfOn.signals && C.cycle) {
      C.cycle.marks.forEach((m) => {
        const x = perfXOf(m.i, w, padX); const b = bars[m.i];
        if (m.kind === "buy") { const y = yOf(b.l) + 12; ctx.fillStyle = "#4CAF6E"; perfTriangle(ctx, x, y, 5, true); }
        else { const y = yOf(b.h) - 12; ctx.fillStyle = "#B23A2F"; perfTriangle(ctx, x, y, 5, false); }
      });
    }
    // WATCH ZONES marker: dot where RSI enters an extreme rail (closed candles)
    if (perfOn.zones && C.rsi) {
      for (let i = 1; i < Perf.closedN; i++) {
        const cross = (C.rsi[i - 1] < THRESHOLDS.RSI_OVERBOUGHT && C.rsi[i] >= THRESHOLDS.RSI_OVERBOUGHT) ||
                      (C.rsi[i - 1] > THRESHOLDS.RSI_OVERSOLD && C.rsi[i] <= THRESHOLDS.RSI_OVERSOLD);
        if (cross) {
          const x = perfXOf(i, w, padX); const y = yOf(bars[i].c);
          ctx.strokeStyle = "#5D8B80"; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.stroke();
        }
      }
    }
    // live-forming candle hint: a faint vertical tick at the right edge
    if (Perf.live) {
      const x = perfXOf(bars.length - 1, w, padX);
      ctx.strokeStyle = "rgba(217,148,43,.5)"; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, padTop); ctx.lineTo(x, priceBot); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  /* ================= DRAW PANES (RSI / StochRSI / MACD / ATR — each own mini axis) ================= */
  function drawPanes(): void {
    const wrap = panesRef.current; if (!wrap) return;
    if (!Perf.bars.length) return;
    const C = perfCalc();
    wrap.querySelectorAll<HTMLDivElement>(".perf-pane").forEach((pane) => {
      const id = pane.dataset.pane; const cv = pane.querySelector("canvas"); if (!cv) return;
      const { ctx, w, h } = fitCanvas(cv); ctx.clearRect(0, 0, w, h);
      const padX = 10, padT = 8, padB = 8;
      ctx.font = '9px "IBM Plex Mono", monospace';
      const drawAxis = (lo: number, hi: number, lines: number[]): void => {
        ctx.strokeStyle = "rgba(93,139,128,.18)"; ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
        lines.forEach((lv) => {
          const y = padT + (1 - (lv - lo) / (hi - lo)) * (h - padT - padB);
          ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(w - padX, y); ctx.stroke();
          ctx.fillStyle = "rgba(93,139,128,.7)"; ctx.setLineDash([]); ctx.fillText(String(lv), padX + 1, y - 1);
        });
        ctx.setLineDash([]);
      };
      const line = (arr: number[], lo: number, hi: number, color: string, lw?: number): void => {
        ctx.strokeStyle = color; ctx.lineWidth = lw || 1.4;
        perfStrokeLine(ctx, arr, (i) => perfXOf(i, w, padX), (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB));
      };
      const label = (t: string): void => {
        ctx.fillStyle = "#7E9A8F"; ctx.font = '700 9px "IBM Plex Mono", monospace';
        ctx.fillText(t, w - padX - ctx.measureText(t).width, padT + 9);
      };
      if (id === "rsi" && C.rsi) {
        drawAxis(0, 100, [THRESHOLDS.RSI_OVERSOLD, 50, THRESHOLDS.RSI_OVERBOUGHT]);
        line(C.rsi, 0, 100, "#D9942B", 1.6);
        if (C.cycle) line(C.cycle.rma, 0, 100, "rgba(93,139,128,.8)", 1);
        label("RSI " + THRESHOLDS.RSI_PERIOD);
      } else if (id === "stoch" && C.stoch) {
        drawAxis(0, 100, [20, 50, 80]);
        line(C.stoch.k, 0, 100, "#7FBBAD", 1.5); line(C.stoch.d, 0, 100, "#D9942B", 1.2);
        label("STOCH RSI");
      } else if (id === "macd" && C.macd) {
        const m = C.macd; let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < m.macd.length; i++) {
          [m.macd[i], m.signal[i], m.hist[i]].forEach((v) => { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
        }
        if (!isFinite(lo)) { lo = -1; hi = 1; }
        const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
        const y0 = padT + (1 - (0 - lo) / (hi - lo)) * (h - padT - padB);
        ctx.strokeStyle = "rgba(93,139,128,.25)";
        ctx.beginPath(); ctx.moveTo(padX, y0); ctx.lineTo(w - padX, y0); ctx.stroke();
        const bw = perfBarW(w, padX);
        for (let i = 0; i < m.hist.length; i++) {
          if (!isFinite(m.hist[i])) continue;
          const x = perfXOf(i, w, padX); const y = padT + (1 - (m.hist[i] - lo) / (hi - lo)) * (h - padT - padB);
          ctx.fillStyle = m.hist[i] >= 0 ? "rgba(76,175,110,.55)" : "rgba(178,58,47,.55)";
          ctx.fillRect(x - bw / 2, Math.min(y, y0), bw, Math.abs(y - y0));
        }
        line(m.macd, lo, hi, "#D9942B", 1.4); line(m.signal, lo, hi, "#5D8B80", 1.2);
        label("MACD 12,26,9");
      } else if (id === "atr" && C.atr) {
        let lo = Infinity, hi = -Infinity;
        for (const v of C.atr) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        drawAxis(lo, hi, [+((lo + hi) / 2).toFixed(2)]);
        line(C.atr, lo, hi, "#B23A2F", 1.5);
        label("ATR " + THRESHOLDS.ATR_PERIOD);
      }
    });
  }

  /* ================= CROSSHAIR OVERLAY (redrawn ONLY on pointer move) ================= */
  function drawOverlay(): void {
    const cv = overlayRef.current; if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    if (Perf.cross == null) { renderLegend(null); return; }
    const bars = Perf.bars; if (!bars.length) return;
    const padX = 10, padTop = 10, padBot = 16;
    const volH = perfOn.vol ? Math.min(46, h * 0.22) : 0; const priceBot = h - padBot - volH;
    const i = clamp(Perf.cross, 0, bars.length - 1);
    const x = perfXOf(i, w, padX);
    ctx.strokeStyle = "#D9942B"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, padTop); ctx.lineTo(x, priceBot); ctx.stroke(); ctx.setLineDash([]);
    // price marker dot on close — same extent math as the base layer so the dot lands ON the candle
    let mn = Infinity, mx = -Infinity; for (const b of bars) { mn = Math.min(mn, b.l); mx = Math.max(mx, b.h); }
    const C = perfCalc();
    if (perfOn.bb && C.bb) {
      for (let k = 0; k < C.bb.upOut.length; k++) {
        if (isFinite(C.bb.upOut[k])) { mx = Math.max(mx, C.bb.upOut[k]); mn = Math.min(mn, C.bb.dnOut[k]); }
      }
    }
    const rng = (mx - mn) || 1; const yOf = (p: number): number => padTop + (1 - (p - mn) / rng) * (priceBot - padTop);
    const yc = yOf(bars[i].c);
    ctx.fillStyle = "#D9942B"; ctx.beginPath(); ctx.arc(x, yc, 3, 0, 7); ctx.fill();
    renderLegend(i);
  }

  /* ================= LEGEND (imperative innerHTML — hover scrub never re-renders React) ================= */
  function renderLegend(i: number | null): void {
    const el = legendRef.current; if (!el) return;
    if (!Perf.bars.length) { el.innerHTML = ""; return; }
    const C = perfCalc();
    const at = i == null ? Perf.bars.length - 1 : i;
    const b = Perf.bars[at];
    const parts: string[] = [];
    parts.push(`<span class="lg"><span class="lk">${i == null ? "LAST" : "BAR " + at}</span> <span class="lv">O ${fmtNum(b.o, 2)} H ${fmtNum(b.h, 2)} L ${fmtNum(b.l, 2)} C ${fmtNum(b.c, 2)}</span></span>`);
    const val = (v: number, dp = 2): string => isFinite(v) ? fmtNum(v, dp) : "—";
    if (perfOn.ribbon) { const fast = C.emaSet[0][at]; parts.push(`<span class="lg"><span class="sw" style="background:#D9942B"></span><span class="lk">EMA${THRESHOLDS.EMA_PERIODS[0]}</span> <span class="lv">${val(fast)}</span></span>`); }
    if (perfOn.bb && C.bb) parts.push(`<span class="lg"><span class="sw" style="background:#5D8B80"></span><span class="lk">BB±2σ</span> <span class="lv">${val(C.bb.dnOut[at])}/${val(C.bb.upOut[at])}</span></span>`);
    if (perfOn.vwap && C.vwap) parts.push(`<span class="lg"><span class="sw" style="background:#7FBBAD"></span><span class="lk">VWAP</span> <span class="lv">${val(C.vwap[at])}</span></span>`);
    if (perfOn.super && C.super) parts.push(`<span class="lg"><span class="sw" style="background:${C.super.dir[at] === 1 ? "#4CAF6E" : "#B23A2F"}"></span><span class="lk">SUPER</span> <span class="lv">${val(C.super.line[at])}</span></span>`);
    if (perfOn.rsi && C.rsi) parts.push(`<span class="lg"><span class="sw" style="background:#D9942B"></span><span class="lk">RSI</span> <span class="lv">${val(C.rsi[at], 1)}</span></span>`);
    if (perfOn.stoch && C.stoch) parts.push(`<span class="lg"><span class="sw" style="background:#7FBBAD"></span><span class="lk">STOCH K/D</span> <span class="lv">${val(C.stoch.k[at], 1)}/${val(C.stoch.d[at], 1)}</span></span>`);
    if (perfOn.macd && C.macd) parts.push(`<span class="lg"><span class="sw" style="background:#5D8B80"></span><span class="lk">MACD</span> <span class="lv">${val(C.macd.macd[at], 3)}</span></span>`);
    if (perfOn.atr && C.atr) parts.push(`<span class="lg"><span class="sw" style="background:#B23A2F"></span><span class="lk">ATR</span> <span class="lv">${val(C.atr[at], 3)}</span></span>`);
    el.innerHTML = parts.join("");
  }

  function drawAll(): void { drawBase(); drawPanes(); drawOverlay(); }

  /* ================= ITEM 23 · ONE-SHOT PERSONA STAMP (ref-toggled, no re-render) =================
     Same discipline as the Dashboard masthead: add `.stamped`, force a reflow so a
     rapid re-sync restarts the keyframes, remove on animationend so it can replay.
     Inert under prefersReduced (CSS zeroes the animation) — the quiet figure-swap
     stands, matching the reduced-motion contract. */
  function playStamp(el: HTMLElement | null): void {
    if (!el || prefersReduced) return;
    el.classList.add("stamp-target");
    el.classList.remove("stamped");
    void el.offsetWidth;            // reflow → re-adding the class restarts the animation
    el.classList.add("stamped");
    // clear only on the LONGEST animation (the ::after ink-swell) — see the
    // matching comment in Dashboard.tsx playStamp.
    const clear = (e: AnimationEvent): void => {
      if (e.animationName !== "t77-inkSwell") return;
      el.classList.remove("stamped");
      el.removeEventListener("animationend", clear);
    };
    el.addEventListener("animationend", clear);
  }

  /* ================= ITEM 34 · AS-OF FRESHNESS STAMP (truth deck head) ================= */
  function renderTruthAsof(): void {
    const el = truthAsofRef.current; if (!el) return;
    // only meaningful on the live truth deck; the candle deck (ROSTER/TYPED/mock) has
    // no synced money to date-stamp, so we leave it empty there.
    if (IS_MOCK || !truthDeckActive()) { el.className = "asof truth-asof"; el.textContent = ""; return; }
    const a = asOf(TruthStore.syncedAtISO);
    if (!a) { el.className = "asof truth-asof"; el.textContent = ""; return; }
    const cls = "asof truth-asof" + (a.stale ? " stale" : "");
    const html = `<span class="asof-k">as of</span> ${a.text}${a.stale ? " · STALE" : ""}`;
    // patch-on-change (the setTickText discipline): this runs on every 1-2s tick,
    // but the string only changes when the minute or staleness flips — skip the
    // innerHTML rebuild when identical.
    const next = cls + "|" + html;
    if (el.dataset.prev === next) return;
    el.dataset.prev = next;
    el.className = cls;
    el.innerHTML = html;
  }

  /* ITEM 23 — decide whether the TOTAL GAIN hero should stamp: compare the current
     real total-gain against the last one we stamped. A change means a live sync moved
     the money. Runs after render (when the hero element exists) and on TruthStore
     landings. First reveal (prev===undefined) primes the baseline without stamping. */
  function maybeStampHero(): void {
    if (IS_MOCK || !truthDeckActive()) { lastGainMinor.current = undefined; return; }
    const g = TruthStore.truth?.totalGainMinor;
    if (g === undefined) return;
    const prev = lastGainMinor.current;
    if (prev !== undefined && g !== prev) playStamp(heroValRef.current);
    lastGainMinor.current = g;
  }

  /* ================= TRUTH DECK CHART (net-deposits step + RECORDED value line) =================
     CHART_CRAFT law, in the terminal's own cream/ink palette:
       • canvas-2D only, data-derived time + value domains, honest un-truncated value axis.
       • the DEPOSITS line is the FULL history (a step function — deposits are discrete events);
         the VALUE line is snapshots ONLY and simply STARTS at the first snapshot. There is NO
         interpolation before it — the honest-data law the whole app exists to enforce. The
         pre-value stretch shows the deposits step alone.
       • glow/emphasis is drawn IN-CANVAS (an ink-offset stamp underlay + a soft multi-pass on the
         value line), NEVER a CSS filter (that class of filter bricked v1 in WKWebView).
       • degrade gracefully: with <2 recorded value points, draw the deposits line + the single
         value dot (if any) and let the caption say value recording just began.
     x maps time linearly over [t0, t1] = the min/max epoch across BOTH series; y is value. */
  function drawTruth(): void {
    const cv = truthCvRef.current; if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    const series = TruthStore.series; if (!series) return;
    const dep = series.netDeposits || [];
    const val = series.value || [];
    if (!dep.length && !val.length) return;

    const epoch = (p: TimeSeriesPoint): number => { const t = Date.parse(p.atISO); return isFinite(t) ? t : 0; };
    // shared TIME domain across both series (honest: the value line lives inside the same axis).
    let t0 = Infinity, t1 = -Infinity;
    for (const p of dep) { const t = epoch(p); if (t < t0) t0 = t; if (t > t1) t1 = t; }
    for (const p of val) { const t = epoch(p); if (t < t0) t0 = t; if (t > t1) t1 = t; }
    if (!isFinite(t0) || !isFinite(t1)) return;
    const tSpan = (t1 - t0) || 1;
    // shared VALUE domain (minor units) — data-derived, includes 0 so the deposits baseline reads true.
    let vMin = Infinity, vMax = -Infinity;
    const eat = (m: number): void => { if (m < vMin) vMin = m; if (m > vMax) vMax = m; };
    for (const p of dep) eat(p.valueMinor);
    for (const p of val) eat(p.valueMinor);
    if (!isFinite(vMin)) { vMin = 0; vMax = 1; }
    vMin = Math.min(vMin, 0); // truthful baseline: never truncate the "money in" floor above zero
    const vRng = (vMax - vMin) || 1;

    const padL = 8, padR = 8, padTop = 10, padBot = 18;
    const xOf = (t: number): number => padL + ((t - t0) / tSpan) * (w - padL - padR);
    const yOf = (m: number): number => padTop + (1 - (m - vMin) / vRng) * (h - padTop - padBot);
    const ccy = TruthStore.ccy || State.accountCcy || "USD";

    // ---- gridlines + value axis labels (teal dotted, mono — matches the candle deck) ----
    ctx.strokeStyle = "rgba(93,139,128,.24)"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = "rgba(93,139,128,.85)";
    for (let g = 0; g <= 4; g++) {
      const y = padTop + (g / 4) * (h - padTop - padBot);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      const v = vMax - (g / 4) * vRng;
      ctx.setLineDash([]);
      ctx.fillText(fmtMoney(v / 100, ccy, 0), padL + 2, y - 2);
      ctx.setLineDash([2, 4]);
    }
    ctx.setLineDash([]);

    // ---- DEPOSITS step line (full history) — the "money you put in" baseline ----
    // a step: hold each level to the next event's x, then jump. Deposits are discrete, not a curve.
    if (dep.length) {
      const stepPts: [number, number][] = [];
      for (let i = 0; i < dep.length; i++) {
        const x = xOf(epoch(dep[i])), y = yOf(dep[i].valueMinor);
        if (i > 0) stepPts.push([x, stepPts[stepPts.length - 1][1]]); // horizontal hold to this x
        stepPts.push([x, y]);                                          // then the vertical jump
      }
      // extend the final level to the right edge (deposits persist until the next event)
      if (stepPts.length) stepPts.push([w - padR, stepPts[stepPts.length - 1][1]]);
      // ink-offset stamp underlay (the CHART_CRAFT anti-slop idiom), then the teal step on top
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath(); stepPts.forEach((p, i) => i ? ctx.lineTo(p[0] + 1.5, p[1] + 1.5) : ctx.moveTo(p[0] + 1.5, p[1] + 1.5));
      ctx.strokeStyle = "rgba(35,32,26,.5)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); stepPts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.strokeStyle = "#5D8B80"; ctx.lineWidth = 1.6; ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);
    }

    // ---- RECORDED value line (snapshots ONLY) — starts at the first snapshot, no interpolation before ----
    if (val.length >= 2) {
      const vp: [number, number][] = val.map((p) => [xOf(epoch(p)), yOf(p.valueMinor)]);
      // in-canvas soft glow: two decreasing-alpha wide passes + the core (no CSS filter — WKWebView-safe)
      const passes = [{ w: 6, a: 0.10 }, { w: 3.4, a: 0.20 }, { w: 1.9, a: 1 }];
      for (const pass of passes) {
        ctx.beginPath(); vp.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
        ctx.strokeStyle = "#D9942B"; ctx.globalAlpha = pass.a; ctx.lineWidth = pass.w;
        ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // recorded snapshot dots (honest: these are the ONLY true value points)
      ctx.fillStyle = "#D9942B";
      for (const [x, y] of vp) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); }
    } else if (val.length === 1) {
      // graceful degrade: exactly one recorded point — draw it as a dot, no line to fabricate.
      const x = xOf(epoch(val[0])), y = yOf(val[0].valueMinor);
      ctx.fillStyle = "#D9942B"; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
    }

    // ---- "VALUE RECORDED FROM" marker: a faint vertical tick at the first snapshot's x ----
    if (val.length) {
      const x0 = xOf(epoch(val[0]));
      ctx.strokeStyle = "rgba(217,148,43,.45)"; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, padTop); ctx.lineTo(x0, h - padBot); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  /* ================= TICK (prototype perfTick — extend ONLY the live-forming candle) =================
     Never adds/moves a closed bar: the last bar's C/H/L walk while O stays —
     the non-repainting law holds because closedN already excludes this bar. */
  function perfTick(): void {
    // TRUTH DECK has no candles — it redraws only on a history sync, never on the 1–2s price walk.
    // Skip the candle tick entirely so the two worlds never fight over the same canvases.
    if (truthDeckActive()) return;
    if (!Perf.bars.length) return; // (the prototype also gated on State.screen; here unmount unsubscribes)
    const last = Perf.bars[Perf.bars.length - 1];
    let px: number;
    if (Perf.source === "ROSTER" && UNIVERSE[Perf.symbol]) { px = DataEngine.get(Perf.symbol).last; }
    else if (Perf.source === "PORTFOLIO") { const { total } = computeEquity(); px = total; }
    else { // typed/synthetic: gentle random walk on the last close
      px = last.c * (1 + (Math.random() - 0.5) * 0.004);
    }
    // update the live candle's C/H/L (O stays; this is the same bar forming)
    last.c = px; last.h = Math.max(last.h, px); last.l = Math.min(last.l, px);
    Perf.dataV++; Perf.cache = {};
    setTickText(lastRef.current, fmtUSD(px, px < 10 ? 4 : 2));
    drawBase(); drawPanes(); // overlay only redraws on pointer move
    if (Perf.cross == null) renderLegend(null);
  }

  /* ================= STATE MUTATORS (prototype wireEvents handlers) ================= */
  // Rail chip semantics — the shell's 1–9 quick-toggle handler is this exact body.
  function perfToggle(id: string): void {
    perfOn[id] = !perfOn[id];
    Perf.cache = {}; // toggle changes the calc key
    notifyState();   // rail chips + pane list re-render; the repaint effect redraws
  }
  function setSource(src: PerfSource): void {
    Perf.source = src;
    if (src === "ROSTER") Perf.symbol = State.selected;
    else if (src === "PORTFOLIO") Perf.symbol = "PORTFOLIO";
    else if (src === "TYPED" && Perf.typed) Perf.symbol = Perf.typed;
    perfLoadSeries(); // ends in notifyState()
  }
  function setRange(r: Range): void { Perf.range = r; perfLoadSeries(); }

  /* ---------------- wiring: structure re-render + tick patch channels ---------------- */
  useEffect(() => {
    const u1 = stateSubscribe(force);          // toggles / rail / source / range / roster-select reloads
    const u2 = DataEngine.subscribe(perfTick); // 1–2s walk: extend live candle, patch numerals, redraw
    // shell resize / power-off redraw: in truth mode repaint the truth chart, else the candle deck.
    const u3 = registerRedraw(() => { if (truthDeckActive()) drawTruth(); else drawAll(); });
    // TRUTH DECK sync (live build): a completed sync re-renders the deck via force() so the dossier +
    // chart reveal. No-op / inert under VITE_MOCK (truthDeckActive() is false there).
    const u4 = TruthStore.subscribe(force);
    startHistorySync();                        // idempotent kick; no-op under VITE_MOCK or when no creds
    // prototype renderPerf: first entry loads the candle series; returning keeps bars + toggles put.
    // (The truth deck needs no bars — it reads TruthStore.series directly.)
    if (!Perf.bars.length) perfLoadSeries();
    return () => { u1(); u2(); u3(); u4(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after EVERY render (mount + each state-driven re-render): full repaint —
  // the prototype's perfSyncPanes()+perfDrawAll() tail of every mutation path.
  // Branch on the deck: the truth chart is a distinct canvas from the candle layers.
  useEffect(() => {
    if (truthDeckActive()) {
      drawTruth();
      renderTruthAsof(); // item 34: freshness stamp on the truth head
      maybeStampHero();  // item 23: stamp TOTAL GAIN if a real sync moved it
      return;
    }
    // leaving/never-on the truth deck: keep the stamp/as-of inert and reset the
    // hero baseline so re-entering the deck doesn't false-stamp on a stale compare.
    renderTruthAsof();
    lastGainMinor.current = undefined;
    drawAll();
    if (Perf.bars.length) {
      const last = Perf.bars[Perf.bars.length - 1];
      setTickText(lastRef.current, fmtUSD(last.c, last.c < 10 ? 4 : 2));
    }
  });

  /* ================= TRUTH DECK render model (live build, PORTFOLIO source) ================= */
  const truthMode = truthDeckActive();
  const truth = truthMode ? TruthStore.truth! : null;
  const tCcy = TruthStore.ccy || State.accountCcy || "USD";
  // head chrome for the truth deck: it IS live data — PORTFOLIO / Performance-Truth / LIVE tag.
  const whoSym = truthMode ? "PORTFOLIO" : Perf.symLabel;
  const whoNm = truthMode ? "Performance-Truth" : Perf.nmLabel;
  const whoTag = truthMode ? "LIVE" : Perf.tag;
  // the honest "value recording started" date for the chart caption (null = no snapshot yet).
  const firstSnapDate = (() => {
    const iso = TruthStore.firstSnapshotISO || (TruthStore.series?.value?.[0]?.atISO ?? null);
    return iso ? iso.slice(0, 10) : null;
  })();
  const valuePts = TruthStore.series?.value?.length ?? 0;

  /* one truth-split dossier row: LABEL ↔ signed money figure. `signed` figures carry
     sign + ▲/▼ + gain/loss colour (a real gain/loss number, legitimately coloured);
     `flat` figures (contributions, fees, dividends, interest) are neutral ink — a
     magnitude with no gain/loss meaning of its own. `hero` gets the big TOTAL GAIN look. */
  function truthRow(label: string, minor: number, opts?: { signed?: boolean; hero?: boolean; sub?: string; vref?: Ref<HTMLSpanElement> }): ReactElement {
    const signed = !!opts?.signed;
    const cls = signed ? (minor >= 0 ? "gain" : "loss") : "";
    const body = signed
      ? (minor >= 0 ? "▲ " : "▼ ") + fmtMoney(Math.abs(minor) / 100, tCcy)
      : fmtMoney(minor / 100, tCcy);
    return (
      <div className={"truth-row" + (opts?.hero ? " hero" : "")} key={label}>
        <span className="truth-k">{label}{opts?.sub && <span className="truth-sub">{opts.sub}</span>}</span>
        {/* the hero passes a ref so the Persona stamp (item 23) can toggle .stamped on
            the exact TOTAL GAIN figure — the one number that means "real money moved". */}
        <span className={"truth-v mono " + cls} ref={opts?.vref}>{body}</span>
      </div>
    );
  }

  return (
    <section id="perf" className="appscreen active">
      <div className="screenbody perf-body">
        <div className={"card perf-main" + (truthMode ? " perf-truthmode" : "")}>
          <span className="plabel">PERFORMANCE // {truthMode ? "TRUTH DECK" : "ANALYSIS DECK"}</span>
          <div className="perf-head">
            <div className="perf-src">
              <span className="chip teal" style={{ marginRight: 2 }}>SOURCE</span>
              <button className={"perf-srcbtn" + (Perf.source === "PORTFOLIO" ? " on" : "")} onClick={() => setSource("PORTFOLIO")}>PORTFOLIO</button>
              <button className={"perf-srcbtn" + (Perf.source === "ROSTER" ? " on" : "")} onClick={() => setSource("ROSTER")}>ROSTER</button>
              <div className="perf-syminput">
                <span className="pfx">SYM⟩</span>
                <input
                  id="perfSymInput" className="mono" maxLength={9} placeholder="TYPE…"
                  spellCheck={false} autoComplete="off"
                  onKeyDown={(e) => {
                    // Enter commits; unknown symbols get a deterministic MOCK history.
                    if (e.key === "Enter") {
                      const raw = e.currentTarget.value.trim().toUpperCase(); if (!raw) return;
                      Perf.typed = raw; Perf.source = "TYPED"; Perf.symbol = raw;
                      e.currentTarget.blur(); perfLoadSeries();
                    }
                    if (e.key !== "Escape") e.stopPropagation(); // don't let letters trigger Q/E/number-toggles while typing (but let ESC bubble to blur the field)
                  }}
                />
              </div>
            </div>
            <div className="perf-who">
              <span className="sym" id="perfSym">{whoSym}</span>
              <span className="nm" id="perfNm">{whoNm}</span>
              <span className={"perf-tag " + (whoTag === "SIMULATED" ? "sim" : whoTag === "LIVE" ? "live" : "mock")} id="perfTag">{whoTag}</span>
              {/* candle-tick numeral surface — meaningless on the truth deck (no live-forming candle) */}
              {!truthMode && <span className="last mono" id="perfLast" ref={lastRef} />}
              {/* ITEM 34 — as-of freshness stamp on the TRUTH DECK head (live only; empty on the candle deck) */}
              {truthMode && <div className="asof truth-asof" ref={truthAsofRef} />}
            </div>
            {/* range toggle is meaningless on the truth deck — it shows FULL history, always */}
            {!truthMode && (
              <div className="rangetog" id="perfRangeTog">
                {RANGES.map((r: Range) => (
                  <button key={r} className={r === Perf.range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
                ))}
              </div>
            )}
          </div>
          <div className={"perf-stage" + (truthMode ? " perf-truthstage" : "")}>
            {/* cause-naming error line (item 13, Orders' pattern): a live build on
                the PORTFOLIO source whose history sync FAILED before producing a
                truth would otherwise silently show SIMULATED candles with no clue
                why. Name the reason; a 403 names its own fix. */}
            {!IS_MOCK && Perf.source === "PORTFOLIO" && !truth && TruthStore.sync === "error" && (
              <div className="orders-empty">
                PERFORMANCE-TRUTH UNAVAILABLE — BROKER SYNC FAILED
                {TruthStore.syncError ? <>: <b>{TruthStore.syncError}</b></> : ""}.
                {TruthStore.syncError && TruthStore.syncError.includes("(403)")
                  ? " YOUR TRADING 212 KEY LIKELY LACKS THE HISTORY PERMISSIONS — REGENERATE IT WITH ORDERS/DIVIDENDS/TRANSACTIONS ENABLED."
                  : " THE MODELLED CANDLE DECK BELOW IS UNAFFECTED."}
              </div>
            )}
            {/* ===================== TRUTH DECK (live build, PORTFOLIO source) ===================== */}
            {truthMode && truth && (
              <>
                {/* HERO + SUPPORTING: the truth-split dossier — every figure from TruthStore.truth */}
                <div className="truth-dossier">
                  <div className="truth-splitgrid">
                    {/* HONESTY: while the deposit back-fill is known-incomplete (the
                        T212 deep-pagination 404), the split must confess rather than
                        quietly overstate the gain. */}
                    {TruthStore.txnsPartial && (
                      <div className="truth-row truth-warn" key="__txnwarn">
                        <span className="truth-k" style={{ color: "var(--loss)" }}>⚠ DEPOSIT HISTORY INCOMPLETE</span>
                        <span className="truth-v" style={{ fontSize: 10, opacity: 0.8 }}>
                          older deposits blocked by the broker API — contributions understated; gain may overstate
                        </span>
                      </div>
                    )}
                    {truthRow("NET CONTRIBUTIONS", truth.netContributionsMinor, { sub: "deposits − withdrawals" })}
                    {/* the engine's documented v1 limitation (engine/types.ts): realised is
                        computed in each trade's own instrument-ccy terms — the truth deck
                        must surface that caveat, not silently stamp the account symbol. */}
                    {truthRow("REALISED P/L", truth.realisedPlMinor, { signed: true, sub: "instr-ccy terms · exact for single-ccy accounts" })}
                    {truthRow("UNREALISED P/L", truth.unrealisedPlMinor, { signed: true })}
                    {truthRow("DIVIDENDS", truth.dividendsMinor)}
                    {truthRow("FEES", truth.feesMinor)}
                    {truthRow("INTEREST", truth.interestMinor)}
                  </div>
                  {/* THE ONE HERO: TOTAL GAIN — the honest "what you actually made" + return % */}
                  <div className="truth-herowrap">
                    {truthRow("TOTAL GAIN", truth.totalGainMinor, { signed: true, hero: true, vref: heroValRef })}
                    <div className="truth-return">
                      <span className="truth-k">RETURN</span>
                      <span className={"truth-v mono " + (truth.totalReturnPct == null ? "" : truth.totalReturnPct >= 0 ? "gain" : "loss")}>
                        {truth.totalReturnPct == null
                          ? "—"
                          : (truth.totalReturnPct >= 0 ? "▲ +" : "▼ ") + Math.abs(truth.totalReturnPct).toFixed(2) + "%"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* THE CHART: net-deposits step (full history) + RECORDED value line (snapshots only) */}
                <div className="truth-chartcol">
                  <div className="truth-legend mono">
                    <span className="tl-item"><span className="tl-sw" style={{ background: "#5D8B80" }} />NET DEPOSITS · FULL HISTORY</span>
                    <span className="tl-item"><span className="tl-sw" style={{ background: "#D9942B" }} />VALUE · RECORDED SNAPSHOTS</span>
                  </div>
                  <div className="perf-well truth-well">
                    <canvas id="perfTruth" ref={truthCvRef} />
                  </div>
                  <div className="truth-caption mono">
                    {firstSnapDate
                      ? (valuePts >= 2
                          ? `VALUE RECORDED FROM ${firstSnapDate} — deposits & realised are full history. No value is drawn before the first snapshot.`
                          : `FIRST VALUE POINT RECORDED ${firstSnapDate} — the value line begins once a second snapshot is recorded. Deposits shown in full.`)
                      : "NO VALUE SNAPSHOT RECORDED YET — deposits & realised shown in full; the value line begins at the first recorded snapshot."}
                  </div>
                </div>
              </>
            )}

            {/* ===================== CANDLE DECK (ROSTER / TYPED / mock — unchanged) ===================== */}
            {!truthMode && (
            <>
            <div className="perf-canvaswrap">
              <div className="perf-chartcol">
                <div
                  className="perf-well" id="perfMainWell"
                  onMouseMove={(e) => {
                    // pointer scrub only redraws the OVERLAY layer (base stays put)
                    if (!Perf.bars.length) return;
                    const r = e.currentTarget.getBoundingClientRect(); const padX = 10; const w = r.width;
                    const frac = clamp((e.clientX - r.left - padX) / (w - 2 * padX), 0, 1);
                    Perf.cross = Math.round(frac * (Perf.bars.length - 1)); drawOverlay();
                  }}
                  onMouseLeave={() => { Perf.cross = null; drawOverlay(); }}
                >
                  <canvas id="perfBase" ref={baseRef} />
                  <canvas id="perfOverlay" ref={overlayRef} />
                </div>
                {/* sub-pane canvases: JSX from the active set (the prototype's perfSyncPanes) */}
                <div className="perf-panes" id="perfPanes" ref={panesRef}>
                  {perfActivePanes().map((id) => (
                    <div className="perf-pane" data-pane={id} key={id}><canvas /></div>
                  ))}
                </div>
              </div>
              <div className="perf-legend mono" id="perfLegend" ref={legendRef} />
            </div>
            <div className={"perf-rail" + (Perf.railHidden ? " hidden" : "")} id="perfRail">
              <div className="perf-railhead"><span className="chip">INDICATORS</span><kbd className="dim">I</kbd></div>
              <div className="perf-railscroll" id="perfRailScroll">
                {PERF_TOGGLES.map((g) => (
                  <div className="perf-group" key={g.group}>
                    <span className="glab">{g.group}</span>
                    <div className="perf-toggles">
                      {g.items.map((it) => {
                        const idx = PERF_FLAT.indexOf(it.id); const num = idx < 9 ? String(idx + 1) : "";
                        return (
                          <div key={it.id} className={"perf-chip" + (perfOn[it.id] ? " on" : "")} data-id={it.id} onClick={() => perfToggle(it.id)}>
                            <span className="num">{num}</span>
                            <span className="dot" style={{ background: it.color }} />
                            <span className="lbl">{it.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </>
            )}
          </div>
        </div>
        <div className="perf-roster-wrap"><Roster /></div>
      </div>

      <div className="hintbar screen-hints">
        <span className="h"><kbd>Q</kbd><kbd>E</kbd><span className="t">CYCLE APPS</span></span>
        {/* rail + number toggles are candle-deck verbs — hidden on the truth deck */}
        {!truthMode && <span className="h"><kbd>I</kbd><span className="t">RAIL</span></span>}
        {!truthMode && <span className="h"><kbd>1</kbd>…<kbd>9</kbd><span className="t">TOGGLE</span></span>}
        <span className="h"><kbd>◀</kbd><kbd>▶</kbd><span className="t">ROSTER</span></span>
      </div>
      <div className="escback" data-esc onClick={() => gotoScreen("dash")}><kbd>ESC</kbd><span>BACK</span></div>
    </section>
  );
}
