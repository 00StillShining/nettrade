/* =========================================================================
   TERMINAL 77 — JOURNAL (id=journal, WND-0x9C) — the session PAPER DIARY.

   Answers: "for each trade I made this session, what did I do and think — and
   is my process actually working?" Each State.ordersLog fill auto-becomes a
   dated writable card (humanist-body note + TEAL tag chips + optional
   forward-only lifecycle pill). The SESSION LEDGER sidebar shows honest
   descriptive stats (fills/BP/notes/tagged); win-rate / expectancy / PF / R
   stay em-dash placeholders (no closed round-trips this session).

   LIVE UPGRADE (worker C): in a live (non-mock) build the diary gains a
   BROKER HISTORY section ABOVE the session pages — the user's REAL executed
   fills (TruthStore.fills, worker B) grouped by CALENDAR DAY, newest day
   first, each day a read-only page listing its fills (side/sym/qty@price) and
   any dividends paid that day (TruthStore.dividends) as their own line items.
   These pages are HISTORICAL RECORD, not writable rehearsal notes: they carry
   NO textarea, NO tags, NO lifecycle pill — so the tick-caret protection below
   simply never applies to them (nothing to disturb). The SESSION pages (each
   State.ordersLog fill, writable) stay exactly as now, honestly labelled
   "SESSION" below the "BROKER HISTORY" band. Under VITE_MOCK the whole live
   path is inert and the diary is byte-for-byte the sample+session original.

   THE CRITICAL PORT RULE — the 1–2s tick MUST NOT re-render or rebuild the
   feed. If it did, it would tear down the note <textarea> and destroy the
   caret + any unsaved typed text. So:

     • THE FEED (hero, JSX) re-renders ONLY on user actions via
       stateSubscribe(force): a new fill, a tag toggle, a lifecycle click, a
       note blur. NEVER on a DataEngine tick.
     • THE SIDEBAR numerals patch imperatively on tick via refs + setTickText,
       inside DataEngine.subscribe — and skip even that while a .jn-note is
       focused (so setTickText can never disturb a caret).
     • NOTES are controlled by JournalCard.note in the store. Typing mutates
       the store WITHOUT a re-render (no force) so the caret is never touched;
       the textarea's onKeyDown stops propagation so the shell's global keymap
       (Q/E/N/W/arrows) never swallows typing. Stats recompute on blur only —
       matching the prototype exactly.

   Mirrors prototypes/terminal-77 renderJournal / journalRenderStats /
   journalTick / journalFocusNewest / journalToggleWatchingNewest, with the
   exact #journal markup + terminal.css class names.
   ========================================================================= */

import { useEffect, useReducer, useRef } from "react";
import { arrow, glClass, fmtUSD, fmtMoney, fmtNum } from "../engine/dataEngine";
import { DataEngine } from "../engine/dataEngine";
import {
  State, stateSubscribe,
  JN_TAGS, JN_LIFECYCLE,
  journalActiveCards, journalReviewDate,
  type JournalCard,
} from "../state";
import { setTickText } from "../components/dom";
import { registerKeyExtra, gotoScreen } from "../bus";
import Roster from "../components/Roster";
// LIVE broker history (worker B — may tsc-drift until truthStore.ts lands; keep the usage).
import { TruthStore, startHistorySync, type FillRow } from "../engine/truthStore";
import type { HistoryDividend } from "../../adapters/trading212";

// VITE_MOCK builds must be a NO-OP for the whole live path (design builds stay sample+session).
const IS_MOCK = import.meta.env.VITE_MOCK === "1";

/* ================= BROKER-HISTORY DAY GROUPING (live build only) =================
   Fold the real executed fills + dividends into one card per CALENDAR DAY, newest
   day first, fills/dividends within a day newest-first. Pure derivation over honest
   RECORDED data — nothing invented, nothing interpolated. */
interface BrokerDay { day: string; fills: FillRow[]; dividends: HistoryDividend[] }
function groupBrokerDays(fills: FillRow[], dividends: HistoryDividend[]): BrokerDay[] {
  const map = new Map<string, BrokerDay>();
  const dayOf = (iso: string): string => (iso || "").slice(0, 10); // YYYY-MM-DD
  const get = (iso: string): BrokerDay => {
    const d = dayOf(iso);
    let g = map.get(d);
    if (!g) { g = { day: d, fills: [], dividends: [] }; map.set(d, g); }
    return g;
  };
  // fills + dividends arrive newest-first (worker B / worker A contract); preserve that
  // order inside each day by pushing in arrival order.
  for (const f of fills) get(f.dateISO).fills.push(f);
  for (const dv of dividends) get(dv.dateISO).dividends.push(dv);
  // newest calendar day first (string compare on YYYY-MM-DD is chronological)
  return Array.from(map.values()).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}
// a short, human day label from YYYY-MM-DD (e.g. "JUL 4 2026"), locale-formatted.
function fmtDayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
  if (!m) return day || "—";
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
}

export default function Journal() {
  const [, force] = useReducer((n: number) => n + 1, 0);

  // ---- refs: the sidebar numerals the tick patches in place (never React-owned text) ----
  const feedRef = useRef<HTMLDivElement | null>(null);
  const sampleTagRef = useRef<HTMLSpanElement | null>(null);
  const fillsRef = useRef<HTMLSpanElement | null>(null);
  const splitRef = useRef<HTMLSpanElement | null>(null);
  const bpRef = useRef<HTMLSpanElement | null>(null);
  const notesRef = useRef<HTMLSpanElement | null>(null);
  const taggedRef = useRef<HTMLSpanElement | null>(null);

  /* ================= SESSION LEDGER STATS (journalRenderStats — refs + setTickText) =================
     Honest descriptive session stats. NET BP DELTA = signed Σ (sells add, buys subtract BP),
     shown sign + ▲/▼ + gain/loss class (a MARKET numeral — legitimate green/red). Sample cards
     populate the demo stats until a real fill lands. */
  function renderStats(cards: JournalCard[]): void {
    const real = cards.filter((c) => !c.sample);
    const src = real.length ? real : cards; // sample seeds drive the demo stats until a real fill
    // "(· SAMPLE)" tag stays until the first real fill (honest sidebar, matches the feed's SAMPLE note)
    if (sampleTagRef.current) sampleTagRef.current.style.display = State.ordersLog.length ? "none" : "";
    const fills = src.length;
    const buys = src.filter((c) => c.side === "BUY").length;
    const sells = fills - buys;
    const bpDelta = src.reduce((a, c) => a + (c.side === "BUY" ? -c.est : c.est), 0);
    const notes = src.filter((c) => (c.note || "").trim().length > 0).length;
    const tagged = src.filter((c) => c.tags.size > 0).length;
    setTickText(fillsRef.current, String(fills));
    if (splitRef.current) splitRef.current.textContent = `${buys} / ${sells}`;
    const bpEl = bpRef.current;
    if (bpEl) {
      if (fills === 0) { bpEl.className = "v mono"; setTickText(bpEl, "—"); }
      else { bpEl.className = "v mono " + glClass(bpDelta); setTickText(bpEl, `${arrow(bpDelta)} ${fmtUSD(Math.abs(bpDelta))}`); }
    }
    setTickText(notesRef.current, String(notes));
    setTickText(taggedRef.current, String(tagged));
  }

  /* ---- store mutators (all end by re-rendering the feed via force — SAFE: no note is
         mid-typed at a tag/pill click or a blur, matching the prototype's renderJournal()) ---- */
  function toggleTag(c: JournalCard, t: string): void {
    if (c.tags.has(t)) c.tags.delete(t); else c.tags.add(t);
    force();
  }
  function advanceLife(c: JournalCard): void {
    if (c.lifeIdx < JN_LIFECYCLE.length - 1) c.lifeIdx++;
    force();
  }

  /* ---------------- wiring: feed re-renders on state; tick patches ONLY the sidebar ---------------- */
  useEffect(() => {
    const unsubState = stateSubscribe(force); // new fill / tag toggle / lifecycle / note blur
    // BROKER HISTORY sync (live build): a completed/errored sync re-renders the feed to reveal the
    // real pages. SAFE: the sync notify fires on the history-fetch clock, never the 1–2s price tick,
    // and the broker cards carry no textarea — so no in-progress note caret can ever be torn down.
    const unsubTruth = TruthStore.subscribe(force);
    startHistorySync(); // idempotent kick; no-op under VITE_MOCK or when no creds
    const unsubTick = DataEngine.subscribe(() => {
      // NON-REPAINTING tick: patch ONLY the sidebar numerals, and skip even that while a note
      // textarea is focused (setTickText on an unfocused span can't disturb the caret). The feed
      // is NEVER rebuilt here — that would blow away in-progress note text + caret/focus.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae.classList && ae.classList.contains("jn-note")) return;
      renderStats(journalActiveCards());
    });
    // N focuses the newest card's note (jump-to-write); W toggles WATCHING on it. Both gated on
    // !editing so they never fire mid-note (an INPUT/TEXTAREA in focus returns false = don't consume,
    // so a literal 'n'/'w' typed inside a note passes through to the textarea untouched).
    const unsubKeys = registerKeyExtra((e: KeyboardEvent, editing: boolean): boolean => {
      if (State.screen !== "journal") return false;
      if (editing) return false; // typing in a note: let the character through to the textarea
      const k = e.key.toLowerCase();
      if (k === "n") {
        const ta = feedRef.current?.querySelector<HTMLTextAreaElement>("textarea.jn-note"); // newest-first -> first is newest
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        e.preventDefault(); return true;
      }
      if (k === "w") {
        const cards = journalActiveCards();
        if (cards.length) {
          const c = cards[cards.length - 1]; // newest = last chronological
          toggleTag(c, "WATCHING"); // re-renders the feed (safe: no note focused here)
        }
        e.preventDefault(); return true;
      }
      return false;
    });
    return () => { unsubState(); unsubTruth(); unsubTick(); unsubKeys(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after EVERY render (mount + each state-driven feed re-render): repaint the sidebar numerals
  // so a fresh fill / tag / note updates the ledger immediately (the tick channel above only
  // fires on the 1–2s clock).
  useEffect(() => { renderStats(journalActiveCards()); });

  // -------- feed model: newest-first over the active store (real fills win; else SAMPLE seeds) --------
  const cards = journalActiveCards();
  const view = cards.slice().reverse();

  // -------- BROKER HISTORY model (live build only): real fills + dividends, grouped by day --------
  const ccy = TruthStore.ccy || State.accountCcy || "USD";
  const brokerFills = IS_MOCK ? [] : (TruthStore.fills || []);
  const brokerDivs = IS_MOCK ? [] : (TruthStore.dividends || []);
  const hasBroker = brokerFills.length > 0 || brokerDivs.length > 0;
  const brokerDays = hasBroker ? groupBrokerDays(brokerFills, brokerDivs) : [];
  const brokerSyncing = !IS_MOCK && TruthStore.sync === "syncing" && !hasBroker;
  const brokerErr = !IS_MOCK && TruthStore.sync === "error" && !hasBroker;

  // feed count note: session pages, plus a broker-day count when the live history is present.
  const sessNote = cards.length
    ? (State.ordersLog.length ? cards.length + (cards.length === 1 ? " PAGE" : " PAGES") : "SAMPLE PAGES · CLEAR ON FIRST FILL")
    : "—";
  const feedNote = hasBroker
    ? brokerDays.length + (brokerDays.length === 1 ? " BROKER DAY · " : " BROKER DAYS · ") + sessNote
    : sessNote;

  return (
    <section id="journal" className="appscreen active">
      <div className="screenbody">
        {/* HERO: the paper feed — every session fill becomes a dated, writable page */}
        <div className="card jn-feedcard">
          <span className="plabel">JOURNAL // PAGES · {hasBroker ? "BROKER + SESSION" : "SESSION"}</span>
          <div className="jn-feedhead">
            <span className="chip teal">DIARY</span>
            <span className="jn-feednote">{feedNote}</span>
          </div>
          <div className="jn-feedscroll" ref={feedRef}>
            {/* ---- BROKER HISTORY band (live build): real fills + dividends by calendar day ---- */}
            {hasBroker && (
              <>
                <div className="jn-bandhead">
                  <span className="jn-band-lbl">BROKER HISTORY</span>
                  <span className="jn-band-sub mono">RECORDED · TRADING 212 · {ccy}</span>
                </div>
                {brokerDays.map((g) => (
                  <div className="jn-card jn-broker" key={"bkr-" + g.day}>
                    <div className="jn-cardhead jn-brokerhead">
                      <span className="jn-daydate">{fmtDayLabel(g.day)}</span>
                      <span className="jn-daycount mono">
                        {g.fills.length ? g.fills.length + (g.fills.length === 1 ? " FILL" : " FILLS") : ""}
                        {g.fills.length && g.dividends.length ? " · " : ""}
                        {g.dividends.length ? g.dividends.length + (g.dividends.length === 1 ? " DIV" : " DIVS") : ""}
                      </span>
                    </div>
                    <div className="jn-brokerlines">
                      {/* each fill: side/sym/qty@price — side is a coloured WORD (market direction, not colour alone) */}
                      {g.fills.map((f) => {
                        const buy = f.side === "buy";
                        const cls = buy ? "gain" : "loss";
                        return (
                          <div className="jn-bkrline" key={"f-" + f.id}>
                            <span className={"jn-bkrside " + cls}>{arrow(buy ? 1 : -1)} {f.side.toUpperCase()}</span>
                            <span className="jn-bkrqty mono">{f.quantity}</span>
                            <span className="jn-bkrsym">{f.sym}</span>
                            <span className="jn-at">@</span>
                            {/* instrument-ccy price — bare number, never the account symbol */}
                            <span className="jn-bkrprice mono">{fmtNum(f.fillPriceMinor / 100)}</span>
                            <span className="jn-bkrval mono">{fmtMoney(f.filledValueMinor / 100, ccy)}</span>
                          </div>
                        );
                      })}
                      {/* each dividend: its own honest line item — a cash inflow, so a gain-tinted amount */}
                      {g.dividends.map((dv) => (
                        <div className="jn-bkrline jn-bkrdiv" key={"d-" + dv.id}>
                          <span className="jn-bkrside gain">◆ DIV</span>
                          <span className="jn-bkrsym">{dv.ticker}</span>
                          <span className="jn-bkrprice mono gain">+{fmtMoney(dv.amountMinor / 100, ccy)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {/* honest band divider before the writable session pages */}
                <div className="jn-banddiv"><span className="jn-band-lbl">SESSION</span></div>
              </>
            )}
            {/* ---- SYNC / ERROR note (live build, broker history still loading/failed) ---- */}
            {brokerSyncing && (
              <div className="orders-empty">SYNCING BROKER HISTORY…</div>
            )}
            {/* cause-naming error line (item 13, Orders' pattern): the reason,
                not just the fact — a 403 names its own fix. */}
            {brokerErr && (
              <div className="orders-empty">
                BROKER HISTORY UNAVAILABLE — SYNC FAILED
                {TruthStore.syncError ? <>: <b>{TruthStore.syncError}</b></> : ""}.
                {TruthStore.syncError && TruthStore.syncError.includes("(403)")
                  ? " YOUR TRADING 212 KEY LIKELY LACKS THE HISTORY PERMISSIONS — REGENERATE IT WITH ORDERS/DIVIDENDS/TRANSACTIONS ENABLED."
                  : " THE SESSION PAGES BELOW ARE UNAFFECTED."}
              </div>
            )}

            {/* ---- SESSION pages (writable, exactly as before) ---- */}
            {view.length === 0 ? (
              !hasBroker && !brokerSyncing && !brokerErr && (
                <div className="orders-empty">
                  NO ENTRIES THIS SESSION — STAGE AND CONFIRM FROM <b>POSITIONS.dat</b>, OR JOT A FREE NOTE
                </div>
              )
            ) : (
              view.map((c) => {
                const idx = cards.indexOf(c); // stable index into the store
                const buy = c.side === "BUY";
                const cls = buy ? "gain" : "loss";
                const closed = c.lifeIdx >= JN_LIFECYCLE.length - 1;
                const anyTag = c.tags.size > 0;
                return (
                  <div className={"jn-card" + (c.sample ? " sample" : "")} key={c.sample ? "sample-" + idx : "log-" + c.logIdx}>
                    <div className="jn-cardhead">
                      <span className="jn-time">{c.time}</span>
                      <span className={"jn-side " + cls}>{arrow(buy ? 1 : -1)} {c.side}</span>
                      <span className="jn-qty">{c.qty}</span>
                      <span className="jn-sym">{c.sym}</span>
                      <span className="jn-at">@</span>
                      <span className={"jn-price mono " + cls}>{fmtUSD(c.price, c.price < 10 ? 4 : 2)}</span>
                      {c.sample && <span className="jn-sampletag">SAMPLE</span>}
                    </div>
                    <textarea
                      className="jn-note"
                      rows={2}
                      placeholder="What did I do and think here…"
                      defaultValue={c.note}
                      /* controlled by the store, but NOT via React value: typing mutates the store
                         WITHOUT a re-render so the caret is never disturbed (the prototype's
                         'input' handler wrote c.note and did not re-render). */
                      onChange={(e) => { c.note = e.currentTarget.value; }}
                      onBlur={(e) => { c.note = e.currentTarget.value; renderStats(cards); }}
                      /* the shell's global keymap (Q/E/N/W/arrows) must never swallow typing —
                         but let Escape bubble so the shell's ESC-blurs-the-field contract still runs */
                      onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}
                    />
                    <div className="jn-cardfoot">
                      <div className="jn-tags">
                        {JN_TAGS.map((t) => (
                          <span
                            key={t}
                            className={"tag" + (c.tags.has(t) ? " on" : "")}
                            onClick={() => toggleTag(c, t)}
                          >{t}</span>
                        ))}
                      </div>
                      {c.lifeIdx >= 0 && (
                        <span
                          className={"jn-pill" + (closed ? " closed" : "")}
                          onClick={() => advanceLife(c)}
                        >
                          {JN_LIFECYCLE[c.lifeIdx]}{!closed && <> <span className="jn-pillarrow">▶</span></>}
                        </span>
                      )}
                      {anyTag && (
                        <span className="jn-review">next review <b>{journalReviewDate(c.time)}</b></span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* SUPPORTING: SESSION LEDGER — honest descriptive stats + closed-trade placeholders */}
        <div className="card jn-sidecard">
          <span className="plabel">JOURNAL // SESSION<span className="jn-sampletag" ref={sampleTagRef}> · SAMPLE</span></span>
          <div className="jn-statgrid">
            <div className="jn-statrow"><span className="k">Fills</span><span className="v" ref={fillsRef}>0</span></div>
            <div className="jn-statrow"><span className="k">Buys / Sells</span><span className="v split" ref={splitRef}>0 / 0</span></div>
            <div className="jn-statrow"><span className="k">Net BP Delta</span><span className="v" ref={bpRef}>—</span></div>
            <div className="jn-statrow"><span className="k">Notes Written</span><span className="v" ref={notesRef}>0</span></div>
            <div className="jn-statrow"><span className="k">Tagged</span><span className="v" ref={taggedRef}>0</span></div>
          </div>
          <hr className="jn-siderule" />
          <div className="jn-closedhead">Closed-Trade Stats</div>
          <div className="jn-closedrow"><span className="k">Win Rate</span><span className="v">—</span></div>
          <div className="jn-closedrow"><span className="k">Expectancy</span><span className="v">—</span></div>
          <div className="jn-closedrow"><span className="k">Profit Factor</span><span className="v">—</span></div>
          <div className="jn-closedrow"><span className="k">Avg R</span><span className="v">—</span></div>
          <div className="jn-closedcap">Awaiting closed trades — app port persists round-trips.</div>
        </div>

        <div className="jn-roster-wrap"><Roster /></div>
      </div>

      <div className="hintbar screen-hints">
        <span className="h"><kbd>Q</kbd><kbd>E</kbd><span className="t">CYCLE APPS</span></span>
        <span className="h"><kbd>N</kbd><span className="t">WRITE NOTE</span></span>
        <span className="h"><kbd>W</kbd><span className="t">WATCHING</span></span>
        <span className="h"><kbd>◀</kbd><kbd>▶</kbd><span className="t">ROSTER</span></span>
      </div>
      <div className="escback" onClick={() => gotoScreen("dash")}><kbd>ESC</kbd><span>BACK</span></div>
    </section>
  );
}
