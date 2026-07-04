/* =========================================================================
   TERMINAL 77 — JOURNAL (id=journal, WND-0x9C) — the session PAPER DIARY.

   Answers: "for each trade I made this session, what did I do and think — and
   is my process actually working?" Each State.ordersLog fill auto-becomes a
   dated writable card (humanist-body note + TEAL tag chips + optional
   forward-only lifecycle pill). The SESSION LEDGER sidebar shows honest
   descriptive stats (fills/BP/notes/tagged); win-rate / expectancy / PF / R
   stay em-dash placeholders (no closed round-trips this session).

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
import { arrow, glClass, fmtUSD } from "../engine/dataEngine";
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
    return () => { unsubState(); unsubTick(); unsubKeys(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after EVERY render (mount + each state-driven feed re-render): repaint the sidebar numerals
  // so a fresh fill / tag / note updates the ledger immediately (the tick channel above only
  // fires on the 1–2s clock).
  useEffect(() => { renderStats(journalActiveCards()); });

  // -------- feed model: newest-first over the active store (real fills win; else SAMPLE seeds) --------
  const cards = journalActiveCards();
  const feedNote = cards.length
    ? (State.ordersLog.length ? cards.length + (cards.length === 1 ? " PAGE" : " PAGES") : "SAMPLE PAGES · CLEAR ON FIRST FILL")
    : "—";
  const view = cards.slice().reverse();

  return (
    <section id="journal" className="appscreen active">
      <div className="screenbody">
        {/* HERO: the paper feed — every session fill becomes a dated, writable page */}
        <div className="card jn-feedcard">
          <span className="plabel">JOURNAL // PAGES · SESSION</span>
          <div className="jn-feedhead">
            <span className="chip teal">DIARY</span>
            <span className="jn-feednote">{feedNote}</span>
          </div>
          <div className="jn-feedscroll" ref={feedRef}>
            {view.length === 0 ? (
              <div className="orders-empty">
                NO ENTRIES THIS SESSION — STAGE AND CONFIRM FROM <b>POSITIONS.dat</b>, OR JOT A FREE NOTE
              </div>
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
