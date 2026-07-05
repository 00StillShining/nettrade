/* =========================================================================
   TERMINAL 77 — DASHBOARD (the reference screen port; the pattern the other
   nine screens copy)

   THE PORT'S UPDATE DISCIPLINE (from the prototype's setTickText rigour):
   1. STRUCTURE IS JSX — rendered from State/UNIVERSE, re-rendered ONLY when
      user-state changes (selection, range) via stateSubscribe(forceRender).
   2. TICK VALUES ARE IMPERATIVE — a DataEngine.subscribe handler patches the
      live numerals through refs + setTickText (digit-level flash) and redraws
      the canvas. NO React re-render per tick, NO DOM rebuild: the exact
      "targeted state" discipline the prototype's tickLoop kept.
   3. CANVAS STAYS CANVAS — one <canvas> ref, redrawn on tick/range/resize;
      glow is in-canvas multi-pass ([S2]), crosshair is a mousemove redraw.
   4. LIST RECONCILIATION — the movers lists reuse the prototype's keyed
      innerHTML skeletons (dataset.key) inside ref'd divs so a slot that keeps
      its ticker across ticks keeps its DOM and setTickText can flash only the
      changed digits. The idx chips build their skeleton once and patch.
   5. THE SHELL REDRAWS US — registerRedraw() hands the shell a "re-fit +
      redraw" closure it calls mid power-off and at settle (fitCanvas's
      offsetWidth fallback makes drawing under the collapse transform safe).
   ========================================================================= */

import { useEffect, useReducer, useRef } from "react";
import {
  DataEngine, UNIVERSE, DEFAULT_ROSTER, IDX_DEFS, RANGES,
  fmtUSD, fmtMoney, fmtNum, fmtPct, arrow, glClass, clamp, type Range,
} from "../engine/dataEngine";
import { State, stateSubscribe, notifyState, computeEquity, dayPnl } from "../state";
import { fitCanvas, drawGlowLine, seriesToPts, sparkPath } from "../components/canvas";
import { setTickText } from "../components/dom";
import { marqueeState, subscribeMarquee, registerRedraw, prefersReduced } from "../bus";
// TruthStore feeds the as-of freshness stamp (item 34: syncedAtISO). May tsc-drift
// until worker C's edits land, but the module exists — keep the usage.
import { TruthStore } from "../engine/truthStore";
import Roster from "../components/Roster";

// VITE_MOCK builds keep the locked seed-77 look byte-for-byte: the stamp (23),
// the synthetic/real honesty labels (28) and the freshness stamp (34) are all
// LIVE-only. This one compile-time constant tree-shakes the whole set out of a
// design build. The masthead itself already flips on State.liveAccount, so the
// "live world is active" signal we gate the money-STAMP on is a real liveAccount.
const IS_MOCK = import.meta.env.VITE_MOCK === "1";

/** "as of HH:MM" body + staleness from an ISO sync time. null iso → empty (no
 *  claim). >10min old → stale (the poller may have failed silently). Pure, cheap
 *  to call every tick. */
function asOf(iso: string | null): { text: string; stale: boolean } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const stale = Date.now() - t > 10 * 60_000; // >10 minutes since the last good sync
  return { text: `${hh}:${mm}`, stale };
}

export default function Dashboard() {
  const [, force] = useReducer((n: number) => n + 1, 0);

  // ---- refs: every element whose content ticks (React renders them EMPTY
  // or with an initial value; the patchers own them afterwards) ----
  const acctValRef = useRef<HTMLDivElement | null>(null);
  const acctDayRef = useRef<HTMLSpanElement | null>(null);
  const acctBPRef = useRef<HTMLDivElement | null>(null);
  const acctPosRef = useRef<HTMLDivElement | null>(null);
  const marginFillRef = useRef<HTMLElement | null>(null);
  const marginUsedRef = useRef<HTMLSpanElement | null>(null);
  const marginMaxRef = useRef<HTMLSpanElement | null>(null);
  const idxWrapRef = useRef<HTMLDivElement | null>(null);
  const gainListRef = useRef<HTMLDivElement | null>(null);
  const loseListRef = useRef<HTMLDivElement | null>(null);
  const chLastRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const crossX = useRef<number | null>(null); // hover crosshair state for main chart
  const acctAsofRef = useRef<HTMLDivElement | null>(null);   // item 34 "as of HH:MM" stamp
  // item 23: the last REAL masthead total we've seen (minor units). We stamp only
  // when a live sync moves it — never on the mock walk. `undefined` = not yet seen
  // (first live paint is not a "change", so it doesn't stamp).
  const lastLiveTotalMinor = useRef<number | undefined>(undefined);

  /* ================= ITEM 23 · ONE-SHOT PERSONA STAMP (ref-toggled, no re-render) =================
     Add `.stamped`; remove it on animationend so the NEXT real sync can replay it.
     Under prefersReduced the class is inert (CSS zeroes the animation) but we still
     add/remove it harmlessly — no motion, matches the quiet mock digit-flash. Idempotent:
     if a stamp is mid-flight we restart it (force reflow) so a rapid re-sync re-stamps. */
  function playStamp(el: HTMLElement | null): void {
    if (!el || prefersReduced) return;
    el.classList.add("stamp-target");
    el.classList.remove("stamped");
    void el.offsetWidth;            // reflow so re-adding the class restarts the keyframes
    el.classList.add("stamped");
    // clear only when the LONGEST animation ends: the ::after ink-swell
    // (t77-inkSwell, 300ms + 40ms delay) outlives the 260ms figure stamp, and a
    // pseudo-element's animationend also targets the host — clearing on the
    // FIRST event would cut the underline off at ~65%.
    const clear = (e: AnimationEvent): void => {
      if (e.animationName !== "t77-inkSwell") return;
      el.classList.remove("stamped");
      el.removeEventListener("animationend", clear);
    };
    el.addEventListener("animationend", clear);
  }

  /* ================= ITEM 34 · AS-OF FRESHNESS STAMP (masthead) ================= */
  function renderAsof(): void {
    const el = acctAsofRef.current; if (!el) return;
    // LIVE builds only, and only once we actually have a live account link — under
    // mock (or before first live sync) there's no honest "as of" to claim.
    if (IS_MOCK || !State.liveAccount) { el.className = "asof acct-asof"; el.textContent = ""; return; }
    const a = asOf(TruthStore.syncedAtISO);
    if (!a) { el.className = "asof acct-asof"; el.textContent = ""; return; }
    const cls = "asof acct-asof" + (a.stale ? " stale" : "");
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

  /* ================= ACCOUNT MASTHEAD (renderDashAccount, refs for $()) ================= */
  function renderAccount(): void {
    // LIVE: use Trading 212's own reported account figures (the correct account-
    // currency total — computeEquity() would mix a GBP account with USD stock
    // prices). MOCK: the seed-77 computeEquity in $.
    const live = State.liveAccount;
    const ccy = State.accountCcy;
    const { mv, total: mockTotal } = computeEquity();
    const total = live ? live.totalMinor / 100 : mockTotal;
    // P&L: live → T212's total open P/L (honest headline); mock → seed day P&L.
    const pl = live ? live.pplMinor / 100 : dayPnl();
    const invested = live ? total - live.freeMinor / 100 : mv;
    const plPct = invested - pl !== 0 ? (pl / (invested - pl)) * 100 : 0;
    const money = (n: number, dp = 2) => (live ? fmtMoney(n, ccy, dp) : fmtUSD(n, dp));
    // ITEM 23 — Persona stamp on a REAL money change. We compare the live account
    // total (minor units, the honest headline the broker reports) against the last
    // one we stamped: a change means a live sync actually moved money. The mock walk
    // NEVER reaches here with a `live` object, so the quiet digit-flash (setTickText
    // below) stays the only mock feedback — the stamp is reserved for real money.
    if (!IS_MOCK && live) {
      const prev = lastLiveTotalMinor.current;
      if (prev !== undefined && live.totalMinor !== prev) playStamp(acctValRef.current);
      lastLiveTotalMinor.current = live.totalMinor;
    }
    setTickText(acctValRef.current, money(total));
    const dEl = acctDayRef.current;
    if (dEl) {
      dEl.className = "acct-day mono " + glClass(pl);
      dEl.textContent = `${arrow(pl)} ${money(Math.abs(pl))} (${fmtPct(plPct)})`;
    }
    const bp = live ? live.freeMinor / 100 : State.cash;
    if (acctBPRef.current) acctBPRef.current.textContent = money(bp);
    let posCount = 0; for (const s in State.positions) if (State.positions[s].qty > 0) posCount++;
    if (acctPosRef.current) acctPosRef.current.textContent = posCount + " OPEN";
    const marginUsed = invested * 0.35, marginMax = total * 0.5;
    if (marginFillRef.current) marginFillRef.current.style.width = clamp(marginMax ? (marginUsed / marginMax) * 100 : 0, 2, 100).toFixed(0) + "%";
    if (marginUsedRef.current) marginUsedRef.current.textContent = money(marginUsed, 0);
    if (marginMaxRef.current) marginMaxRef.current.textContent = "/ " + money(marginMax, 0);
  }

  /* ================= INDEX CHIPS (renderIndices — skeleton once, patch after) ================= */
  function renderIndices(): void {
    // synthetic indices derived deterministically so they feel like a market, not
    // roster dupes. Build the chip skeleton ONCE (keyed by index name); on every
    // subsequent tick route the price/pct through setTickText for digit-level
    // flash instead of rebuilding innerHTML.
    const wrap = idxWrapRef.current; if (!wrap) return;
    const build = wrap.childElementCount !== IDX_DEFS.length;
    if (build) wrap.innerHTML = "";
    IDX_DEFS.forEach((o, i) => {
      const q = DataEngine.get(o.sym);
      const pct = o.invert ? -q.dayPct * 1.4 : q.dayPct;
      const val = o.nm === "VIX" ? (14 + Math.abs(q.dayPct) * 1.6) : q.last * o.mult;
      const col = pct >= 0 ? "var(--gain)" : "var(--loss)";
      const series = q.hist["1D"].slice(-30).map((v) => o.invert ? -v : v);
      const valTxt = o.nm === "VIX" ? val.toFixed(2) : fmtNum(val);
      const pctTxt = `${arrow(pct)}${Math.abs(pct).toFixed(2)}%`;
      let el: Element;
      if (build) {
        const d = document.createElement("div"); d.className = "idxchip";
        // ITEM 28a — these indices are SYNTHETIC (derived deterministically from the
        // roster walk), so in a live build — where the masthead beside them is LIVE —
        // they carry a tiny MODEL badge (the established News/Scanner honesty grammar).
        // Mock builds omit it: the whole mock world is simulated and its look is locked.
        const modelChip = !IS_MOCK ? `<span class="idx-model">MODEL</span>` : "";
        d.innerHTML = `
          ${modelChip}
          <svg class="spk" viewBox="0 0 56 22" preserveAspectRatio="none"><path fill="none" stroke-width="1.5"/></svg>
          <div class="nm">${o.nm}</div>
          <div class="pr mono" data-pr></div>
          <div class="pc mono" data-pc></div>`;
        wrap.appendChild(d); el = d;
      } else { el = wrap.children[i]; }
      const path = el.querySelector(".spk path")!;
      path.setAttribute("d", sparkPath(series, 56, 22));
      path.setAttribute("stroke", col);
      setTickText(el.querySelector<HTMLElement>("[data-pr]"), valTxt);
      const pcEl = el.querySelector<HTMLElement>("[data-pc]")!;
      pcEl.className = "pc mono " + glClass(pct);
      setTickText(pcEl, pctTxt);
    });
  }

  /* ================= MOVERS (renderMoverList/renderMovers — keyed skeleton) ================= */
  // reconcile one movers list into stable rows keyed by ticker: reuse a row's
  // existing pct span (so setTickText can flash the changed digits) when the same
  // ticker holds a slot across ticks; only rebuild when a slot's ticker changes.
  function renderMoverList(listEl: HTMLElement | null, items: { s: string; pct: number }[]): void {
    if (!listEl) return;
    if (!items.length) {
      if (listEl.dataset.key !== "—") {
        listEl.innerHTML = `<div class="mover"><span class="t" style="color:var(--ink-soft);font-weight:700;">—</span><span class="mono" style="color:var(--ink-soft);">—</span></div>`;
        listEl.dataset.key = "—";
      }
      return;
    }
    const key = items.map((o) => o.s).join(",");
    if (listEl.dataset.key !== key) {
      // membership/order changed — rebuild skeleton, keyed rows, empty pct spans to fill below
      listEl.innerHTML = items.map((o) => `<div class="mover" data-sym="${o.s}"><span class="t">${o.s.replace("-USD", "")}</span><span class="mono" data-pc></span></div>`).join("");
      listEl.dataset.key = key;
    }
    items.forEach((o, i) => {
      const pcEl = listEl.children[i].querySelector<HTMLElement>("[data-pc]")!;
      pcEl.className = "mono " + glClass(o.pct);
      setTickText(pcEl, `${arrow(o.pct)}${Math.abs(o.pct).toFixed(2)}%`);
    });
  }
  function renderMovers(): void {
    const rows = DEFAULT_ROSTER.map((s) => ({ s, pct: DataEngine.get(s).dayPct })).sort((a, b) => b.pct - a.pct);
    // filter by sign so a green session can't parade gainers under TOP LOSERS (and
    // vice-versa). A side with <3 qualifiers renders an ink-soft placeholder row.
    const gain = rows.filter((r) => r.pct > 0).slice(0, 3);
    const lose = rows.filter((r) => r.pct < 0).slice(-3).reverse();
    renderMoverList(gainListRef.current, gain);
    renderMoverList(loseListRef.current, lose);
  }

  /* ================= MAIN CHART (drawMainChart — in-canvas glow [S2]) ================= */
  function drawChart(): void {
    const cv = canvasRef.current; if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const q = DataEngine.get(State.selected);
    const series = q.hist[State.range];
    // On 1D, anchor colour to the roster's fixed prevClose (q.dayPct) so the chart never
    // shows red beside a green ▲ for the same symbol once the rolling day array shifts.
    const up = State.range === "1D" ? q.dayPct >= 0 : series[series.length - 1] >= series[0];
    const col = up ? "#4CAF6E" : "#B23A2F";
    const padX = 10, padTop = 12, padBot = 22;
    // dotted teal gridlines
    ctx.strokeStyle = "rgba(93,139,128,.28)"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    const min = Math.min(...series), max = Math.max(...series);
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = "rgba(93,139,128,.75)";
    for (let g = 0; g <= 4; g++) {
      const y = padTop + (g / 4) * (h - padTop - padBot);
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(w - padX, y); ctx.stroke();
      const val = max - (g / 4) * (max - min);
      // span-aware decimals: a tight intraday range must never print duplicate
      // axis labels (128/127/127/126/126 = a dishonest axis).
      const spanDp = (max - min) < 1 ? 3 : (max - min) < 8 ? 2 : (val < 10 ? 3 : 0);
      ctx.fillText(fmtNum(val, spanDp), padX + 2, y - 2);
    }
    ctx.setLineDash([]);
    const pts = seriesToPts(series, w, h, padX, padTop, padBot);
    // area fill under line (subtle)
    ctx.beginPath(); pts.forEach((p, i) => { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.lineTo(pts[pts.length - 1][0], h - padBot); ctx.lineTo(pts[0][0], h - padBot); ctx.closePath();
    ctx.fillStyle = up ? "rgba(76,175,110,.10)" : "rgba(178,58,47,.10)"; ctx.fill();
    drawGlowLine(ctx, pts, col, { core: 1.8 });
    // time axis labels
    ctx.fillStyle = "rgba(93,139,128,.75)"; ctx.font = '10px "IBM Plex Mono", monospace';
    const labs = State.range === "1D" ? ["09:30", "11:00", "12:30", "14:00", "16:00"] :
                 State.range === "1W" ? ["MON", "TUE", "WED", "THU", "FRI"] :
                 State.range === "1M" ? ["W1", "W2", "W3", "W4"] : ["Q1", "Q2", "Q3", "Q4"];
    labs.forEach((lb, i) => {
      const x = padX + (i / (labs.length - 1)) * (w - 2 * padX);
      ctx.textAlign = i === 0 ? "left" : i === labs.length - 1 ? "right" : "center";
      ctx.fillText(lb, x, h - 6);
    });
    ctx.textAlign = "left";
    // orange crosshair + readout
    if (crossX.current != null) {
      const idx = clamp(Math.round((crossX.current - padX) / (w - 2 * padX) * (series.length - 1)), 0, series.length - 1);
      const px = pts[idx][0], py = pts[idx][1];
      ctx.strokeStyle = "#D9942B"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(px, padTop); ctx.lineTo(px, h - padBot); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#D9942B"; ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
      const val = series[idx];
      const txt = fmtUSD(val, val < 10 ? 4 : 2);
      ctx.font = '600 11px "IBM Plex Mono", monospace';
      const tw = ctx.measureText(txt).width + 8;
      let bx = px + 6; if (bx + tw > w - 2) bx = px - 6 - tw;
      ctx.fillStyle = "#D9942B"; ctx.fillRect(bx, py - 16, tw, 15);
      ctx.fillStyle = "#23201A"; ctx.fillText(txt, bx + 4, py - 5);
    }
  }

  /* ================= ALERTS MARQUEE (bus-fed; Dashboard renders the track) ================= */
  function renderMarquee(): void {
    const track = trackRef.current; if (!track) return;
    const { msgs, flashing } = marqueeState();
    // brief §3.4: a triggered alert flashes orange ONCE, then settles to paper-on-ink.
    // Only the freshly-pushed message carries .fl; everything else stays calm.
    const html = msgs.map((m) => `<span class="${m === flashing ? "fl" : ""}">${m}</span>`).join("");
    track.innerHTML = html + html; // duplicate for seamless loop
  }

  function patchLast(): void {
    const q = DataEngine.get(State.selected);
    setTickText(chLastRef.current, fmtUSD(q.last, q.last < 10 ? 4 : 2));
  }

  /* ---------------- wiring: structure re-render + tick patch channels ---------------- */
  useEffect(() => {
    const unsubState = stateSubscribe(force);           // selection / range / book changes
    const unsubTick = DataEngine.subscribe(() => {      // 1–2s walk: patch numerals, no re-render
      renderAccount(); renderIndices(); renderMovers(); patchLast();
      renderAsof();                                     // recompute staleness each tick (item 34)
      if (State.range === "1D") drawChart();
    });
    const unsubMarq = subscribeMarquee(renderMarquee);
    const unsubRedraw = registerRedraw(drawChart);      // shell calls on resize + power-off swap/settle
    // A history-sync landing updates syncedAtISO AND may move liveAccount → refresh
    // the as-of stamp and re-run the masthead so a real money change can stamp (23).
    // No-op / inert under VITE_MOCK (TruthStore stays empty; renderAsof early-returns).
    const unsubTruth = TruthStore.subscribe(() => { renderAccount(); renderAsof(); });
    renderMarquee();
    return () => { unsubState(); unsubTick(); unsubMarq(); unsubRedraw(); unsubTruth(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after EVERY render (mount + each state-driven re-render): full repaint —
  // the prototype's renderDashboard(), minus the marquee (event-driven above).
  useEffect(() => {
    renderAccount(); renderIndices(); renderMovers(); patchLast(); renderAsof(); drawChart();
  });

  const sym = State.selected; const p = UNIVERSE[sym];

  return (
    <section id="dash" className="appscreen active">
      <div className="screenbody">
        {/* ACCOUNT // MAIN */}
        <div className="card" id="dashAcct">
          <span className="plabel">ACCOUNT // MAIN</span>
          <div className="acct-val mono" ref={acctValRef} />
          <div className="acct-row">
            <span className="acct-day mono" ref={acctDayRef} />
          </div>
          {/* ITEM 34 — as-of freshness stamp (live builds only; empty otherwise) */}
          <div className="asof acct-asof" ref={acctAsofRef} />
          {/* item 23: the masthead value gets the .stamp-target box on first live render
              (playStamp adds it); no structural change to the box under mock. */}
          <div className="acct-sub">
            <div><div className="lab">Buying Power</div><div className="num mono" ref={acctBPRef} /></div>
            <div><div className="lab">Positions</div><div className="num mono" ref={acctPosRef} /></div>
          </div>
          <div className="margin-wrap">
            <div className="acct-sub" style={{ margin: "0 0 4px" }}><div><div className="lab">Margin Used</div></div></div>
            <div className="margin-bar"><i ref={marginFillRef} style={{ width: "34%" }} /></div>
            <div className="margin-cap"><span ref={marginUsedRef} /><span ref={marginMaxRef} /></div>
          </div>
        </div>

        {/* INDICES (skeleton built + patched imperatively) */}
        <div id="dashIdx" ref={idxWrapRef} />

        {/* CHART // INTRADAY */}
        <div className="card" id="dashChart">
          <span className="plabel">CHART // INTRADAY</span>
          <div className="chart-head">
            <div className="who">
              <span className="sym">{sym.replace("-USD", "")}</span>
              <span className="nm">{p.name}</span>
              <span className="last mono" ref={chLastRef} />
            </div>
            <div className="rangetog">
              {RANGES.map((r: Range) => (
                <button key={r} className={r === State.range ? "on" : ""} onClick={() => { State.range = r; notifyState(); }}>{r}</button>
              ))}
            </div>
          </div>
          <div className="chartwell">
            <canvas
              ref={canvasRef}
              onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); crossX.current = e.clientX - r.left; drawChart(); }}
              onMouseLeave={() => { crossX.current = null; drawChart(); }}
            />
          </div>
          <div className="chart-alerts">
            <div className="marquee"><div className="track" ref={trackRef} /></div>
          </div>
        </div>

        {/* MOVERS // SESSION */}
        <div className="card" id="dashMovers">
          <span className="plabel">MOVERS // SESSION</span>
          {/* ITEM 28b — in a live build the movers are the REAL held roster sorted by
              real (FMP-enriched) day-%, so the rail earns an honest "ROSTER" note. The
              mock build parades the seed roster and stays unlabelled — its look is locked. */}
          {!IS_MOCK && State.liveAccount && <div className="movers-src">SOURCE · ROSTER · REAL DAY %</div>}
          <div className="movers-col"><span className="chip teal" style={{ marginBottom: 6 }}>TOP GAINERS</span><div ref={gainListRef} /></div>
          <div className="movers-col"><span className="chip teal" style={{ marginBottom: 6 }}>TOP LOSERS</span><div ref={loseListRef} /></div>
        </div>

        {/* ROSTER */}
        <div id="dashRoster"><Roster /></div>
      </div>

      <div className="hintbar screen-hints">
        <span className="h"><kbd>Q</kbd><kbd>E</kbd><span className="t">CYCLE APPS</span></span>
        <span className="h"><kbd>TAB</kbd><span className="t">PANELS</span></span>
        <span className="h"><kbd>◀</kbd><kbd>▶</kbd><span className="t">ROSTER</span></span>
      </div>
      {/* diegetic "you are home" marker — a status, not an action (ESC exits to the Animus) */}
      <div className="escback root"><kbd className="dim">ESC</kbd><span>ROOT</span></div>
    </section>
  );
}
