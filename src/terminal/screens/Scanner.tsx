/* =========================================================================
   TERMINAL 77 — SCANNER (id=scan, WND-0x7A) — the roster screener.

   Port of the prototype's renderScanner/scanTick pair. Answers ONE question
   fast: "which of my 8 instruments matches a real screener RIGHT NOW?" The
   math lives entirely in engine/scan.ts (SCAN_CALC — VCP/CANSLIM/BURST/
   DIVPULL scorers) and state.ts (scanComputeRows/scanSortRows memo) — this
   file only translates markup + render fns; it never re-implements a
   threshold.

   UPDATE DISCIPLINE (the setTickText law, Dashboard.tsx pattern):
   • STRUCTURE IS JSX — preset segToggle (orange-active-only, live match
     counts), plabel, methodology strip, sort bar and badge re-render on
     stateSubscribe(force). The shell already dispatches the per-screen keys
     (S next preset / D prev preset / R sort cycle — Terminal.tsx mutates
     Scan.* and notifyState()s), so this screen only has to repaint.
   • THE LEDGER IS innerHTML on a ref'd wrap — exactly the prototype's render
     style (whole <tr> strings incl. statusChipHtml + the RSI rail), rebuilt
     only on a state re-render (preset/sort/selection), NEVER on a tick.
   • NON-REPAINTING TICK — between candles scanTick() live-flashes ONLY the
     LAST/1D% cells via setTickText; setup flags, scores and row order HOLD.
     A full recompute+resort (scanBumpData → re-render) happens on candle
     finalize only, detected via SPY's 1M closed-bar count as a shared clock.
     (Dead until the engine rolls 1M bars — DataEngine.tick() only rolls
     hist['1D'] today — but the seam is live so the app port exercises it.)
   • HONEST-DATA LAW — the sort bar promises "8 INSTRUMENTS" and the ALL
     methodology note promises rows stay visible ("still evaluated, not
     hidden"). When nothing matches, the empty BANNER renders ABOVE the full
     DIMMED ledger (every row scan-dim, no scan-top) — never hide evaluated
     rows. BTC/ETH read a dashed N/A chip on CANSLIM/DIVPULL, never a zero.
   • No canvases on this screen → nothing to registerRedraw.
   ========================================================================= */

import { useEffect, useReducer, useRef } from "react";
import { DataEngine, fmtUSD, arrow, glClass, clamp } from "../engine/dataEngine";
import { SCAN_PRESETS, SCAN_METHOD, scanCountFor, type ScanPresetKey, type ScanResult } from "../engine/scan";
import { THRESHOLDS } from "../engine/signals";
import {
  State, stateSubscribe, notifyState, selectInstrument,
  Scan, scanBumpData, scanComputeRows, scanSortRows,
} from "../state";
import { setTickText } from "../components/dom";
import { statusChipHtml } from "../components/StatusChip";
import SegToggle from "../components/SegToggle";
import Roster from "../components/Roster";
import { gotoScreen } from "../bus";

/* ---- candle-finalize clock (module-scoped like the prototype's page `let`
   so leaving and re-entering the screen never fakes a bar roll) ---- */
let scanLastClosedN: number | null = null;

/* ---- RSI rail cell (prototype scanRsiRail verbatim): the numeral plus a
   34px track with OS/OB notches and an ink dot — position IS the message,
   colour stays ink/teal (classification, not a market number). ---- */
function scanRsiRail(rsi: number | null): string {
  if (rsi == null) return '<span class="mono" style="color:var(--ink-soft)">N/A</span>';
  const os = THRESHOLDS.RSI_OVERSOLD, ob = THRESHOLDS.RSI_OVERBOUGHT;
  const x = clamp(rsi, 0, 100) / 100 * 34;
  return `<span class="rsi-rail"><span class="mono">${rsi.toFixed(0)}</span>` +
    `<span class="rr-track"><span class="rr-os" style="left:${os / 100 * 34}px"></span>` +
    `<span class="rr-ob" style="left:${ob / 100 * 34}px"></span>` +
    `<span class="rr-dot" style="left:${x}px"></span></span></span>`;
}

/* ---- SETUP cell (prototype scanSetupCell verbatim over statusChipHtml) ---- */
function scanSetupCell(r: ScanResult): string {
  if (r.na) return statusChipHtml(r.flag + " N/A", "ok", { na: true });
  // unmatched: the SHARED chip (0 filled pips) — not a hand-built divergence. The row is already
  // scan-dim, so it reads secondary without re-implementing the chip markup.
  if (!r.matched) return statusChipHtml(r.flag + " —", "ok", { pips: 0 });
  const word = `${r.flag} ${r.grade}`;
  return statusChipHtml(word, r.level, { pips: r.pips });
}

export default function Scanner() {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const ledWrapRef = useRef<HTMLDivElement | null>(null);

  /* ================= RESULTS LEDGER (renderScanner's table half) =================
     Rebuilt as one innerHTML write per STATE render (preset/sort/selection) —
     memoised rows via scanComputeRows (key `${preset}|${dataV}`) make repeated
     renders cheap; the tick path below never calls this. */
  function renderLedger(): void {
    const wrap = ledWrapRef.current; if (!wrap) return;
    const rows = scanSortRows(scanComputeRows());
    const anyMatch = rows.some((x) => x.r.matched);
    // only the FIRST matched row (post-sort) earns the orange scan-top spine —
    // one active hero, everything else paper-calm (palette law).
    let topSet = false;
    const body = rows.map((x) => {
      const matched = x.r.matched;
      const cls = (matched && !topSet) ? (topSet = true, "scan-top") : (matched ? "" : "scan-dim");
      const scoreTxt = isFinite(x.r.score) ? String(x.r.score) : "N/A";
      const sel = x.sym === State.selected ? ' style="outline:1.5px solid var(--teal);outline-offset:-1.5px"' : "";
      return `<tr class="${cls}"${sel} data-sym="${x.sym}">
        <td class="l sym">${x.sym.replace("-USD", "")}</td>
        <td class="mono" data-scanlast>${fmtUSD(x.last, x.last < 10 ? 4 : 2)}</td>
        <td class="mono ${glClass(x.dayPct)}" data-scanpct>${arrow(x.dayPct)} ${Math.abs(x.dayPct).toFixed(2)}%</td>
        <td>${scanRsiRail(x.rsi)}</td>
        <td class="l">${scanSetupCell(x.r)}</td>
        <td class="mono scan-score">${scoreTxt}</td>
      </tr>`;
    }).join("");
    // HONEST-DATA LAW: no-match renders the banner ABOVE the full dimmed ledger — never hides rows.
    const banner = anyMatch ? "" : `<div class="scan-empty">NO INSTRUMENTS MATCH THIS PRESET &#8212; LOOSEN THE FILTER OR SELECT A DIFFERENT SCREEN.<br>(Every preset is a real screener; a strict market rarely yields matches. All 8 instruments stay listed below, evaluated and dimmed.)</div>`;
    wrap.innerHTML = `${banner}<table class="ledger">
      <thead><tr>
        <th class="l">SYM</th><th>LAST</th><th>1D%</th><th>RSI</th><th class="l">SETUP</th><th>SCORE</th>
      </tr></thead><tbody>${body}</tbody></table>`;
  }

  /* ================= NON-REPAINTING TICK (prototype scanTick verbatim) =================
     Between candles only the last/1D% cells live-update (digit flash); setup
     flags/scores/order HOLD. A full recompute+resort happens on candle finalize only. */
  function scanTick(): void {
    // detect candle finalize via SPY's 1M closed count as a shared clock (all syms share cadence).
    // DEAD UNTIL ENGINE ROLLS 1M/1Y BARS — DataEngine.tick() only rolls hist['1D'] today, so
    // closedN is constant and the scanBumpData()+resort branch below never fires this session.
    const spy = DataEngine.get("SPY"); const closedN = Math.max(0, spy.hist["1M"].length - 1);
    if (scanLastClosedN !== null && closedN !== scanLastClosedN) {
      scanBumpData(); scanLastClosedN = closedN;
      force(); // re-render → repaint effect rebuilds the ledger AND the segToggle match counts
      return;
    }
    scanLastClosedN = closedN;
    // live-flash only the price cells; never rebuild the DOM/resort mid-candle
    const wrap = ledWrapRef.current; if (!wrap) return;
    wrap.querySelectorAll<HTMLElement>("tr[data-sym]").forEach((tr) => {
      const sym = tr.dataset.sym as string; const q = DataEngine.get(sym);
      if (!q) return;
      setTickText(tr.querySelector<HTMLElement>("[data-scanlast]"), fmtUSD(q.last, q.last < 10 ? 4 : 2));
      const pctEl = tr.querySelector<HTMLElement>("[data-scanpct]");
      if (pctEl) { pctEl.className = "mono " + glClass(q.dayPct); pctEl.textContent = `${arrow(q.dayPct)} ${Math.abs(q.dayPct).toFixed(2)}%`; }
    });
  }

  /* ---------------- wiring: structure re-render + tick patch channels ---------------- */
  useEffect(() => {
    const unsubState = stateSubscribe(force);       // preset/sort/selection changes (S/D/R keys land here via the shell)
    const unsubTick = DataEngine.subscribe(scanTick); // 1–2s walk: patch price cells only, no re-render
    return () => { unsubState(); unsubTick(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after EVERY render (mount + each state-driven re-render): rebuild the ledger —
  // the imperative half of the prototype's renderScanner().
  useEffect(() => { renderLedger(); });

  const activeName = (SCAN_PRESETS.find((p) => p.key === Scan.preset) || { name: Scan.preset }).name;

  return (
    <section id="scan" className="appscreen active">
      <div className="screenbody">
        <div className="card scan-card">
          <span className="plabel" id="scanPlabel">{`SCANNER // ${activeName} · MODEL`}</span>
          <div className="scan-presetbar">
            <span className="chip teal" style={{ marginRight: 2 }}>PRESET</span>
            {/* prototype put .scan-presets and .segrow on ONE div; the shared SegToggle owns
                .segrow so the flex wrapper carries .scan-presets — same layout, both flex. */}
            <div className="scan-presets" id="scanPresets">
              <SegToggle
                options={SCAN_PRESETS.map((p) => ({ key: p.key, label: p.label, count: scanCountFor(p.key) }))}
                active={Scan.preset}
                onPick={(key) => { Scan.preset = key as ScanPresetKey; notifyState(); }}
              />
            </div>
            <span className={"scan-badge" + (Scan.cached ? " cached" : "")} id="scanBadge">
              {Scan.cached ? "SCAN: CACHED" : "SCAN: LIVE"}
            </span>
          </div>
          {/* methodology strip — engine-owned HTML one-liners (approximation flags explicit & honest) */}
          <div className="scan-method" id="scanMethod" dangerouslySetInnerHTML={{ __html: SCAN_METHOD[Scan.preset] || "" }} />
          <div className="scan-sortbar">
            <span className="lbl">SORT</span>
            <span id="scanSortKey">{Scan.sortKey}</span>
            <span style={{ color: "var(--ink-soft)" }}>&#8226; ROSTER SCAN &#8212; 8 INSTRUMENTS &#8226; SEED 0x4D</span>
          </div>
          {/* results ledger — injected innerHTML (renderLedger); row click = roster select,
              delegated so the rebuilt rows never need per-row listeners */}
          <div
            className="scan-ledwrap"
            id="scanLedWrap"
            ref={ledWrapRef}
            onClick={(e) => {
              const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-sym]");
              if (tr && tr.dataset.sym) selectInstrument(tr.dataset.sym);
            }}
          />
        </div>
        <div className="scan-roster-wrap"><Roster /></div>
      </div>
      <div className="hintbar screen-hints">
        <span className="h"><kbd>Q</kbd><kbd>E</kbd><span className="t">CYCLE APPS</span></span>
        <span className="h"><kbd>S</kbd><kbd>D</kbd><span className="t">PRESET</span></span>
        <span className="h"><kbd>R</kbd><span className="t">SORT</span></span>
        <span className="h"><kbd>◀</kbd><kbd>▶</kbd><span className="t">ROSTER</span></span>
      </div>
      <div className="escback" onClick={() => gotoScreen("dash")}><kbd>ESC</kbd><span>BACK</span></div>
    </section>
  );
}
