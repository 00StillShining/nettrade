/* =========================================================================
   TERMINAL 77 — ORDERS (UPGRADE 3 — session fill log)

   Port of the prototype's #orders section + renderOrders(). A wire-format
   ledger of every CONFIRMED fill this session (newest first). Columns:
   TIME / SYM / SIDE / QTY / EST / BP AFTER — all numerals mono, tabular,
   right-aligned (table.ledger in terminal.css owns the look; th/td.l flips
   the left-aligned identity columns).

   WHY THIS SCREEN HAS NO TICK CHANNEL: every number in the ledger is frozen
   at fill time (est = notional AT the fill price, bpAfter = buying power
   AFTER that fill) — nothing here re-marks against the live walk, so there
   is no DataEngine.subscribe and no setTickText. The ONLY thing that changes
   this screen is a confirmed fill, and confirmStage() ends in notifyState(),
   so a single stateSubscribe(force) re-render IS the prototype's
   `if(State.screen==='orders') renderOrders()` — same trigger, same full
   table rebuild. No canvases either, so no registerRedraw closure: the
   ledger is plain DOM and survives the power-off collapse untouched.
   (The Roster strip below runs its own tick patching internally.)

   PALETTE DISCIPLINE (§1, the comment the prototype carried in-row): the EST
   column stays ink — the +/- prefix carries buying-power direction; colour
   lives on the SIDE glyph only (BUY green ▲ / SELL brick ▼ — a market-money
   direction, so gain/loss is legitimate there and ONLY there).

   KEYBOARD: nothing to register — Q/E, TAB, ◀▶ and ESC are all shell-owned
   state keys (Terminal.tsx dispatches them); this screen has no per-screen
   verbs and no inputs to focus.
   ========================================================================= */

import { useEffect, useReducer } from "react";
import { fmtUSD, arrow } from "../engine/dataEngine";
import { State, stateSubscribe, type Fill } from "../state";
import { gotoScreen } from "../bus";
import Roster from "../components/Roster";
import Ledger from "../components/Ledger";

/* one ledger row — the prototype's template literal, translated to JSX.
   Rendered newest-first by the caller; keyed by position in the ORIGINAL log
   (stable: fills are append-only, so an index never changes meaning). */
function FillRow({ o }: { o: Fill }) {
  const buy = o.side === "BUY";
  const cls = buy ? "gain" : "loss";
  // EST signed against buying power: a buy SPENDS (−), a sell RAISES (+).
  const estLabel = (buy ? "-" : "+") + fmtUSD(o.est);
  return (
    <tr>
      <td className="l">{o.time}</td>
      <td className="l sym">{o.sym}</td>
      <td className="l"><span className={`side ${cls}`}>{arrow(buy ? 1 : -1)} {o.side}</span></td>
      <td>{o.qty}</td>
      {/* EST stays ink: the +/- prefix carries buying-power direction; colour
          lives on the SIDE glyph only (§1 palette discipline) */}
      <td>{estLabel}</td>
      <td>{fmtUSD(o.bpAfter)}</td>
    </tr>
  );
}

export default function Orders() {
  const [, force] = useReducer((n: number) => n + 1, 0);

  // STRUCTURE-only wiring: fills land through confirmStage() → notifyState().
  // No tick channel, no redraw closure — see the header essay for why.
  useEffect(() => stateSubscribe(force), []);

  const log = State.ordersLog;
  const count = log.length + (log.length === 1 ? " FILL" : " FILLS");

  return (
    <section id="orders" className="appscreen active">
      <div className="screenbody orders-body">
        <div className="card orders-card">
          <span className="plabel">ORDERS // SESSION LOG</span>
          <div className="orders-head">
            <span className="chip">ORDERS // SESSION</span>
            <span className="orders-count mono">{count}</span>
          </div>
          <div className="orders-scroll">
            {log.length === 0 ? (
              // empty state stays in-fiction: it TELLS the operator where fills
              // come from instead of apologising for a blank table.
              <div className="orders-empty">NO FILLS THIS SESSION — STAGE AND CONFIRM FROM <b>POSITIONS.dat</b></div>
            ) : (
              <Ledger>
                <thead>
                  <tr>
                    <th className="l">TIME</th><th className="l">SYM</th><th className="l">SIDE</th>
                    <th>QTY</th><th>EST</th><th>BP AFTER</th>
                  </tr>
                </thead>
                <tbody>
                  {/* newest first — walk the append-only log backwards; the
                      original index is the stable identity key */}
                  {log.map((o, i) => ({ o, i })).reverse().map(({ o, i }) => <FillRow key={i} o={o} />)}
                </tbody>
              </Ledger>
            )}
          </div>
        </div>
        <div className="orders-roster-wrap"><Roster /></div>
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
