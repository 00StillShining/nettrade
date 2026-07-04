/* =========================================================================
   TERMINAL 77 — WATCHLIST (WATCHLIST.idx, WND-0x4C — the case-file screen)

   Port of the prototype's #watch section + renderWatchlist + drawWatchChart.
   This is the CALMEST screen in the terminal, and the port preserves that:
   the prototype's tickLoop deliberately has NO 'watch' branch — nothing on
   this screen re-renders per tick. The portrait chart is FULL HISTORY (1Y),
   the dossier is static fundamentals; both change only when the SELECTION
   changes. So the update discipline here is the Dashboard pattern minus the
   tick channel:

   1. STRUCTURE IS JSX — sym / name / tags / statsheet / bio all derive from
      State.selected + UNIVERSE, re-rendered via stateSubscribe(force) when
      the roster moves the selection (or any user-state changes). No refs, no
      setTickText: there are no per-tick numerals on this screen (the roster
      strip and the radar handle their own ticks internally).
   2. CANVAS STAYS CANVAS — one <canvas> ref for the portrait; redrawn by the
      after-every-render effect (mount + selection changes) and by the shell
      through registerRedraw (window resize + the CRT power-off swap/settle,
      where fitCanvas's offsetWidth fallback keeps drawing collapse-safe).
      Matching the prototype, the chart is NOT redrawn on data ticks.
   3. KEYBOARD — the shell already dispatches everything this screen answers
      to (Q/E cycle, ◀▶ roster, TAB panels, ESC, LSHIFT tips). The LSHIFT
      tooltip reveal is pure CSS (.t77.tips .ss-tip) — the shell toggles the
      class; the .ss-tip spans here just have to exist.

   Palette discipline: the chart line is gain/loss (a MARKET number — 1Y
   direction); the radar label chips are teal (info); the tag chips are ink
   outlines; nothing on this screen earns orange (no active verb lives here).
   ========================================================================= */

import { useEffect, useReducer, useRef } from "react";
import { DataEngine, UNIVERSE, fmtUSD, fmtCompact } from "../engine/dataEngine";
import { State, stateSubscribe } from "../state";
import { fitCanvas, drawGlowLine, seriesToPts } from "../components/canvas";
import { registerRedraw, gotoScreen } from "../bus";
import Roster from "../components/Roster";
import Radar from "../components/Radar";

export default function Watchlist() {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /* ================= PORTRAIT CHART (drawWatchChart — in-canvas glow [S2]) ================= */
  function drawChart(): void {
    const cv = canvasRef.current; if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const q = DataEngine.get(State.selected);
    const series = q.hist["1Y"];
    // FULL HISTORY colour anchors to the whole year's direction (first→last),
    // not dayPct — a red day inside a green year still draws a green portrait.
    const up = series[series.length - 1] >= series[0];
    const col = up ? "#4CAF6E" : "#B23A2F";
    const padX = 12, padTop = 16, padBot = 16;
    // faint grid — quieter than the dashboard's (this chart is a portrait, not
    // a working surface: no axis numerals, no crosshair, just the shape)
    ctx.strokeStyle = "rgba(93,139,128,.18)"; ctx.setLineDash([2, 5]); ctx.lineWidth = 1;
    for (let g = 1; g < 4; g++) {
      const y = padTop + (g / 4) * (h - padTop - padBot);
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(w - padX, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    const pts = seriesToPts(series, w, h, padX, padTop, padBot);
    // dramatic motion-trail: echo strokes offset behind the line (the prototype's
    // exact call sequence — drawGlowLine owns globalAlpha internally, so parity
    // means replicating the calls, not re-deriving the intent)
    const echoes = [{ dx: -4, dy: 2, a: 0.12 }, { dx: -2, dy: 1, a: 0.22 }];
    echoes.forEach((e) => {
      const ep = pts.map((p): [number, number] => [p[0] + e.dx, p[1] + e.dy]);
      ctx.globalAlpha = e.a;
      drawGlowLine(ctx, ep, col, { core: 2.0, passes: [{ w: 3, a: 1 }] });
    });
    ctx.globalAlpha = 1;
    drawGlowLine(ctx, pts, col, { core: 2.2 });
    // endpoint marker — solid dot + soft halo where the year ends
    const last = pts[pts.length - 1];
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(last[0], last[1], 3.5, 0, 7); ctx.fill();
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(last[0], last[1], 7, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ---------------- wiring: selection re-render + shell redraw only ---------------- */
  useEffect(() => {
    const unsubState = stateSubscribe(force);      // roster selection (and any user-state) changes
    const unsubRedraw = registerRedraw(drawChart); // shell calls on resize + power-off swap/settle
    return () => { unsubState(); unsubRedraw(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after EVERY render (mount + each selection-driven re-render): repaint the
  // portrait — the canvas half of the prototype's renderWatchlist() (the DOM
  // half IS the render above; the radar is its own component).
  useEffect(() => { drawChart(); });

  const sym = State.selected;
  const q = DataEngine.get(sym);
  const p = UNIVERSE[sym];

  // 52W rails come off the same 1Y series the portrait draws — the statsheet
  // and the chart can never disagree about the year (honest-data law).
  const lo = Math.min(...q.hist["1Y"]), hi = Math.max(...q.hist["1Y"]);
  // [k, v, tip] rows — the prototype's stats array verbatim, including the
  // plain-English .ss-tip lines LSHIFT reveals (values in mono, keys condensed)
  const stats: [string, string, string][] = [
    ["SECTOR", p.sector, "What corner of the market this lives in."],
    ["EXCHANGE", p.exch, "Where it actually trades."],
    ["MARKET CAP", "$" + fmtCompact(p.mcap), "Price times shares — the whole company's tag."],
    ["P/E", isFinite(p.pe) ? p.pe.toFixed(1) : "N/A", "Dollars paid per dollar earned. Lower is cheaper."],
    ["DIV YIELD", p.div ? p.div.toFixed(2) + "%" : "—", "Annual cash it pays you just to hold it."],
    ["52W RANGE", fmtUSD(lo, lo < 10 ? 2 : 0) + " – " + fmtUSD(hi, hi < 10 ? 2 : 0), "Cheapest and dearest it got this year."],
    ["AVG VOLUME", fmtCompact(p.avgvol), "Shares traded on a normal day — liquidity."],
    ["BETA", p.beta.toFixed(2), "How hard it swings vs the market. >1 = wilder."],
  ];

  return (
    <section id="watch" className="appscreen active">
      <div className="screenbody">
        {/* PORTRAIT // FULL HISTORY — the hero: one instrument, one year, one shape */}
        <div className="card watch-portrait-card">
          <span className="plabel">PORTRAIT // FULL HISTORY</span>
          <div className="watch-name-row">
            <span className="watch-sym" id="wSym">{sym.replace("-USD", "")}</span>
            <span className="watch-nm" id="wNm">{p.name}</span>
          </div>
          <div className="watch-tags" id="wTags">
            {p.tags.map((t) => <span className="tag" key={t}>{t}</span>)}
          </div>
          <div className="watch-well"><canvas id="watchChart" ref={canvasRef} /></div>
        </div>

        {/* CASE FILE — the fundamentals dossier + the pentagon fingerprint */}
        <div className="card watch-right" style={{ padding: 16 }}>
          <span className="plabel">CASE FILE</span>
          <div className="hintbar" style={{ marginBottom: 8 }}>
            <span className="h"><kbd className="dim">LSHIFT</kbd><span className="t">HOLD · SHOW TOOLTIPS</span></span>
          </div>
          <div className="statsheet" id="wStats">
            {stats.map(([k, v, tip]) => (
              <div className="ssrow" key={k}>
                <span className="k">{k}</span>
                <span className="v mono">{v}</span>
                <span className="ss-tip">{tip}</span>
              </div>
            ))}
            <div className="bio-block">
              <h4>BIO</h4>
              <p>{p.bio}</p>
              {p.priors && (<><h4>PRIORS</h4><p>{p.priors}</p></>)}
            </div>
          </div>
          {/* reference mode (staged=false): numeric axis values ride the teal chips */}
          <Radar id="wRadarWrap" sym={sym} staged={false} className="watch-radar" />
        </div>

        {/* civilian roster variant — dimmed so the case file stays the hero */}
        <div style={{ gridColumn: "1/-1" }}><Roster dim /></div>
      </div>

      <div className="hintbar screen-hints">
        <span className="h"><kbd>Q</kbd><kbd>E</kbd><span className="t">CYCLE APPS</span></span>
        <span className="h"><kbd>TAB</kbd><span className="t">PANELS</span></span>
        <span className="h"><kbd>◀</kbd><kbd>▶</kbd><span className="t">ROSTER</span></span>
      </div>
      <div className="escback" onClick={() => gotoScreen("dash")}><kbd>ESC</kbd><span>BACK</span></div>
    </section>
  );
}
