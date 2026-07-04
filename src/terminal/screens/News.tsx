/* =========================================================================
   TERMINAL 77 — NEWS (id=news, WND-0x7C) — the HOLDINGS WIRE, ported from
   prototypes/terminal-77 (#news section + renderNews / newsWireRow /
   newsRenderDossier / newsRenderWeek / renderNewsTape / newsTick).

   Answers "what's about to hit the stuff I hold?" — the next holdings-relevant
   catalyst (earnings / macro release / impact-ranked headline) for the roster,
   scannable in under 2s. ALL math lives in engine/news.ts (NewsEngine, the
   lane caches, newsWhen, headlineConsequence, newsCountFor) — this file is
   render-only, exactly the calc/render separation the indicator brief mandated.

   THE PORT'S UPDATE DISCIPLINE (Dashboard.tsx pattern, adapted for a screen
   whose "canvas" is keyed innerHTML rather than 2D contexts):
   1. STRUCTURE IS JSX — plabel, lane segToggle, feed badge, card frames and
      the dossier label render from News/NewsEngine state and re-render only
      via stateSubscribe (lane keys 1/2/3, R refresh, roster jumps — the shell
      already routes all of those through notifyState()).
   2. WIRE ROWS / DOSSIER / WEEK STRIP are HTML-string rebuilds into ref'd
      divs (the prototype's render style — rows carry statusChipHtml + the
      engine's authored consequence HTML), but KEYED on (lane | dataV |
      focusId | selected) so an unrelated notifyState (a watch triggering on
      another symbol, a fill landing) can NOT rebuild the feed and reset the
      reader's scroll. The prototype only rebuilt on lane change / refresh /
      roster jump; the key reproduces that contract under React's broader
      re-render triggers.
   3. NON-REPAINTING IS LAW — EARNINGS/MACRO are scheduled rows, frozen per
      dataV (they never flicker on the 1–2s price tick). Only HEADLINE impact
      digits + consequence lines update in place on tick (dayPct is live),
      via setTickText / innerHTML against data-nimpact / data-nline hooks —
      the feed is NEVER re-sorted or rebuilt under the reader.
   4. THE TAPE ticks every beat regardless of lane — "freshest live impacts"
      must reflect the CURRENT tape (scoreHeadline over live dayPct), not the
      frozen headlines() cache.
   5. DAY ROLLOVER re-freezes the scheduled lanes ONCE (a new session shifts
      every DAYS OUT) — the prototype's newsTick guard, kept module-scoped so
      leaving and re-entering the screen can't double-bump.
   No canvases on this screen → nothing to registerRedraw; the marquee is a
   pure CSS transform loop ([S1]-safe) and survives the power-off untouched.
   ========================================================================= */

import { useEffect, useReducer, useRef } from "react";
import {
  DataEngine, DEFAULT_ROSTER, fmtUSD, fmtNum, fmtCompact, arrow, glClass,
} from "../engine/dataEngine";
import {
  NewsEngine, NEWS_LANES, NEWS_DOW, newsWhen, newsCountFor,
  type NewsRow, type NewsLaneKey,
} from "../engine/news";
import { State, News, stateSubscribe, notifyState, selectInstrument } from "../state";
import { statusChipHtml } from "../components/StatusChip";
import { setTickText } from "../components/dom";
import SegToggle from "../components/SegToggle";
import Roster from "../components/Roster";
import { gotoScreen } from "../bus";

/* ---- module-scoped one-shots (prototype page globals; they must survive
   screen unmount/remount, so they can't live in component state) ---- */
let newsHandshaked = false;      // first-entry live handshake attempted once per app session
let newsLastDay: number | null = null; // day-rollover latch (newsTick)

/* ---------------- lane rows (prototype newsLaneRows) ---------------- */
function newsLaneRows(): NewsRow[] {
  return News.lane === "EARNINGS" ? NewsEngine.earnings()
    : News.lane === "MACRO" ? NewsEngine.macro()
    : NewsEngine.headlines();
}

/* ---------------- wire row HTML (prototype newsWireRow, verbatim) ----------------
   HTML strings by design: rows mix statusChipHtml + the engine's authored
   consequence markup (headlineConsequence returns HTML), and the keyed-
   innerHTML rebuild is what keeps tick patches surgical. */
function newsWireRow(r: NewsRow): string {
  const sel = r.id === News.focusId ? " sel" : "";
  const imm = r.imminent ? " imminent" : "";
  if (r.lane === "EARNINGS") {
    const timingChip = statusChipHtml(r.timing, r.timing === "BMO" ? "high" : r.timing === "AMC" ? "warn" : "ok",
      { pips: r.timing === "BMO" ? 3 : r.timing === "AMC" ? 2 : 1 });
    const badge = r.imminent ? `<span class="news-immchip">IMMINENT</span>` : statusChipHtml("EARNINGS", "warn", { pips: 2 });
    const held = r.heldQty > 0 ? ` · held <b>${fmtNum(r.heldQty, 0)}</b>` : "";
    return `<div class="news-wire${sel}${imm}" data-nid="${r.id}" data-sym="${r.sym}">
      <div class="w-badges">${badge}${timingChip}</div>
      <div class="w-head"><span class="w-sym">${r.sym.replace("-USD", "")}</span> &middot; ${r.companyName}</div>
      <div class="w-when${r.imminent ? " now" : ""}">${newsWhen(r)}</div>
      <div class="w-line">Reports <b>${r.timing}</b> &middot; EPS EST <b>${r.epsEstimated != null ? fmtUSD(r.epsEstimated) : "N/A"}</b> &middot; REV EST <b>$${fmtCompact(r.revenueEstimated)}</b> &middot; ${r.sector}${held}</div>
    </div>`;
  }
  if (r.lane === "MACRO") {
    const lvl = r.impact === "High" ? "high" : r.impact === "Medium" ? "warn" : "ok";
    const impChip = statusChipHtml(r.impact.toUpperCase() + " IMPACT", lvl);
    const badge = r.imminent ? `<span class="news-immchip">IMMINENT</span>` : statusChipHtml("MACRO", "ok", { pips: 1 });
    return `<div class="news-wire${sel}${imm}" data-nid="${r.id}" data-sym="">
      <div class="w-badges">${badge}${impChip}</div>
      <div class="w-head">${r.event} <span style="font-family:var(--f-mono);font-weight:500;font-size:11px;color:var(--ink-soft)">&middot; ${r.country}/${r.currency}</span></div>
      <div class="w-when${r.imminent ? " now" : ""}">${newsWhen(r)} &middot; ${r.timeTxt}</div>
      <div class="w-line">PREV <b>${r.prev}</b> &middot; EST <b>${r.est}</b> &mdash; ${r.line}</div>
    </div>`;
  }
  // HEADLINES — impact digit + consequence line carry the data-hooks the tick patcher targets
  const badge = r.imminent ? `<span class="news-immchip">HIGH IMPACT</span>` : statusChipHtml("HEADLINE", "ok", { pips: 1 });
  const brChip = statusChipHtml(r.breadthLabel, r.breadthLabel === "SYSTEMIC" ? "high" : r.breadthLabel === "SECTOR-WIDE" ? "warn" : "ok");
  return `<div class="news-wire${sel}${imm}" data-nid="${r.id}" data-sym="${r.sym}">
    <div class="w-badges">${badge}${brChip}</div>
    <div class="w-head"><span class="w-sym">${r.sym.replace("-USD", "")}</span> &middot; IMPACT <span data-nimpact="${r.sym}">${r.impact.toFixed(1)}</span></div>
    <div class="w-when">${newsWhen(r)}</div>
    <div class="w-line" data-nline="${r.sym}">${r.line}</div>
  </div>`;
}

/* ---------------- dossier body HTML (prototype newsRenderDossier, body half) ----------------
   The label half is JSX (structure); this builds only the injected body. */
function newsDossierHtml(r: NewsRow | null): string {
  if (!r) return `<div class="news-empty">&mdash;</div>`;
  if (r.lane === "EARNINGS") {
    const tags = [`<span class="tag on">${r.sector}</span>`, `<span class="tag">${r.style}</span>`].join("");
    const kv: [string, string][] = [
      ["REPORTS", NEWS_DOW[r.date.getDay()] + " " + (r.date.getMonth() + 1) + "/" + r.date.getDate()],
      ["TIMING", r.timing + (r.timing === "BMO" ? " · BEFORE OPEN" : r.timing === "AMC" ? " · AFTER CLOSE" : " · TIME TBA")],
      ["MKT CAP", "$" + fmtCompact(r.marketCap)],
      ["EPS EST", r.epsEstimated != null ? fmtUSD(r.epsEstimated) : "N/A"],
      ["REV EST", "$" + fmtCompact(r.revenueEstimated)],
      ["DAYS OUT", r.daysOut + " SESSION" + (r.daysOut === 1 ? "" : "S")],
      ["HELD QTY", r.heldQty > 0 ? fmtNum(r.heldQty, 0) + " sh" : "&mdash;"],
    ];
    return `<div class="news-dosbody">
        <div class="news-doshero"><span class="news-dossym">${r.sym.replace("-USD", "")}</span></div>
        <div class="news-dosco">${r.companyName}</div>
        <div class="news-dostags">${tags}</div>
        ${kv.map(([k, v]) => `<div class="statrow"><span class="lab">${k}</span><span class="val mono">${v}</span></div>`).join("")}
        <div class="news-blurb" style="margin-top:12px">${r.heldQty > 0 ? `You hold <b>${fmtNum(r.heldQty, 0)} sh</b> into this print — mark the calendar.` : `Not in the book — watchlist read only.`} EST from model (price/PE); LIVE swaps FMP consensus. <span style="color:var(--ink-soft)">SIMULATED · NOT INVESTMENT ADVICE</span></div>
      </div>`;
  }
  if (r.lane === "MACRO") {
    const lvl = r.impact === "High" ? "high" : r.impact === "Medium" ? "warn" : "ok";
    return `<div class="news-dosbody">
        <div class="news-doshero"><span class="news-dossym" style="font-size:26px;line-height:1.05">${r.event}</span></div>
        <div class="news-dostags"><span class="tag on">${r.country} / ${r.currency}</span></div>
        <div class="news-doschips">${statusChipHtml(r.impact.toUpperCase() + " IMPACT", lvl)}<span class="mono" style="font-size:10px;color:var(--ink-soft)">${r.timeTxt}</span></div>
        <div class="statrow"><span class="lab">RELEASE</span><span class="val mono">${NEWS_DOW[r.date.getDay()]} ${r.date.getMonth() + 1}/${r.date.getDate()}</span></div>
        <div class="statrow"><span class="lab">PREVIOUS</span><span class="val mono">${r.prev}</span></div>
        <div class="statrow"><span class="lab">ESTIMATE</span><span class="val mono">${r.est}</span></div>
        <div class="statrow"><span class="lab">DAYS OUT</span><span class="val mono">${r.daysOut} SESSION${r.daysOut === 1 ? "" : "S"}</span></div>
        <div class="news-blurb" style="margin-top:12px">${r.line}</div>
      </div>`;
  }
  // HEADLINES — the big impact digit carries data-nimpact-big for the tick patcher
  const tags = [`<span class="tag on">${r.sector}</span>`, ...r.tags.slice(0, 2).map((t) => `<span class="tag">${t}</span>`)].join("");
  return `<div class="news-dosbody">
      <div class="news-doshero"><span class="news-dossym">${r.sym.replace("-USD", "")}</span><span class="news-dosbig" data-nimpact-big="${r.sym}">${r.impact.toFixed(1)}</span></div>
      <div class="news-dosco">IMPACT SCORE &middot; ${r.companyName}</div>
      <div class="news-dostags">${tags}</div>
      <div class="news-doschips">${statusChipHtml(r.breadthLabel, r.breadthLabel === "SYSTEMIC" ? "high" : r.breadthLabel === "SECTOR-WIDE" ? "warn" : "ok")}${statusChipHtml(r.fwdLabel, r.fwdLabel === "TREND CONFIRMATION" ? "warn" : r.fwdLabel === "CONTRARY MOVE" ? "high" : "ok", { pips: r.fwdLabel === "ISOLATED" ? 1 : 2 })}<span class="mono w-num ${glClass(r.dayPct)}" style="font-size:12px">${arrow(r.dayPct)} ${Math.abs(r.dayPct).toFixed(2)}%</span></div>
      <div class="news-blurb">${r.bio}</div>
      <div class="news-blurb" style="margin-top:8px;border-color:var(--ink-soft);color:var(--ink-soft)">${r.priors}</div>
    </div>`;
}

// calendar-day equality (page-scope helper in the prototype; not engine math)
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function NewsScreen() {
  const [, force] = useReducer((n: number) => n + 1, 0);

  const feedRef = useRef<HTMLDivElement | null>(null);      // wire rows (keyed innerHTML)
  const dossierRef = useRef<HTMLDivElement | null>(null);   // dossier body (keyed innerHTML)
  const weekStripRef = useRef<HTMLDivElement | null>(null); // 7 day columns (keyed on dataV)
  const weekFootRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);     // #newsTape marquee track (tick-owned)
  const rootRef = useRef<HTMLElement | null>(null);         // scope for the tick patcher's queries

  /* ---- first entry: the live handshake (prototype renderNews head). On a
     browser build tryLive() is the marked static seam — it synchronously
     resolves to CACHED (no fetch, no CORS spam) and bump()s the freeze. The
     Tauri port swaps the seam inside NewsEngine, not here. Running this in
     the render body (before rows/counts are computed) mirrors the prototype's
     "handshake at the top of renderNews" ordering exactly. ---- */
  if (!newsHandshaked) { newsHandshaked = true; void NewsEngine.tryLive(); }
  // ensure a refresh has run at least once (freezes _now + scheduled rows)
  if (!NewsEngine._now) NewsEngine.bump();

  /* ---- focus resolution (prototype renderNews): prefer the roster-selected
     symbol's row, else the top (most imminent / most impactful). Mutating the
     News singleton here is the port's version of the prototype doing the same
     at the top of its render fn — idempotent per (lane, dataV, selected). ---- */
  const rows = newsLaneRows();
  if (!News.focusId || !rows.some((r) => r.id === News.focusId)) {
    const bySel = rows.find((r) => "sym" in r && r.sym === State.selected);
    News.focusId = (bySel || rows[0])?.id ?? null;
  }
  const focused = rows.find((r) => r.id === News.focusId) || rows[0] || null;
  const dossierLabel = !focused ? "CATALYST DOSSIER"
    : focused.lane === "EARNINGS" ? "CATALYST DOSSIER // EARNINGS"
    : focused.lane === "MACRO" ? "CATALYST DOSSIER // MACRO"
    : "CATALYST DOSSIER // HEADLINE";

  /* ================= FEED (keyed rebuild — lane / refresh / focus / roster jump ONLY) ================= */
  function renderFeed(): void {
    const wrap = feedRef.current; if (!wrap) return;
    const list = newsLaneRows();
    // the rebuild key IS the prototype's rebuild contract: any notifyState that
    // doesn't move one of these leaves the DOM (and the reader's scroll) alone.
    const key = `${News.lane}|${NewsEngine.dataV}|${News.focusId}|${State.selected}`;
    if (wrap.dataset.key === key) return;
    wrap.dataset.key = key;
    wrap.innerHTML = list.length
      ? list.map(newsWireRow).join("")
      : `<div class="news-empty">NO CATALYSTS ON THE WIRE &mdash; desk is quiet.<br>Feed CACHED; last handshake 07:41 EST.</div>`;
  }

  /* ================= DOSSIER (keyed rebuild; big digit is tick-patched between) ================= */
  function renderDossier(): void {
    const body = dossierRef.current; if (!body) return;
    const key = `${News.lane}|${NewsEngine.dataV}|${News.focusId}`;
    if (body.dataset.key === key) return;
    body.dataset.key = key;
    const list = newsLaneRows();
    body.innerHTML = newsDossierHtml(list.find((x) => x.id === News.focusId) || list[0] || null);
  }

  /* ================= THIS WEEK strip (prototype newsRenderWeek; frozen per dataV) ================= */
  function renderWeek(): void {
    const strip = weekStripRef.current, foot = weekFootRef.current;
    if (!strip || !foot) return;
    const key = "wk|" + NewsEngine.dataV;
    if (strip.dataset.key === key) return;
    strip.dataset.key = key;
    const now = NewsEngine._now || new Date();
    const earn = NewsEngine.earnings(), mac = NewsEngine.macro();
    // Anchor the strip to the Monday of the week that holds the SOONEST upcoming catalyst,
    // so on a weekend/quiet week the heavy day still reads (not a dead current calendar week).
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const all = [...earn, ...mac].map((r) => r.date).filter((d) => d >= today);
    const anchor = all.length ? all.reduce((m, d) => (d < m ? d : m)) : now;
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const back = (start.getDay() + 6) % 7; start.setDate(start.getDate() - back);
    const days: { d: Date; cnt: number; wknd: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const cnt = earn.filter((r) => sameDay(r.date, d)).length + mac.filter((r) => sameDay(r.date, d)).length;
      days.push({ d, cnt, wknd: d.getDay() === 0 || d.getDay() === 6 });
    }
    const peak = days.reduce((m, x) => (x.cnt > m ? x.cnt : m), 0);
    strip.innerHTML = days.map((x) => {
      const isPeak = x.cnt > 0 && x.cnt === peak; // heavy day: orange 3px LEFT tick only (§1 — a "look here" verb, not a fill)
      return `<div class="news-daycol${x.wknd ? " wknd" : ""}${isPeak ? " peak" : ""}">
        <span class="d-lbl">${NEWS_DOW[x.d.getDay()]}</span>
        <span class="d-cnt${x.cnt === 0 ? " zero" : ""}">${x.cnt}</span>
      </div>`;
    }).join("");
    const peakDay = days.find((x) => x.cnt > 0 && x.cnt === peak);
    foot.innerHTML = peak > 0 && peakDay
      ? `PEAK DAY &middot; ${NEWS_DOW[peakDay.d.getDay()]} ${peakDay.d.getMonth() + 1}/${peakDay.d.getDate()} &middot; ${peak} ROSTER CATALYST${peak === 1 ? "" : "S"}`
      : `DESK QUIET THIS WEEK &middot; no scheduled roster catalysts`;
  }

  /* ================= TAPE (prototype renderNewsTape — freshest LIVE impacts) =================
     Scores every roster name LIVE (scoreHeadline reads live dayPct) rather than the frozen
     headlines() cache — the tape's "freshest" claim must reflect the current tape, not the
     last bump. Rank by live impact, keep the top 6. Cheap; called on the price tick. */
  function renderTape(): void {
    const track = trackRef.current; if (!track) return;
    const hl = DEFAULT_ROSTER.map((sym) => NewsEngine.scoreHeadline(sym)).sort((a, b) => b.impact - a.impact).slice(0, 6);
    const html = hl.map((r) =>
      `<span${r.imminent ? ' class="fl"' : ""}>${r.sym.replace("-USD", "")} ${arrow(r.dayPct)}${Math.abs(r.dayPct).toFixed(2)}% · IMPACT ${r.impact.toFixed(1)}</span><span> // </span>`
    ).join("");
    const wrap = html || "<span>NO CATALYSTS ON THE WIRE · desk is quiet</span>";
    track.innerHTML = wrap + wrap; // duplicate for seamless loop
  }

  /* ---------------- wiring: structure re-render + tick patch channels ---------------- */
  useEffect(() => {
    const unsubState = stateSubscribe(force); // lane keys 1/2/3, R refresh, roster jump, focus click
    // NON-REPAINTING tick (prototype newsTick): EARNINGS/MACRO are scheduled — frozen
    // until R / rollover. Only HEADLINE impact digits (dayPct is live) update in place,
    // and only when that lane is shown; the feed is NEVER re-sorted or rebuilt under
    // the reader.
    const unsubTick = DataEngine.subscribe(() => {
      // day rollover -> re-freeze scheduled rows once (a new session shifts every DAYS OUT)
      const dnow = new Date().getDate();
      if (newsLastDay !== null && dnow !== newsLastDay) { newsLastDay = dnow; NewsEngine.bump(); notifyState(); return; }
      newsLastDay = dnow;
      // the TAPE tracks the freshest live impacts regardless of lane (glyphs only)
      renderTape();
      if (News.lane !== "HEADLINES") return; // scheduled lanes don't flicker on the price tick
      // recompute HEADLINE score digits in place — no re-sort, no DOM rebuild
      const root = rootRef.current; if (!root) return;
      DEFAULT_ROSTER.forEach((sym) => {
        const s = NewsEngine.scoreHeadline(sym);
        const cell = root.querySelector<HTMLElement>(`[data-nimpact="${sym}"]`);
        if (cell) setTickText(cell, s.impact.toFixed(1));
        const big = root.querySelector<HTMLElement>(`[data-nimpact-big="${sym}"]`);
        if (big) setTickText(big, s.impact.toFixed(1));
        const line = root.querySelector<HTMLElement>(`[data-nline="${sym}"]`);
        if (line) line.innerHTML = s.line;
      });
    });
    return () => { unsubState(); unsubTick(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after EVERY render (mount + each state-driven re-render): the injected halves.
  // Each is keyed, so a repaint whose inputs didn't move is a no-op (scroll survives).
  useEffect(() => { renderFeed(); renderDossier(); renderWeek(); renderTape(); });

  /* ---- feed click delegation (prototype wired per-row listeners after every
     rebuild; one delegated handler on the scroller does the same job without
     re-wiring). A symbol row routes through selectInstrument (roster follows,
     which re-resolves focus to the selected name); a MACRO row (no sym) just
     moves the focus ring + dossier. ---- */
  function onFeedClick(e: React.MouseEvent<HTMLDivElement>): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".news-wire[data-nid]");
    if (!el) return;
    News.focusId = el.dataset.nid || null;
    if (el.dataset.sym) selectInstrument(el.dataset.sym); // routes roster + re-renders us
    else notifyState();
  }

  return (
    <section id="news" className="appscreen active" ref={rootRef}>
      <div className="screenbody news-body">
        {/* HERO: the scannable holdings WIRE FEED — the ONE answer */}
        <div className="card news-feed-card">
          <span className="plabel" id="newsPlabel">{`NEWS // ${News.lane} · MODEL`}</span>
          <div className="news-feedhead">
            <span className="chip teal">NEWS // HOLDINGS WIRE</span>
            <div className="news-lanes" id="newsLanes">
              <SegToggle
                options={NEWS_LANES.map((l) => ({ key: l.key, label: l.label, count: newsCountFor(l.key) }))}
                active={News.lane}
                onPick={(key) => { News.lane = key as NewsLaneKey; News.focusId = null; notifyState(); }}
              />
            </div>
            {/* OFFLINE // CACHED reads orange (the taskbar convention) — never red */}
            <span className={"news-badge" + (NewsEngine.live ? "" : " cached")} id="newsBadge">
              {NewsEngine.live ? "FEED: LIVE" : "FEED: CACHED"}
            </span>
          </div>
          <div className="marquee news-tape"><div className="track" id="newsTape" ref={trackRef} /></div>
          <div className="news-feedscroll" id="newsFeedWrap" ref={feedRef} onClick={onFeedClick} />
        </div>

        {/* SUPPORTING: catalyst dossier for the focused wire row + THIS-WEEK density strip */}
        <div className="news-side">
          <div className="card news-dossier">
            <span className="plabel" id="newsDossierLabel">{dossierLabel}</span>
            <div id="newsDossierBody" ref={dossierRef} />
          </div>
          <div className="card news-week">
            <span className="plabel">THIS WEEK // ROSTER CATALYSTS</span>
            <div className="news-weekstrip" id="newsWeekStrip" ref={weekStripRef} />
            <div className="news-weekfoot mono" id="newsWeekFoot" ref={weekFootRef}>&mdash;</div>
          </div>
        </div>

        <div className="news-roster-wrap"><Roster /></div>
      </div>

      <div className="hintbar screen-hints">
        <span className="h"><kbd>Q</kbd><kbd>E</kbd><span className="t">CYCLE APPS</span></span>
        <span className="h"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><span className="t">LANE</span></span>
        <span className="h"><kbd>R</kbd><span className="t">REFRESH</span></span>
        <span className="h"><kbd>◀</kbd><kbd>▶</kbd><span className="t">ROSTER</span></span>
      </div>
      <div className="escback" onClick={() => gotoScreen("dash")}><kbd>ESC</kbd><span>BACK</span></div>
    </section>
  );
}
