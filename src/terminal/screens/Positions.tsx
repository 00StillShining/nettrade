/* =========================================================================
   TERMINAL 77 — POSITIONS (POSITIONS.dat — the dossier + stage/confirm ticket)

   Port of the prototype's #pos section + renderPositions + drawSilhouette +
   the first-run tutorial (maybeTutorial/dismissTutorial). The screen follows
   the Dashboard reference discipline exactly:

   1. STRUCTURE IS JSX — header (sym/name/tags), strategy checkboxes, the
      RESET/CONFIRM disabled states and the BP `.staged` class all derive
      from State and re-render via stateSubscribe(force). Every mutation
      that changes them (stageDelta/resetStage/confirmStage/toggleStrategy/
      selectInstrument) already ends in notifyState().
   2. TICK VALUES ARE IMPERATIVE — the stat rows (LAST / MARKET VALUE / P&L),
      the unspent-buying-power numeral and the EST. COST/PROCEEDS line all
      move with the 1–2s walk, so a DataEngine.subscribe handler repaints
      them through refs (setTickText digit flash for the stat rows, exactly
      the prototype's renderPositions-per-tick). NO React re-render per tick.
   3. THE STAT SKELETON IS KEYED — the prototype built the six .statrow
      shells ONCE per (symbol + which-rows-are-staged) signature via
      dataset.sig, then routed values through setTickText so only changed
      digits flash. Ported verbatim onto a ref'd div.
   4. THE RADAR IS THE SHARED COMPONENT — <Radar staged> owns its own tween
      + per-tick redraw (the prototype's tickLoop/resize also redrew it);
      staged-qty changes arrive as props from the state re-render.
   5. THE SILHOUETTE STAYS SVG — drawSilhouette writes one path into the
      ref'd #posSilhouette (viewBox 0 0 100 100, preserveAspectRatio none,
      so window resizes stretch it for free; registerRedraw re-fits anyway,
      mirroring redrawActiveCharts).

   KEYBOARD SPLIT (shell vs here): Terminal.tsx already dispatches every
   state-only key for this screen (▲▼/+/- stage, ENTER confirm when NOT
   editing, X reset, F strategy). This file registers a key-extra for the
   two behaviours that need THIS screen's DOM:
     • the tutorial gate — while the DESK 07 briefing is up, EVERY key is
       swallowed and ENTER dismisses (the prototype's early-return before
       its whole keydown switch);
     • ENTER while the stepQty input is focused — commit the typed level,
       clamp, blur (the prototype's editing branch of case 'enter'). The
       extra runs BEFORE the shell's map, so blurring here can never let
       the same keypress fall through and CONFIRM the order.
   ========================================================================= */

import { useEffect, useReducer, useRef } from "react";
import { DataEngine, UNIVERSE, fmtUSD, glClass } from "../engine/dataEngine";
import {
  State, stateSubscribe, notifyState, positionFor, clampStaged,
  stageDelta, resetStage, confirmStage, toggleStrategy,
} from "../state";
import { setTickText } from "../components/dom";
import { registerRedraw, registerKeyExtra, pushMarquee, gotoScreen, type KeyExtra } from "../bus";
// TruthStore feeds the as-of freshness stamp (item 34: syncedAtISO). May tsc-drift
// until worker C's edits land, but the module exists — keep the usage.
import { TruthStore } from "../engine/truthStore";
import Radar from "../components/Radar";
import Roster from "../components/Roster";

// VITE_MOCK builds stay seed-77, look locked: the as-of freshness stamp (item 34)
// is LIVE-only. Tree-shaken out of design builds by this compile-time constant.
const IS_MOCK = import.meta.env.VITE_MOCK === "1";

/** "as of HH:MM" body + staleness from an ISO sync time. null iso → null (no
 *  claim). >10min old → stale (the poller may have failed silently). */
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

/* ---------------- stat-row icons (prototype STAT_IC, verbatim) ---------------- */
const STAT_IC: Record<string, string> = {
  "QTY": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="14" height="14"/><path d="M7 7h6M7 10h6M7 13h4"/></svg>',
  "AVG COST": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7"/><path d="M10 6v8M8 8h3a1.5 1.5 0 010 3H8"/></svg>',
  "LAST": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 14l4-5 3 3 6-7"/></svg>',
  "MARKET VALUE": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="14" height="9"/><circle cx="10" cy="10.5" r="2"/></svg>',
  "UNREALIZED P&L": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 12l3-3 3 2 5-6"/><path d="M14 5h2v2"/></svg>',
  "DAY P&L": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>',
};

// one stat line: [label, current, staged-preview | null, ink-class?]
type StatRow = [string, string, string | null, ("gain" | "loss")?];

export default function Positions() {
  const [, force] = useReducer((n: number) => n + 1, 0);

  // ---- refs: everything the tick patcher owns (React renders these EMPTY) ----
  const bpRef = useRef<HTMLSpanElement | null>(null);         // #posBP numeral
  const statsRef = useRef<HTMLDivElement | null>(null);       // #posStats (keyed innerHTML skeleton)
  const qtyRef = useRef<HTMLInputElement | null>(null);       // #stepQty (uncontrolled; patcher sets value)
  const estRef = useRef<HTMLDivElement | null>(null);         // #estLine (EST. COST / PROCEEDS)
  const silRef = useRef<SVGSVGElement | null>(null);          // #posSilhouette
  const tutRef = useRef<HTMLDivElement | null>(null);         // #tutorial overlay
  const tutPortraitRef = useRef<HTMLDivElement | null>(null); // pixel-art canvas slot
  const asofRef = useRef<HTMLDivElement | null>(null);        // item 34 "as of HH:MM" stamp (positions header)

  /* ================= ITEM 34 · AS-OF FRESHNESS STAMP (positions header) ================= */
  function renderAsof(): void {
    const el = asofRef.current; if (!el) return;
    // LIVE builds only, and only once the T212 account link is live (real money on
    // screen). Mock / pre-sync → empty (no honest "as of" to claim).
    if (IS_MOCK || !State.liveAccount) { el.className = "asof"; el.textContent = ""; return; }
    const a = asOf(TruthStore.syncedAtISO);
    if (!a) { el.className = "asof"; el.textContent = ""; return; }
    const cls = "asof" + (a.stale ? " stale" : "");
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

  /* ================= SILHOUETTE (screened-back duotone portrait — verbatim) ================= */
  function drawSilhouette(): void {
    const svg = silRef.current; if (!svg) return;
    const q = DataEngine.get(State.selected); const series = q.hist["1Y"];
    const min = Math.min(...series), max = Math.max(...series), rng = (max - min) || 1;
    const N = series.length;
    let d = "M0 100";
    series.forEach((v, i) => { const x = (i / (N - 1)) * 100; const y = 100 - ((v - min) / rng) * 78 - 4; d += ` L${x.toFixed(2)} ${y.toFixed(2)}`; });
    d += " L100 100 Z";
    svg.innerHTML = `<path d="${d}" fill="rgba(93,139,128,.18)" stroke="rgba(93,139,128,.30)" stroke-width="0.4" vector-effect="non-scaling-stroke"/>`;
  }

  /* ================= NUMBERS COLUMN (renderPositions' imperative half) =================
     Runs on every tick AND after every render. The prototype called the whole
     renderPositions() per tick; here the JSX half (header/tags/strategy/buttons)
     only re-renders on state changes, and THIS patches everything that moves
     with the price walk. */
  function renderNumbers(): void {
    const sym = State.selected; const q = DataEngine.get(sym);
    const pos = positionFor(sym);
    const staged = State.staged;
    const newQty = pos.qty + staged;
    const last = q.last;
    const mv = pos.qty * last, mvNew = newQty * last;
    const unrl = pos.qty > 0 ? (last - pos.avgCost) * pos.qty : 0;
    const dpnl = pos.qty > 0 ? (last - q.prevClose) * pos.qty : 0;
    // new avg cost if adding
    let newAvg = pos.avgCost;
    if (staged > 0) { newAvg = pos.qty > 0 ? ((pos.avgCost * pos.qty) + (last * staged)) / (pos.qty + staged) : last; }
    const rows: StatRow[] = [
      ["QTY", String(pos.qty), staged !== 0 ? String(newQty) : null],
      ["AVG COST", fmtUSD(pos.avgCost), (staged > 0 && newAvg !== pos.avgCost) ? fmtUSD(newAvg) : null],
      ["LAST", fmtUSD(last, last < 10 ? 4 : 2), null],
      ["MARKET VALUE", fmtUSD(mv), staged !== 0 ? fmtUSD(mvNew) : null],
      ["UNREALIZED P&L", fmtUSD(unrl), null, glClass(unrl)],
      ["DAY P&L", fmtUSD(dpnl), null, glClass(dpnl)],
    ];
    // Build stat-row skeletons ONCE per (symbol + which-rows-are-staged) signature, then
    // route the CURRENT value of tick-driven rows (LAST/MARKET VALUE/P&L) through
    // setTickText for digit-level flash. Staged "→ delta" spans are user-driven, so plain
    // textContent — they only appear/change on an explicit stage, never on a passive tick.
    const posStats = statsRef.current;
    if (posStats) {
      const sig = sym + "|" + rows.map((r) => r[2] != null ? 1 : 0).join("");
      if (posStats.dataset.sig !== sig) {
        posStats.innerHTML = rows.map((r) => {
          const [lab, , stg] = r;
          const valHtml = stg != null
            ? `<span data-cur></span><span class="arrow">→</span><span class="delta" data-delta></span>`
            : `<span data-cur></span>`;
          return `<div class="statrow"><span class="ic">${STAT_IC[lab] || ""}</span><span class="lab">${lab}</span><span class="val mono">${valHtml}</span></div>`;
        }).join("");
        posStats.dataset.sig = sig;
      }
      rows.forEach((r, i) => {
        const [, cur, stg, cls] = r;
        const rowEl = posStats.children[i];
        const curEl = rowEl.querySelector<HTMLElement>("[data-cur]")!;
        curEl.className = stg != null ? "" : (cls || "");
        setTickText(curEl, cur);
        if (stg != null) { const dEl = rowEl.querySelector<HTMLElement>("[data-delta]"); if (dEl) dEl.textContent = stg; }
      });
    }

    // stepper + est line + buying power
    // don't clobber a quantity the user is mid-typing (commit lands on blur/Enter)
    const qtyEl = qtyRef.current;
    if (qtyEl && document.activeElement !== qtyEl) qtyEl.value = String(staged);
    const estEl = estRef.current, bpEl = bpRef.current;
    if (staged !== 0) {
      const cost = staged * last;
      if (estEl) {
        if (staged > 0) estEl.innerHTML = `EST. COST: <b>${fmtUSD(cost)}</b>`;
        else estEl.innerHTML = `EST. PROCEEDS: <b>${fmtUSD(Math.abs(cost))}</b>`;
      }
      // reflect staged BP (a sell stages no spend — proceeds land only on CONFIRM)
      if (bpEl) bpEl.textContent = fmtUSD(State.cash - Math.max(0, cost));
    } else {
      if (estEl) estEl.innerHTML = "";
      if (bpEl) bpEl.textContent = fmtUSD(State.cash);
    }

    drawSilhouette(); // 1Y portrait tracks live crypto re-anchors, exactly the prototype's per-tick redraw
    renderAsof();     // item 34: recompute the header freshness stamp each tick (staleness ticks over)
  }

  /* ================= STAGE / CONFIRM plumbing ================= */
  // CONFIRM — the state half lives in state.ts (re-clamp, fill, ORDER star);
  // the marquee push is the shell-visible side effect (prototype pushAlert).
  function doConfirm(): void {
    const fill = confirmStage();
    if (fill) pushMarquee("▸ ORDER FILLED :: " + fill.line, true);
  }
  // typed-qty commit (prototype #stepQty change listener + the editing ENTER branch)
  function commitTypedQty(): void {
    const el = qtyRef.current; if (!el) return;
    const v = parseInt(el.value, 10);
    State.staged = isNaN(v) ? 0 : v;
    clampStaged();
    notifyState();
  }

  /* ================= FIRST-RUN TUTORIAL (maybeTutorial / dismissTutorial) =================
     Kept imperative-on-refs like the prototype (classList 'show'), so the key
     extra can read "is the briefing up?" without a stale closure. Leaving the
     screen unmounts the overlay entirely — the prototype's "never strand the
     tutorial open on another screen" guard comes for free. */
  function tutorialOpen(): boolean { return !!tutRef.current?.classList.contains("show"); }
  function dismissTutorial(): void { tutRef.current?.classList.remove("show"); }
  function maybeTutorial(): void {
    if (State.tutorialShown) return;
    State.tutorialShown = true;
    const wrap = tutPortraitRef.current, tut = tutRef.current;
    if (!wrap || !tut) return;
    // pixel-art dispatcher portrait (tiny canvas — verbatim)
    const c = document.createElement("canvas"); c.width = 46; c.height = 46;
    const x = c.getContext("2d")!;
    const P = (px: number, py: number, col: string, s = 6): void => { x.fillStyle = col; x.fillRect(px * s, py * s, s, s); };
    x.fillStyle = "#16241F"; x.fillRect(0, 0, 46, 46);
    // face
    for (let i = 2; i <= 5; i++) for (let j = 1; j <= 5; j++) P(i, j, "#C9A27A");
    P(2, 2, "#8A6B45"); P(5, 2, "#8A6B45"); // hair edges
    for (let i = 2; i <= 5; i++) P(i, 0, "#3A2E20"); P(2, 1, "#3A2E20"); P(5, 1, "#3A2E20");
    P(3, 3, "#23201A"); P(4, 3, "#23201A"); // eyes
    P(3, 4, "#8A6B45"); // nose/mouth hint
    // headset
    P(1, 2, "#D9942B"); P(1, 3, "#D9942B"); P(6, 2, "#D9942B"); P(1, 4, "#D9942B");
    // collar
    for (let i = 1; i <= 6; i++) P(i, 6, "#5D8B80");
    wrap.innerHTML = ""; wrap.appendChild(c);
    c.style.width = "100%"; c.style.height = "100%"; c.style.imageRendering = "pixelated";
    tut.classList.add("show");
  }

  /* ================= KEY EXTRA (DOM-touching keys — runs BEFORE the shell map) ================= */
  const keyExtra: KeyExtra = (e, editing) => {
    // Tutorial gate: while the briefing is up, ENTER dismisses and EVERY other
    // key is swallowed (the prototype returned before its whole keydown switch,
    // so Q/E/arrows/ESC can't drive the terminal under the modal).
    if (tutorialOpen()) {
      if (e.key === "Enter") { dismissTutorial(); e.preventDefault(); }
      return true;
    }
    // ENTER while typing in #stepQty: commit the staged LEVEL, clamp, blur.
    // Consuming here (return true) keeps the SAME keypress from reaching the
    // shell's non-editing ENTER branch post-blur and confirming the order.
    if (e.key === "Enter" && editing && document.activeElement === qtyRef.current) {
      commitTypedQty();
      qtyRef.current?.blur();
      e.preventDefault();
      return true;
    }
    return false;
  };

  /* ---------------- wiring: structure re-render + tick patch channels ---------------- */
  useEffect(() => {
    const unsubState = stateSubscribe(force);            // selection / staging / strategy / fills
    const unsubTick = DataEngine.subscribe(renderNumbers); // 1–2s walk: patch numerals, no re-render
    const unsubRedraw = registerRedraw(drawSilhouette);  // shell calls on resize + power-off swap/settle
    const unsubKeys = registerKeyExtra(keyExtra);
    // a history-sync landing updates syncedAtISO → refresh the header freshness stamp.
    // No-op / inert under VITE_MOCK (TruthStore stays empty; renderAsof early-returns).
    const unsubTruth = TruthStore.subscribe(renderAsof); // item 34
    maybeTutorial();                                     // first visit to POSITIONS.dat → DESK 07 briefing
    return () => { unsubState(); unsubTick(); unsubRedraw(); unsubKeys(); unsubTruth(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after EVERY render (mount + each state-driven re-render): full repaint of
  // the imperative half — the prototype's renderPositions() minus the JSX bits.
  useEffect(() => { renderNumbers(); });

  const sym = State.selected; const p = UNIVERSE[sym];
  const pos = positionFor(sym);
  const staged = State.staged;

  return (
    <section id="pos" className="appscreen active">
      <div className="screenbody">
        <div className="pos-dossier">
          <svg id="posSilhouette" ref={silRef} preserveAspectRatio="none" viewBox="0 0 100 100" />

          {/* LEFT: numbers */}
          <div className="pos-col pos-left card" style={{ padding: "18px 18px 22px" }}>
            <div className="phead">
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span className="psym" id="posSym">{sym.replace("-USD", "")}</span>
              </div>
              <span className="pnm" id="posNm">{p.name}</span>
              <div className="pos-tags" id="posTags">
                {[p.sector, p.style, pos.qty > 0 ? "LONG" : "FLAT"].map((t, i) => (
                  <span key={i} className="tag">{t}</span>
                ))}
              </div>
              {/* ITEM 34 — as-of freshness stamp (live builds only; empty otherwise) */}
              <div className="asof" ref={asofRef} />
            </div>
            <div className="budget-chip">
              <span className="lab">BUYING POWER UNSPENT</span>
              {/* numeral is patcher-owned; the .staged orange rides the state re-render */}
              <span className={"num mono" + (staged !== 0 ? " staged" : "")} id="posBP" ref={bpRef} />
            </div>
            <div id="posStats" ref={statsRef} />
            <div className="stepper-wrap">
              <span className="chip" style={{ marginBottom: 8 }}>STAGE ORDER</span>
              <div className="stepper">
                <button id="stepMinus" onClick={() => stageDelta(-1)}>−</button>
                <input
                  id="stepQty" className="mono" defaultValue="0" inputMode="numeric"
                  ref={qtyRef} onBlur={commitTypedQty}
                />
                <button id="stepPlus" onClick={() => stageDelta(+1)}>+</button>
                <span className="qlab">SHARES Δ</span>
              </div>
              <div className="est-line" id="estLine" ref={estRef} />
              <div className="order-btns">
                <button className="obtn reset" id="btnReset" disabled={staged === 0} onClick={resetStage}>
                  <kbd className="dim">X</kbd> RESET
                </button>
                <button className="obtn confirm" id="btnConfirm" disabled={staged === 0} onClick={doConfirm}>
                  <kbd>↵</kbd> CONFIRM
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: shape */}
          <div className="pos-col pos-right">
            <div className="card radar-card">
              <span className="plabel">FINGERPRINT</span>
              {/* staged mode: label chips only; polygon tweens as the order is staged */}
              <Radar id="posRadarWrap" sym={sym} stagedQty={staged} staged />
              <div className="strategy">
                <span className={"strat-opt" + (State.strategy === "HEDGED" ? " on" : "")} id="stratHedged" onClick={toggleStrategy}>
                  <span className="box">{State.strategy === "HEDGED" ? "✓" : ""}</span>HEDGED
                </span>
                <span className={"strat-opt" + (State.strategy === "DIRECTIONAL" ? " on" : "")} id="stratDir" onClick={toggleStrategy}>
                  <span className="box">{State.strategy === "DIRECTIONAL" ? "✓" : ""}</span>DIRECTIONAL
                </span>
                <kbd style={{ marginLeft: "auto" }}>F</kbd>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14 }}><Roster /></div>
      </div>

      {/* FIRST-RUN TUTORIAL (backdrop or CTA click dismisses; ENTER via key extra) */}
      <div
        id="tutorial" ref={tutRef}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t.id === "tutorial" || t.closest(".tut-cta")) dismissTutorial();
        }}
      >
        <div className="tut-card">
          <div className="tut-top">
            <div className="tut-portrait" ref={tutPortraitRef} />
            <h3>DESK 07 // BRIEFING</h3>
          </div>
          <p>"Every dollar of buying power is a choice, operator. Stage it, check the shape, then commit."</p>
          <div className="tut-cta"><kbd>↵</kbd> ENTER CONTINUE</div>
        </div>
      </div>

      <div className="hintbar screen-hints">
        <span className="h"><kbd>Q</kbd><kbd>E</kbd><span className="t">CYCLE APPS</span></span>
        <span className="h"><kbd>TAB</kbd><span className="t">PANELS</span></span>
        <span className="h"><kbd>◀</kbd><kbd>▶</kbd><span className="t">ROSTER</span></span>
      </div>
      <div className="escback" data-esc onClick={() => gotoScreen("dash")}><kbd>ESC</kbd><span>BACK</span></div>
    </section>
  );
}
