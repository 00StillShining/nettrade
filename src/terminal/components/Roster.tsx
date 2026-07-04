/* =========================================================================
   TERMINAL 77 — ROSTER STRIP (the signature bottom .rcard strip, every screen)

   Port of renderRoster + updateRosterPrices + pulseSelectedCard. The port's
   update discipline in miniature:
     • STRUCTURE is JSX, re-rendered only on state changes (selection, flag
       stars) via stateSubscribe — cards are keyed by symbol so React reuses
       the DOM nodes and the sparkline SVG isn't torn down per selection.
     • TICK VALUES are imperative: every DataEngine tick patches the price
       ([data-last] through setTickText for the digit flash), the day-% span
       and the spark stroke colour in place — no React re-render, no DOM
       rebuild, exactly the prototype's updateRosterPrices.
   `dim` renders the Watchlist civilian variant (.roster.dim — opacity +
   darker paper carry the desaturated look; selection ring flips to orange).
   ========================================================================= */

import { useEffect, useReducer, useRef } from "react";
import { DataEngine, DEFAULT_ROSTER, UNIVERSE, fmtUSD, arrow, glClass } from "../engine/dataEngine";
import { State, stateSubscribe, selectInstrument, alertFlagged } from "../state";
import { sparkPath } from "./canvas";
import { setTickText } from "./dom";
import { prefersReduced } from "../bus";

function pulseCard(card: HTMLElement | null): void {
  if (!card) return;
  card.classList.remove("pulse");
  void card.offsetWidth; // restart the animation
  if (!prefersReduced) card.classList.add("pulse");
}

export default function Roster({ dim = false }: { dim?: boolean }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const prevSel = useRef(State.selected);

  // structure re-renders on user-state changes (selection / flag stars)
  useEffect(() => stateSubscribe(force), []);

  // tick values patch in place — the strip never rebuilds on a tick
  useEffect(() => {
    const unsub = DataEngine.subscribe(() => {
      const strip = stripRef.current; if (!strip) return;
      strip.querySelectorAll<HTMLElement>(".rcard").forEach((card) => {
        const sym = card.dataset.sym as string; const q = DataEngine.get(sym);
        if (!q) return;
        setTickText(card.querySelector<HTMLElement>("[data-last]"), fmtUSD(q.last, q.last < 10 ? 4 : 2));
        const pc = card.querySelector<HTMLElement>(".rpc");
        if (pc) { pc.className = "rpc mono " + glClass(q.dayPct); pc.textContent = `${arrow(q.dayPct)}${Math.abs(q.dayPct).toFixed(2)}%`; }
        // keep the sparkline "portrait" stroke in sync when dayPct flips sign
        // between full roster re-renders (colour must track the number).
        const path = card.querySelector(".rport path");
        if (path) path.setAttribute("stroke", q.dayPct >= 0 ? "var(--gain)" : "var(--loss)");
      });
    });
    return unsub;
  }, []);

  // pulse the selected card when the selection lands somewhere new (arrows/select)
  useEffect(() => {
    if (prevSel.current !== State.selected) {
      prevSel.current = State.selected;
      pulseCard(stripRef.current?.querySelector<HTMLElement>(".rcard.sel") ?? null);
    }
  });

  return (
    <div className={"roster" + (dim ? " dim" : "")} data-roster ref={stripRef}>
      {DEFAULT_ROSTER.map((sym) => {
        const q = DataEngine.get(sym); const p = UNIVERSE[sym];
        if (!q || !p) return null;
        const col = q.dayPct >= 0 ? "var(--gain)" : "var(--loss)";
        const series = q.hist["1D"].slice(-40);
        const sel = sym === State.selected;
        return (
          <div
            key={sym}
            className={"rcard" + (sel ? " sel" : "") + (alertFlagged(sym) ? " flag" : "")}
            data-sym={sym}
            onClick={(e) => { selectInstrument(sym); pulseCard(e.currentTarget); }}
          >
            <div className="star">★</div>
            <div className="rtop">
              <span className="rsym">{sym.replace("-USD", "")}</span>
              <span className={"rpc mono " + glClass(q.dayPct)}>{arrow(q.dayPct)}{Math.abs(q.dayPct).toFixed(2)}%</span>
            </div>
            <svg className="rport" viewBox="0 0 100 30" preserveAspectRatio="none">
              <path d={sparkPath(series, 100, 30)} fill="none" stroke={col} strokeWidth="1.6" />
            </svg>
            {/* empty at mount; the tick patcher owns the text (dataset.val discipline) */}
            <div className="rlast" data-last>{fmtUSD(q.last, q.last < 10 ? 4 : 2)}</div>
          </div>
        );
      })}
    </div>
  );
}
