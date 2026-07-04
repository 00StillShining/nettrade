/* =========================================================================
   TERMINAL 77 — ALERTS (id=alerts, WND-0x7B) — armed watches + market regime.

   Port of the prototype's #alerts section + renderAlerts / alertsTick wiring.
   Three answers, one hierarchy:
     • HERO — the WATCH BOARD (armed-watch ledger). A TRIGGERED row reads via
       orange 3px LEFT-BAR + the TRIGGERED word + ▲/▼ shape — colour carries
       ATTENTION only, never classification (palette law §2). No orange fill.
     • SUPPORTING — the regime strip: DISTRIBUTION (dual-index IBD monitor,
       headline shows the index that DRIVES the combined band) + FOLLOW-THROUGH
       (FTD state machine). Classification is ink/teal WORD+SHAPE via
       statusChip — NEVER green/red/orange.
     • ACTION — the NEW WATCH ticket (segToggles + the Positions stepper,
       verbatim classes) with the A/R/N/G key family.

   UPDATE DISCIPLINE (the Dashboard reference pattern):
     • STRUCTURE is JSX + an after-render repaint (board/regime painted
       imperatively into ref'd wraps — the prototype injected these as HTML
       strings; statusChipHtml/alertNowCell keep that form, sanctioned by the
       screen contract's innerHTML-ledger clause).
     • TICKS are targeted: the DataEngine.subscribe handler patches ONLY the
       NOW cells (+ flips a just-fired row's STATE/AGE/left-bar in place) —
       never a full board rebuild per tick, exactly the prototype's alertsTick.
     • NON-REPAINTING regime: alertsComputeRegime() is gated in state.ts on a
       settled-bar roll; the tick handler repaints the two panels only when
       SPY's closed-bar count actually moved. (DEAD UNTIL THE ENGINE ROLLS
       1M/1Y BARS — DataEngine.tick() only rolls hist['1D'] today, so this
       branch is armed-but-idle, same as the prototype. The live Tauri seam
       will exercise it.)
     • MATH lives in engine/alerts.ts + state.ts — this file renders only.

   KEYBOARD: the shell already dispatches R (reset), N (metric), G (op) and
   +/- while editing (state-only). This screen registers ONE key extra for the
   DOM-touching pieces: A focuses/selects the level input, and it claims the
   editing +/- so the FOCUSED input's displayed value refreshes on step (the
   prototype's alertTicketStep wrote inp.value directly). ENTER inside the
   input commits + arms via the input's own onKeyDown (the shell's comment
   delegates that to us — the commit needs THIS input's text).
   ========================================================================= */

import { useEffect, useReducer, useRef } from "react";
import { DataEngine, fmtUSD } from "../engine/dataEngine";
import {
  ALERT_TH, ALERT_METRICS, IBD_LEVEL, alertMetricLabel,
  type Watch, type WatchMetric, type WatchOp,
} from "../engine/alerts";
import {
  State, stateSubscribe, notifyState, selectInstrument,
  Alerts as AlertsState, alertsComputeRegime, evaluateWatchesNow,
  alertTicketDisplayLevel, alertTicketStep, alertSetTicketLevel, alertArmTicket,
} from "../state";
import { statusChipHtml } from "../components/StatusChip";
import SegToggle from "../components/SegToggle";
import Roster from "../components/Roster";
import { registerKeyExtra, gotoScreen } from "../bus";

/* ---- row-cell HTML builders (prototype alertNowCell/alertAgeCell verbatim —
   string form because the board ledger is an innerHTML injection, and the
   tick patcher re-issues the NOW cell through the same builder) ---- */
function alertNowCell(w: Watch): string {
  if (w.now == null) return `<span class="mono" style="color:var(--ink-soft)">N/A</span>`;
  const triggered = w.state === "TRIGGERED";
  let txt: string, dir = "";
  if (w.metric === "PRICE") txt = fmtUSD(w.now, w.now < 10 ? 4 : 2);
  else if (w.metric === "RSI") txt = w.now.toFixed(0);
  else txt = `${w.now >= 0 ? "+" : ""}${w.now.toFixed(2)}%`;
  // direction SHAPE reads the crossed direction (op>) even on a triggered row — the
  // ▲/▼ marks which way NOW sits relative to the line, colour-independent.
  if (triggered) dir = w.op === ">" ? "▲ " : "▼ ";
  return `<span class="mono${triggered ? " al-nowfire" : ""}" data-alnow>${dir}${txt}</span>`;
}
function alertAgeCell(w: Watch): string {
  if (w.state !== "TRIGGERED") return `<span class="mono" style="color:var(--ink-soft)">—</span>`;
  return `<span class="mono">${w.firedAt || ""}</span>`;
}

export default function Alerts() {
  const [, force] = useReducer((n: number) => n + 1, 0);

  // ticket symbol always mirrors the current roster selection (the prototype's
  // renderAlerts() ran this on every paint; selectInstrument's alerts branch
  // keeps it in sync between paints — render-body mutation is the shell's own
  // pattern for exactly this mirror-a-singleton job).
  AlertsState.ticket.sym = State.selected;

  /* ---- refs: the two imperative wraps + every regime line the panels patch ---- */
  const boardRef = useRef<HTMLDivElement | null>(null);
  const levelRef = useRef<HTMLInputElement | null>(null);
  const ddCountRef = useRef<HTMLSpanElement | null>(null);
  const ddSubRef = useRef<HTMLDivElement | null>(null);
  const ddChipRef = useRef<HTMLSpanElement | null>(null);
  const ddHintRef = useRef<HTMLDivElement | null>(null);
  const ddFootRef = useRef<HTMLDivElement | null>(null);
  const ftdStateRef = useRef<HTMLSpanElement | null>(null);
  const ftdChipRef = useRef<HTMLSpanElement | null>(null);
  const ftdLowRef = useRef<HTMLElement | null>(null);
  const ftdWatchRef = useRef<HTMLElement | null>(null);
  const ftdHintRef = useRef<HTMLDivElement | null>(null);
  const ftdFootRef = useRef<HTMLDivElement | null>(null);
  const lastClosedN = useRef<number | null>(null); // alertsLastClosedN — the settled-bar gate

  /* ================= WATCH BOARD (renderAlertsBoard — innerHTML ledger) ================= */
  function renderBoard(): void {
    const wrap = boardRef.current; if (!wrap) return;
    if (!AlertsState.watches.length) {
      wrap.innerHTML = `<div class="al-empty">NO WATCHES ARMED &#8212; STAGE ONE BELOW.<br>` +
        `<span class="al-empty-sub">The desk is quiet, operator. Arm a price line or an indicator and this board lights when the market crosses it. (Regime monitors run on their own; they never sleep.)</span></div>`;
      return;
    }
    const body = AlertsState.watches.map((w) => {
      const triggered = w.state === "TRIGGERED";
      const cls = triggered ? "al-fire" : "";
      const state = triggered
        ? `<span class="al-statechip fire">TRIGGERED</span>`
        : `<span class="al-statechip armed">ARMED</span>`;
      return `<tr class="${cls}" data-wid="${w.id}">
        <td class="l sym">${w.sym.replace("-USD", "")}</td>
        <td class="l al-cond">${alertMetricLabel(w)}</td>
        <td>${alertNowCell(w)}</td>
        <td class="l">${state}</td>
        <td>${alertAgeCell(w)}</td>
      </tr>`;
    }).join("");
    wrap.innerHTML = `<table class="ledger">
      <thead><tr><th class="l">SYM</th><th class="l">CONDITION</th><th>NOW</th><th class="l">STATE</th><th>AGE</th></tr></thead>
      <tbody>${body}</tbody></table>`;
    // click a row → select that watch as the reset target (and select its symbol)
    wrap.querySelectorAll<HTMLTableRowElement>("tr[data-wid]").forEach((tr) => tr.addEventListener("click", () => {
      const id = +(tr.dataset.wid || 0); const w = AlertsState.watches.find((x) => x.id === id);
      if (w) selectInstrument(w.sym);
    }));
  }

  /* ================= REGIME PANELS (renderAlertsRegime — refs for $()) ================= */
  function renderRegime(): void {
    const R = alertsComputeRegime();
    // DISTRIBUTION panel
    // Dual-index (SPY + NDX): the combined band is the WORSE of the two, so headline the index that
    // DRIVES it and show both counts — else "2 of 25 · SEVERE" reads as a broken classification.
    const spyDD = R.spyDD, ndxDD = R.ndxDD, band = R.band, lvl = IBD_LEVEL[band];
    const ndxDrives = R.ndxBand === band && (R.spyBand !== band || ndxDD.d25 >= spyDD.d25);
    const drv = ndxDrives ? { n: "NDX", d: ndxDD } : { n: "SPY", d: spyDD };
    if (ddCountRef.current) ddCountRef.current.textContent = `${drv.d.d25} of ${ALERT_TH.DD_EXPIRE_SESSIONS}`;
    if (ddSubRef.current) ddSubRef.current.textContent = `${drv.n} drives · SPY d25 ${spyDD.d25} · NDX d25 ${ndxDD.d25}`;
    if (ddChipRef.current) ddChipRef.current.innerHTML = statusChipHtml(band, lvl);
    if (ddHintRef.current) ddHintRef.current.textContent = `${R.exposure.hint} · CEILING ${R.exposure.ceiling}%`;
    if (ddFootRef.current) ddFootRef.current.textContent = `FINALIZES ON CLOSE · LAST SETTLED ${R.settled}`;
    // FOLLOW-THROUGH panel
    const ftd = R.ftd;
    if (ftdStateRef.current) ftdStateRef.current.textContent = ftd.state;
    if (ftdChipRef.current) ftdChipRef.current.innerHTML =
      statusChipHtml(ftd.day ? `DAY ${ftd.day}` : "—", ftd.level, { pips: ftd.state === "FTD CONFIRMED" ? 4 : ftd.day ? 2 : 1 });
    if (ftdLowRef.current) ftdLowRef.current.textContent = ftd.lowLvl != null ? fmtUSD(ftd.lowLvl, 2) : "—";
    if (ftdWatchRef.current) ftdWatchRef.current.textContent = ftd.ftdLvl != null ? fmtUSD(ftd.ftdLvl, 2) : "—";
    if (ftdHintRef.current) ftdHintRef.current.textContent = ftd.hint;
    if (ftdFootRef.current) ftdFootRef.current.textContent = `FINALIZES ON CLOSE · LAST SETTLED ${R.settled}`;
  }

  /* ---- ticket level input sync (renderAlertsTicket's guarded value write:
     never clobber a value the operator is mid-typing) ---- */
  function syncTicketInput(): void {
    const inp = levelRef.current;
    if (inp && document.activeElement !== inp) inp.value = alertTicketDisplayLevel();
  }

  /* ================= TICK (alertsTick — NON-REPAINTING, targeted patches) ================= */
  function tickPatch(): void {
    // re-eval (latch only — the shell's unconditional pass usually beat us here;
    // evaluating twice is idempotent, exactly like the prototype's alertsTick).
    evaluateWatchesNow();
    // regime: only repaint the two panels when the settled bar actually rolled.
    const spyClosedN = Math.max(0, DataEngine.get("SPY").hist["1M"].length - 1);
    if (lastClosedN.current !== null && spyClosedN !== lastClosedN.current) { alertsComputeRegime(true); renderRegime(); }
    lastClosedN.current = spyClosedN;
    // live-flash NOW cells + flip STATE/left-bar in place if a row just triggered
    const wrap = boardRef.current; if (!wrap) return;
    let justFired = false;
    wrap.querySelectorAll<HTMLTableRowElement>("tr[data-wid]").forEach((tr) => {
      const id = +(tr.dataset.wid || 0); const w = AlertsState.watches.find((x) => x.id === id); if (!w) return;
      const nowTd = tr.querySelector<HTMLTableCellElement>("td:nth-child(3)");
      if (nowTd) nowTd.innerHTML = alertNowCell(w);
      const wasFire = tr.classList.contains("al-fire");
      if (w.state === "TRIGGERED" && !wasFire) {
        // just crossed this tick — repaint the row's STATE + AGE + left-bar without full rebuild
        tr.classList.add("al-fire");
        const stTd = tr.querySelector<HTMLTableCellElement>("td:nth-child(4)"); if (stTd) stTd.innerHTML = `<span class="al-statechip fire">TRIGGERED</span>`;
        const agTd = tr.querySelector<HTMLTableCellElement>("td:nth-child(5)"); if (agTd) agTd.innerHTML = alertAgeCell(w);
        justFired = true;
      }
    });
    // a watch that triggers while you're ON the alerts screen must surface the roster
    // star too — evaluateWatches set the WATCH bit; notifyState() repaints every
    // subscribed roster (the port's renderRoster()).
    if (justFired) notifyState();
  }

  /* ---- ticket commit helpers (wireAlertsTicket's listeners, React-side) ---- */
  function commitLevelFromInput(): void {
    const inp = levelRef.current;
    if (inp) alertSetTicketLevel(parseFloat(inp.value)); // isFinite-guarded in state.ts
  }
  function armFromInput(): void {
    commitLevelFromInput();
    alertArmTicket(); // notifies → board re-renders with the new ARMED row on top
  }

  /* ---------------- wiring: structure re-render + tick patch + key extra ---------------- */
  useEffect(() => {
    const unsubState = stateSubscribe(force);       // selection / ticket / watch-book changes
    const unsubTick = DataEngine.subscribe(tickPatch);
    // A focuses+selects the level input (alertFocusLevel); the editing +/- is
    // claimed here too so the FOCUSED input's text refreshes on step (the shell's
    // state-only handler can't reach our DOM — returning true makes it skip).
    const unsubKeys = registerKeyExtra((e: KeyboardEvent, editing: boolean): boolean => {
      if (State.screen !== "alerts") return false;
      const inp = levelRef.current;
      if (!editing && e.key.toLowerCase() === "a") {
        if (inp) { inp.focus(); inp.select(); }
        e.preventDefault(); return true;
      }
      if (editing && inp && document.activeElement === inp &&
          (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_")) {
        alertTicketStep(e.key === "+" || e.key === "=" ? +1 : -1);
        inp.value = alertTicketDisplayLevel(); // prototype alertTicketStep wrote inp.value directly
        e.preventDefault(); return true;
      }
      return false;
    });
    return () => { unsubState(); unsubTick(); unsubKeys(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after EVERY render (mount + each state-driven re-render): the prototype's
  // renderAlerts() — evaluate first so NOW cells are fresh on entry, then paint.
  useEffect(() => {
    evaluateWatchesNow();
    renderBoard();
    renderRegime();
    syncTicketInput();
  });

  const t = AlertsState.ticket;

  return (
    <section id="alerts" className="appscreen active">
      <div className="screenbody alerts-body">
        {/* HERO: the armed-watch board — the ONE answer (scan the STATE column) */}
        <div className="card al-board-card">
          <span className="plabel">ALERTS // ARMED WATCH</span>
          <div className="al-boardhead">
            <span className="chip teal">WATCH BOARD</span>
            <span className="al-note mono">IN-TERMINAL WATCH ONLY · NO OS / PUSH NOTIFICATION</span>
          </div>
          <div className="al-watch-scroll" id="alWatchWrap" ref={boardRef} />
        </div>

        {/* SUPPORTING: regime strip (DISTRIBUTION | FOLLOW-THROUGH) + new-watch ticket */}
        <div className="al-strip">
          <div className="card al-reg">
            <span className="plabel">DISTRIBUTION // IBD · MODEL</span>
            <div className="al-regtop">
              <span className="al-regbig mono" id="alDDcount" ref={ddCountRef} />
              <span className="al-reglbl">DIST DAYS (25-SESSION)</span>
              <span id="alDDchip" className="al-regchip" ref={ddChipRef} />
            </div>
            <div className="al-regsub mono" id="alDDsub" ref={ddSubRef} />
            <div className="al-reghint" id="alDDhint" ref={ddHintRef} />
            <div className="al-regfoot mono" id="alDDfoot" ref={ddFootRef} />
          </div>
          <div className="card al-reg">
            <span className="plabel">FOLLOW-THROUGH // FTD · MODEL</span>
            <div className="al-regtop">
              <span className="al-regbig al-ftdstate" id="alFTDstate" ref={ftdStateRef} />
              <span id="alFTDchip" className="al-regchip" ref={ftdChipRef} />
            </div>
            <div className="al-ftdlvls mono">
              <span>SWING LOW <b id="alFTDlow" ref={ftdLowRef} /></span>
              <span>FTD DAY LOW <b id="alFTDwatch" ref={ftdWatchRef} /></span>
            </div>
            <div className="al-reghint" id="alFTDhint" ref={ftdHintRef} />
            <div className="al-regfoot mono" id="alFTDfoot" ref={ftdFootRef} />
          </div>
          <div className="card al-ticket">
            <span className="plabel">NEW WATCH // <span id="alTicketSym">{t.sym.replace("-USD", "")}</span></span>
            <div className="al-tickrow">
              <span className="al-ticklbl">METRIC</span>
              <SegToggle
                options={ALERT_METRICS.map((m) => ({ key: m, label: m }))}
                active={t.metric}
                onPick={(k) => { AlertsState.ticket.metric = k as WatchMetric; notifyState(); }}
              />
            </div>
            <div className="al-tickrow">
              <span className="al-ticklbl">CROSS</span>
              <SegToggle
                options={[{ key: ">", label: "▲ ABOVE" }, { key: "<", label: "▼ BELOW" }]}
                active={t.op}
                onPick={(k) => { AlertsState.ticket.op = k as WatchOp; notifyState(); }}
              />
            </div>
            <div className="al-tickrow">
              <span className="al-ticklbl">LEVEL</span>
              <div className="stepper">
                <button type="button" id="alStepDn" aria-label="decrease level" onClick={() => alertTicketStep(-1)}>−</button>
                <input
                  id="alLevel" type="text" inputMode="decimal" ref={levelRef}
                  defaultValue={alertTicketDisplayLevel()}
                  onInput={commitLevelFromInput}
                  onKeyDown={(e) => {
                    // ENTER commits the staged LEVEL and arms the ticket (mirrors
                    // Positions confirmStage gating on editing — the shell delegates
                    // the alerts+editing ENTER to this input's own handler).
                    if (e.key === "Enter") {
                      commitLevelFromInput();
                      e.currentTarget.blur();
                      alertArmTicket();
                      e.preventDefault();
                    }
                  }}
                />
                <button type="button" id="alStepUp" aria-label="increase level" onClick={() => alertTicketStep(+1)}>+</button>
                <span className="qlab" id="alLevelUnit">{t.metric === "PRICE" ? "USD" : t.metric === "RSI" ? "RSI" : "%"}</span>
              </div>
            </div>
            <button type="button" className="obtn confirm al-arm" id="alArmBtn" onClick={armFromInput}>ARM WATCH</button>
            <div className="al-tickfoot mono">Evaluates only while this terminal is open. Informational — never a trade gate.</div>
          </div>
        </div>

        <div className="al-roster-wrap"><Roster /></div>
      </div>

      <div className="hintbar screen-hints">
        <span className="h"><kbd>Q</kbd><kbd>E</kbd><span className="t">CYCLE APPS</span></span>
        <span className="h"><kbd>A</kbd><span className="t">ARM</span></span>
        <span className="h"><kbd>R</kbd><span className="t">RESET</span></span>
        <span className="h"><kbd>N</kbd><span className="t">METRIC</span></span>
        <span className="h"><kbd>G</kbd><span className="t">OP</span></span>
        <span className="h"><kbd>◀</kbd><kbd>▶</kbd><span className="t">ROSTER</span></span>
      </div>
      <div className="escback" onClick={() => gotoScreen("dash")}><kbd>ESC</kbd><span>BACK</span></div>
    </section>
  );
}
