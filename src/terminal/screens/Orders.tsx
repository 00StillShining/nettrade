/* =========================================================================
   TERMINAL 77 — ORDERS (UPGRADE 3 — session fill log · LIVE broker ledger)

   Port of the prototype's #orders section + renderOrders(). A wire-format
   ledger of every CONFIRMED fill this session (newest first). Columns:
   TIME / SYM / SIDE / QTY / EST / BP AFTER — all numerals mono, tabular,
   right-aligned (table.ledger in terminal.css owns the look; th/td.l flips
   the left-aligned identity columns).

   LIVE UPGRADE (worker C): once the Trading 212 history sync (TruthStore,
   worker B) has real executed fills, THEY become the screen's primary content
   — the honest broker ledger, newest-first (DATE / SYM / SIDE / QTY / FILL /
   VALUE / FEE / STATUS), every money figure in the ACCOUNT currency via
   fmtMoney(n, TruthStore.ccy) from integer minor units. The read-only session
   staged log (State.ordersLog — the DRY-RUN fiction that never touched a
   market) stays BELOW a hard divider so the two are never confused. Under
   VITE_MOCK the whole live path is inert: no creds, no sync, and the screen is
   byte-for-byte the original session-only ledger.

   WHY THIS SCREEN HAS NO TICK CHANNEL: every number in the ledger is frozen
   at fill time (est = notional AT the fill price, bpAfter = buying power
   AFTER that fill; real fills are executed & immutable) — nothing here
   re-marks against the live walk, so there is no DataEngine.subscribe and no
   setTickText. The triggers are (a) a confirmed session fill (confirmStage()
   ends in notifyState()) and (b) a TruthStore sync tick (TruthStore.subscribe)
   — a single force() re-render on each IS the prototype's
   `if(State.screen==='orders') renderOrders()`. No canvases either, so no
   registerRedraw closure: the ledger is plain DOM and survives the power-off
   collapse untouched. (The Roster strip below runs its own tick patching.)

   PALETTE DISCIPLINE (§1): gain/loss colour lives ONLY on a signed MARKET
   number or a market-direction glyph. The session EST column stays ink — the
   +/- prefix carries buying-power direction; colour lives on the SIDE glyph
   only (BUY green ▲ / SELL brick ▼). The LIVE ledger shows side as BUY/SELL
   TEXT (a legible word, not colour alone) tinted by the same market-direction
   rule; VALUE and FEE are neutral ink (an executed cash amount has no gain/loss
   sign to honestly colour).

   KEYBOARD: nothing to register — Q/E, TAB, ◀▶ and ESC are all shell-owned
   state keys (Terminal.tsx dispatches them); this screen has no per-screen
   verbs and no inputs to focus.
   ========================================================================= */

import { useEffect, useReducer } from "react";
import { fmtUSD, fmtMoney, fmtNum, arrow } from "../engine/dataEngine";
import { State, stateSubscribe, type Fill } from "../state";
import { gotoScreen } from "../bus";
import Roster from "../components/Roster";
import Ledger from "../components/Ledger";
// LIVE broker ledger (worker B — may tsc-drift until truthStore.ts lands; keep the usage).
import { TruthStore, startHistorySync, type FillRow } from "../engine/truthStore";

// VITE_MOCK builds must be a NO-OP for the whole live path (design builds stay seed-77).
const IS_MOCK = import.meta.env.VITE_MOCK === "1";

/* one SESSION ledger row — the prototype's template literal, translated to JSX.
   Rendered newest-first by the caller; keyed by position in the ORIGINAL log
   (stable: fills are append-only, so an index never changes meaning). */
function FillRowSession({ o }: { o: Fill }) {
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

/* one LIVE broker fill row — a real executed order from the T212 history sync.
   DATE is the calendar day of the fill (ledger is a historical record, not a
   session clock). SIDE is a legible BUY/SELL WORD tinted by market direction
   (never colour alone). QTY/FILL/VALUE/FEE are all mono tabular; money figures
   come straight from integer minor units via fmtMoney(n, ccy). STATUS is the
   broker's own word (EXECUTED/FILLED/…), quiet ink. */
function FillRowLive({ o, ccy }: { o: FillRow; ccy: string }) {
  const buy = o.side === "buy";
  const cls = buy ? "gain" : "loss";
  const day = o.dateISO.slice(0, 10); // YYYY-MM-DD, the honest fill date
  // fill price & filled value are per the account/instrument minor-unit convention (worker A).
  return (
    <tr>
      <td className="l">{day}</td>
      <td className="l sym">{o.sym}</td>
      <td className="l"><span className={`side ${cls}`}>{arrow(buy ? 1 : -1)} {o.side.toUpperCase()}</span></td>
      <td>{o.quantity}</td>
      {/* fill price is INSTRUMENT-currency (a $ number for a US stock in a £
          account) — never stamp the account symbol on it. Bare tabular number;
          the column header carries the INSTR caveat. VALUE/FEE are account ccy. */}
      <td>{fmtNum(o.fillPriceMinor / 100)}</td>
      <td>{fmtMoney(o.filledValueMinor / 100, ccy)}</td>
      {/* a fee is a cost with no gain/loss sign — neutral ink, never coloured */}
      <td>{o.feeMinor ? fmtMoney(o.feeMinor / 100, ccy) : "—"}</td>
      <td className="l ord-status">{(o.status || "").toUpperCase() || "—"}</td>
    </tr>
  );
}

export default function Orders() {
  const [, force] = useReducer((n: number) => n + 1, 0);

  // STRUCTURE-only wiring: session fills land through confirmStage() → notifyState();
  // the broker ledger lands through the history sync → TruthStore.notify(). One force()
  // on each IS the prototype's full-table rebuild. No tick channel (see header essay).
  useEffect(() => {
    const unState = stateSubscribe(force);
    const unTruth = TruthStore.subscribe(force);
    // idempotent kick — no-op under VITE_MOCK or when no creds (worker B contract).
    startHistorySync();
    return () => { unState(); unTruth(); };
  }, []);

  const sessionLog = State.ordersLog;
  const sessionCount = sessionLog.length + (sessionLog.length === 1 ? " FILL" : " FILLS");

  // LIVE broker ledger presence: only in a live (non-mock) build with real synced fills.
  const fills = IS_MOCK ? [] : (TruthStore.fills || []);
  const hasLive = fills.length > 0;
  const ccy = TruthStore.ccy || State.accountCcy || "USD";
  const liveCount = fills.length + (fills.length === 1 ? " FILL" : " FILLS");
  // sync status line — honest about what the ledger is doing when it's empty.
  const syncing = !IS_MOCK && TruthStore.sync === "syncing" && !hasLive;
  const syncErr = !IS_MOCK && TruthStore.sync === "error" && !hasLive;

  return (
    <section id="orders" className="appscreen active">
      <div className="screenbody orders-body">
        <div className="card orders-card">
          <span className="plabel">ORDERS // {hasLive ? "BROKER LEDGER" : "SESSION LOG"}</span>

          {/* ---- LIVE BROKER LEDGER (hero, when real fills exist) ---- */}
          {hasLive && (
            <>
              <div className="orders-head">
                <span className="chip">ORDERS // BROKER HISTORY</span>
                <span className="orders-count mono">{liveCount}</span>
                <span className="ord-recorded mono">RECORDED · TRADING 212</span>
              </div>
              <div className="orders-scroll orders-scroll-live">
                <Ledger className="ledger-live">
                  <thead>
                    <tr>
                      <th className="l">DATE</th><th className="l">SYM</th><th className="l">SIDE</th>
                      <th>QTY</th><th>FILL·INSTR</th><th>VALUE</th><th>FEE</th><th className="l">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* TruthStore.fills are already newest-first (worker B contract); id is stable */}
                    {fills.map((o) => <FillRowLive key={o.id} o={o} ccy={ccy} />)}
                  </tbody>
                </Ledger>
              </div>
            </>
          )}

          {/* ---- SYNC / ERROR line (live build, no fills yet) ---- */}
          {!hasLive && syncing && (
            <div className="orders-empty">SYNCING FILL HISTORY…</div>
          )}
          {!hasLive && syncErr && (
            <div className="orders-empty">
              FILL HISTORY UNAVAILABLE — BROKER SYNC FAILED
              {TruthStore.syncError ? <>: <b>{TruthStore.syncError}</b></> : ""}.
              {/* a 403 here = the T212 API key lacks the HISTORY scopes (orders/
                  dividends/transactions toggles when generating the key) */}
              {TruthStore.syncError && TruthStore.syncError.includes("(403)")
                ? " YOUR TRADING 212 KEY LIKELY LACKS THE HISTORY PERMISSIONS — REGENERATE IT WITH ORDERS/DIVIDENDS/TRANSACTIONS ENABLED."
                : " THE DRY-RUN SESSION LOG BELOW IS UNAFFECTED."}
            </div>
          )}

          {/* ---- SESSION DRY-RUN LOG (always present; hero only in the mock build) ---- */}
          <div className={hasLive ? "orders-session-block" : ""}>
            {hasLive && (
              // honest separation: the session log is a read-only rehearsal that never touched a market.
              <div className="orders-divider">
                <span className="orders-divider-lbl">DRY-RUN // THIS SESSION — never sent to market</span>
              </div>
            )}
            {!hasLive && !syncing && !syncErr && (
              <div className="orders-head">
                <span className="chip">ORDERS // SESSION</span>
                <span className="orders-count mono">{sessionCount}</span>
              </div>
            )}
            <div className={"orders-scroll" + (hasLive ? " orders-scroll-session" : "")}>
              {sessionLog.length === 0 ? (
                // empty state stays in-fiction: it TELLS the operator where fills
                // come from instead of apologising for a blank table. Mock keeps the
                // ORIGINAL signed-off copy byte-for-byte (locked screen pattern);
                // "DRY-RUN" wording only appears in the live build where the broker
                // ledger above makes the distinction necessary.
                <div className="orders-empty">{IS_MOCK ? "NO FILLS THIS SESSION — STAGE AND CONFIRM FROM " : "NO DRY-RUN FILLS THIS SESSION — STAGE AND CONFIRM FROM "}<b>POSITIONS.dat</b></div>
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
                    {sessionLog.map((o, i) => ({ o, i })).reverse().map(({ o, i }) => <FillRowSession key={i} o={o} />)}
                  </tbody>
                </Ledger>
              )}
            </div>
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
