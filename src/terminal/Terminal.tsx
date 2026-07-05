/* =========================================================================
   TERMINAL 77 — THE PERSISTENT SHELL (Terminal.tsx)

   Mounted at route /:screenId and NEVER remounts between terminal screens —
   navigating dashboard→scanner only swaps the screen component inside
   #screen, under the ~455ms 3-phase CRT power-off. Everything the prototype
   kept at page scope lives here:

     • topbar (MDN wordmark · OPERATOR · DESK 07), window frame + #winTitle,
       LEFT glyph-only icon rail (42px, native tooltips), taskbar
       (feed/mkt/battery/vol/SIMULATED disclaimer/clock)
     • the CRT overlay stack (crtBend/Vig/Roll/Scan/Glass/Bezel + the
       screenWrap tube ::before/::after) + scheduleJitter, all gated on
       prefers-reduced-motion — every layer transform/opacity/gradient only.
       ABSOLUTE BANS hold: no mix-blend-mode, no CSS filter:, no
       backdrop-filter, no per-frame blur (the v1 app BRICKED violating this).
     • the [S3] power-off transition — brightness rides a WHITE overlay's
       opacity; #screen itself only ever animates transform. The route swap
       happens while the tube is a dot (flushSync so the new screen exists
       before power-on).
     • the GLOBAL KEYBOARD MAP (verbatim prototype dispatch, gated on
       State.screen + !editing) — screens add DOM-touching keys through
       bus.registerKeyExtra.
     • the engine clock: DataEngine.start() on mount / stop() on unmount;
       every tick also evaluates armed watches so a TRIGGERED cross raises
       the roster star from ANY screen (latching; jitter-safe).

   ROUTE MIRROR (mandatory): State.screen is set from the :screenId param in
   the render body, BEFORE children render — selectInstrument's per-screen
   dispatch and the keyboard gating read it synchronously.
   ========================================================================= */

import { useEffect, useRef, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import "./terminal.css";
import { DataEngine, isMarketOpen } from "./engine/dataEngine";
import { startLive, stopLive, refreshLive } from "./engine/live";
import { recordSnapshot } from "./engine/liveHistory";
import { TruthStore } from "./engine/truthStore";
// SHARED CONTRACT (owner: worker C) — the persisted refresh-interval preference.
// Consumed here to drive the live poller (item 17) instead of the old hardcoded
// 5-minute constant. tsc will flag this import until prefs.ts lands; that drift
// is expected per the wave-1 worker split.
import { getSyncIntervalMs } from "./engine/prefs";
import {
  State, notifyState, alertsSeedBook, evaluateWatchesNow,
  confirmStage, stageDelta, resetStage, toggleStrategy, moveRoster,
  Scan, Compare, News, Perf, perfOn, PERF_FLAT,
  alertResetWatch, alertCycleMetric, alertToggleOp, alertTicketStep,
  type ScreenId,
} from "./state";
import { SCAN_PRESETS } from "./engine/scan";
import { NEWS_LANES, NewsEngine } from "./engine/news";
import { pushMarquee, runKeyExtras, runRedraws, setGotoScreenImpl, prefersReduced } from "./bus";
import Dashboard from "./screens/Dashboard";
import Positions from "./screens/Positions";
import Watchlist from "./screens/Watchlist";
import Performance from "./screens/Performance";
import Orders from "./screens/Orders";
import Scanner from "./screens/Scanner";
import Alerts from "./screens/Alerts";
import NewsScreen from "./screens/News";
import Compare2 from "./screens/Compare";
import Journal from "./screens/Journal";

/* ---------------- SCREEN REGISTRY (prototype SCREENS + route names) ----------------
   `id` is the prototype/state ScreenId (keyboard gating, selectInstrument
   dispatch); `route` is the URL segment under /:screenId. */
interface ScreenDef {
  id: ScreenId; route: string; name: string; wid: string; icon: string; file: string;
  Comp: ComponentType;
}
export const SCREENS: ScreenDef[] = [
  { id: "dash",    route: "dashboard",   name: "DASHBOARD",   wid: "WND-0x2F", icon: "dash",    file: "DASHBOARD.exe",   Comp: Dashboard },
  { id: "pos",     route: "positions",   name: "POSITIONS",   wid: "WND-0x3A", icon: "pos",     file: "POSITIONS.dat",   Comp: Positions },
  { id: "watch",   route: "watchlist",   name: "WATCHLIST",   wid: "WND-0x4C", icon: "watch",   file: "WATCHLIST.idx",   Comp: Watchlist },
  { id: "perf",    route: "performance", name: "PERFORMANCE", wid: "WND-0x6E", icon: "perf",    file: "PERFORMANCE.chz", Comp: Performance },
  { id: "orders",  route: "orders",      name: "ORDERS",      wid: "WND-0x5D", icon: "orders",  file: "ORDERS.log",      Comp: Orders },
  { id: "scan",    route: "scanner",     name: "SCANNER",     wid: "WND-0x7A", icon: "scan",    file: "SCANNER.scr",     Comp: Scanner },
  { id: "alerts",  route: "alerts",      name: "ALERTS",      wid: "WND-0x7B", icon: "alerts",  file: "ALERTS.wch",      Comp: Alerts },
  { id: "news",    route: "news",        name: "NEWS",        wid: "WND-0x7C", icon: "news",    file: "NEWS.wire",       Comp: NewsScreen },
  { id: "compare", route: "compare",     name: "COMPARE",     wid: "WND-0x8B", icon: "compare", file: "COMPARE.cmp",     Comp: Compare2 },
  { id: "journal", route: "journal",     name: "JOURNAL",     wid: "WND-0x9C", icon: "journal", file: "JOURNAL.pgs",     Comp: Journal },
];
const byRoute = (route: string | undefined) => SCREENS.find((s) => s.route === route);
const routeOf = (id: ScreenId) => SCREENS.find((s) => s.id === id)!.route;

/* ---------------- ICON GLYPHS (verbatim) ---------------- */
const GLYPHS: Record<string, string> = {
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="5"/><rect x="13" y="10" width="8" height="11"/><rect x="3" y="13" width="8" height="8"/></svg>',
  pos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 20h18"/><rect x="4" y="12" width="4" height="7"/><rect x="10" y="7" width="4" height="12"/><rect x="16" y="10" width="4" height="9"/></svg>',
  watch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M8 4v16"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="3" width="14" height="18"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  perf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3v18h18"/><path d="M6 15l4-5 3 3 5-8"/><rect x="6" y="16" width="2" height="3"/><rect x="11" y="14" width="2" height="5"/><rect x="16" y="11" width="2" height="8"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4h18l-7 8v6l-4 2v-8z"/><circle cx="17" cy="17" r="3.2"/><path d="M19.3 19.3L22 22"/></svg>',
  alerts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 20a2 2 0 004 0"/></svg>',
  news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5h13v14H5a2 2 0 01-1-1.7z"/><path d="M17 8h2.2a1.8 1.8 0 011.8 1.8V17a2 2 0 01-2 2"/><path d="M7 8h7M7 11h7M7 14h4"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 3l6 4.4v5.2L9 17V3z"/><path d="M15 7l6 4.4v5.2L15 21v-4.4"/><path d="M4 12h3M4 9l-2 3 2 3"/></svg>',
  journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 3h11a2 2 0 012 2v14a2 2 0 01-2 2H5z"/><path d="M5 3v18"/><path d="M8 7h7M8 11h7"/><path d="M8 15l3 2 5-6"/></svg>',
};

// Under a design/mock build (VITE_MOCK=1) live.ts is a no-op and there is no real
// account to sync — the taskbar sync chip is HIDDEN so the locked mock look stays
// byte-for-byte (item 13: "hidden is safer"). Every sync-chip code path guards on
// this so nothing new paints in the mock world.
const IS_MOCK = import.meta.env.VITE_MOCK === "1";

/* ================= AUDIO (optional, gated by vol toggle — verbatim) ================= */
let audioCtx: AudioContext | null = null;
function beep(kind: "off" | "on" | "tick"): void {
  if (State.muted) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = "square";
    const t = audioCtx.currentTime; const v = (State.vol / 100) * 0.05;
    if (kind === "off") { o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.12); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13); o.start(t); o.stop(t + 0.14); }
    else if (kind === "on") { o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(1500, t + 0.06); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); o.start(t); o.stop(t + 0.1); }
    else { o.frequency.setValueAtTime(1200, t); g.gain.setValueAtTime(v * 0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03); o.start(t); o.stop(t + 0.04); }
  } catch { /* audio is decoration; never let it throw into the shell */ }
}

export default function Terminal() {
  const { screenId } = useParams();
  const navigate = useNavigate();
  const def = byRoute(screenId);

  // ROUTE MIRROR — before any child renders, so per-screen keyboard gating and
  // selectInstrument's dispatch see the prototype's State.screen semantics.
  if (def) State.screen = def.id;

  // The engine must be seeded before the FIRST child render (Roster/Dashboard
  // read quotes at render time — the prototype called DataEngine.init() first).
  if (!Object.keys(DataEngine.quotes).length) DataEngine.init();
  alertsSeedBook();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<HTMLDivElement | null>(null);
  const whiteRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  // taskbar segments (imperatively patched every second — no shell re-render)
  const tbFeedRef = useRef<HTMLSpanElement | null>(null);
  const tbDiscRef = useRef<HTMLSpanElement | null>(null);
  const tbMktRef = useRef<HTMLSpanElement | null>(null);
  const tbVolRef = useRef<HTMLSpanElement | null>(null);
  const tbSyncRef = useRef<HTMLSpanElement | null>(null); // item 13/14: live sync chip (LIVE builds only)
  const tbClockRef = useRef<HTMLSpanElement | null>(null);

  // shell-lifetime mutable state (the prototype's page-scoped lets)
  const shell = useRef({ switching: false, timers: [] as number[], panelIdx: -1, jitterTimer: 0 as number | ReturnType<typeof setTimeout> });

  /* ---------------- [S3] CRT POWER-OFF (verbatim timing; refs not $()) ---------------- */
  function runPowerOff(swapFn: () => void): void {
    const s = shell.current;
    s.switching = true;
    const scr = screenRef.current!, fx = fxRef.current!, white = whiteRef.current!, dot = dotRef.current!;
    // A back-to-back Q/E can land during the previous transition's ~200ms settle tail
    // (input unlocks early at phase 3). Cancel that tail's still-pending timers and
    // reset every surface it was mid-animating, so this transition starts from a
    // clean, full-size, fx-visible state instead of a half-collapsed one.
    s.timers.forEach(clearTimeout); s.timers = [];
    scr.style.transition = ""; scr.style.transform = "";
    white.style.transition = ""; white.style.opacity = "0";
    dot.style.transition = ""; dot.style.opacity = "0";
    fx.style.display = "block";
    // PHASE 1 — collapse (~150ms): scaleY -> line, white overlay ramps up (brightness)
    scr.style.transition = "transform .15s ease-in, opacity .15s ease-in";
    white.style.transition = "opacity .15s ease-in";
    scr.style.transformOrigin = "center center";
    requestAnimationFrame(() => {
      scr.style.transform = "scaleY(0.006)";
      white.style.opacity = "0.55";
    });
    s.timers.push(window.setTimeout(() => {
      // PHASE 2 — dot (~120ms): scaleX -> dot; white fades; phosphor dot with green halo
      scr.style.transition = "transform .12s ease-in, opacity .12s";
      white.style.transition = "opacity .12s";
      scr.style.transform = "scaleY(0.006) scaleX(0.001)";
      white.style.opacity = "0";
      dot.style.transition = "opacity .08s"; dot.style.opacity = "1";
      s.timers.push(window.setTimeout(() => {
        // swap content while black. Canvases drawn during the collapse use the
        // offsetWidth fallback in fitCanvas (transform-immune), so they size
        // correctly despite the squash. flushSync so the new screen's DOM
        // exists before the tube powers back on.
        flushSync(swapFn);
        // The incoming screen's own mount/after-render effect draws its canvases
        // (fitCanvas's offsetWidth fallback sizes them correctly under the collapse).
        // Defer a belt-and-suspenders redraw to the next macrotask — AFTER React's
        // passive effects have swapped the redraw registry to the new screen's
        // closures. (An immediate runRedraws() here would only hit the OUTGOING
        // screen's already-nulled refs and no-op.)
        s.timers.push(window.setTimeout(runRedraws, 0));
        scr.style.transform = "scaleY(0.006) scaleX(0.001)";
        // lingering dot then fade
        s.timers.push(window.setTimeout(() => {
          dot.style.transition = "opacity .1s"; dot.style.opacity = "0";
          // PHASE 3 — power-on: line -> full, overshoot + one-frame jitter.
          // release the input lock now — the screen is already usable through the settle.
          s.switching = false;
          scr.style.transition = "transform 0s";
          scr.style.transform = "scaleY(0.006) scaleX(1)"; // snap to full-width line
          white.style.transition = "opacity .06s"; white.style.opacity = "0.35"; // brief spike
          requestAnimationFrame(() => {
            scr.style.transition = "transform .13s cubic-bezier(.2,1.4,.4,1)";
            scr.style.transform = "scaleY(1.02) scaleX(1)";
            white.style.transition = "opacity .13s"; white.style.opacity = "0";
            s.timers.push(window.setTimeout(() => {
              // settle + one frame of horizontal jitter as "signal locks" — a true
              // two-frame snap, not an eased wobble, so kill the transition first.
              scr.style.transition = "transform 0s";
              scr.style.transform = "translateX(2px) scaleY(1) scaleX(1)";
              requestAnimationFrame(() => { requestAnimationFrame(() => {
                scr.style.transform = "translateX(0) scale(1)";
              }); });
              s.timers.push(window.setTimeout(() => {
                scr.style.transition = ""; scr.style.transform = ""; fx.style.display = "none";
                runRedraws(); // final re-fit now the box is at true size
                beep("on");
              }, 40));
            }, 130));
          });
        }, 15));
      }, 120));
    }, 150));
    beep("off");
  }

  /* ---------------- in-shell navigation (same route pattern, no remount) ---------------- */
  function gotoScreen(id: ScreenId): void {
    if (id === State.screen || shell.current.switching) return;
    const doNav = () => navigate("/" + routeOf(id));
    if (prefersReduced) {
      // reduced motion: simple 100ms fade. Mirror runPowerOff's bookkeeping so the
      // switching-lock debounces rapid presses AND the unmount cleanup can clear the
      // timers (else an ESC-to-Animus within 100ms leaves an orphaned nav that yanks
      // the user back into the terminal and remounts the shell).
      const s = shell.current;
      s.switching = true;
      const scr = screenRef.current!;
      scr.style.transition = "opacity .1s"; scr.style.opacity = "0";
      s.timers.push(window.setTimeout(() => {
        flushSync(doNav);
        s.timers.push(window.setTimeout(runRedraws, 0));
        scr.style.opacity = "1";
        s.timers.push(window.setTimeout(() => { scr.style.transition = ""; }, 120));
        s.switching = false;
      }, 100));
      return;
    }
    runPowerOff(doNav);
  }
  function cycleApp(dir: number): void {
    const i = SCREENS.findIndex((sc) => sc.id === State.screen);
    const ni = (i + dir + SCREENS.length) % SCREENS.length;
    gotoScreen(SCREENS[ni].id);
  }

  // TAB cycles a teal focus outline through the active screen's top-level paper
  // cards (brief §2 lists TAB among the keycaps to "wire for real").
  function cyclePanel(): void {
    const root = rootRef.current; if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>(".appscreen .card"));
    if (!cards.length) return;
    root.querySelectorAll(".panel-focus").forEach((el) => el.classList.remove("panel-focus"));
    shell.current.panelIdx = (shell.current.panelIdx + 1) % cards.length;
    cards[shell.current.panelIdx].classList.add("panel-focus");
  }
  function clearPanelFocus(): void {
    rootRef.current?.querySelectorAll(".panel-focus").forEach((el) => el.classList.remove("panel-focus"));
    shell.current.panelIdx = -1;
  }

  /* ---------------- taskbar (clock + market state + feed — verbatim) ---------------- */
  function updateTaskbar(): void {
    const now = new Date();
    if (tbClockRef.current) tbClockRef.current.textContent = now.toTimeString().slice(0, 8);
    const { open, et } = isMarketOpen(now);
    const mkt = tbMktRef.current;
    if (mkt) {
      mkt.className = "seg mkt " + (open ? "open" : "closed");
      mkt.innerHTML = `mkt: <b>${open ? "OPEN" : "CLOSED"} ${et.toTimeString().slice(0, 8)} EST</b>`;
    }
    const feed = tbFeedRef.current;
    if (feed) {
      if (DataEngine.live) { feed.className = "seg feed live"; feed.innerHTML = `feed: <b>LIVE ${DataEngine.latencyMs}ms</b>`; }
      else { feed.className = "seg feed offline"; feed.innerHTML = `feed: <b>OFFLINE // CACHED</b>`; }
    }
    if (tbVolRef.current) tbVolRef.current.innerHTML = `vol: <b>${State.muted ? "MUTED" : State.vol + "%"}</b>`;
    const disc = tbDiscRef.current;
    if (disc) {
      // Honest disclaimer: when the account link is LIVE the holdings/value/P&L are
      // real, but the intraday candles + equity curve are still modelled (2c) — say
      // so rather than blanket-labelling live money "SIMULATED".
      disc.textContent = DataEngine.live
        ? "LIVE ACCOUNT · INTRADAY MODELLED · NOT INVESTMENT ADVICE"
        : "SIMULATED · NOT INVESTMENT ADVICE";
    }
  }

  /* ---------------- SYNC CHIP (items 13 + 14) ----------------
     A persistent taskbar segment mirroring the live history/account sync from
     TruthStore. LIVE builds only (hidden under VITE_MOCK — the mock world has no
     real sync, and a chip would break the locked look). Imperatively patched from
     BOTH the 1s clock (so "LIVE · HH:MM" freshness tracks) and the TruthStore
     subscription (so a landing sync / error flips instantly). It is CLICKABLE and
     mirrors the Shift+R chord — SYNC NOW (item 14). While a sync is in flight the
     text reads SYNCING… driven purely by TruthStore.sync (no fake spinner state).

     Tones reuse the taskbar's established grammar: teal = healthy/info,
     orange (--orange) = a demand/attention state (SYNCING / PARTIAL / ERR). */
  function updateSyncChip(): void {
    const chip = tbSyncRef.current;
    if (!chip) return; // hidden under mock — the span isn't rendered
    let cls = "seg sync";
    let html: string;
    if (TruthStore.sync === "syncing") {
      cls += " syncing";
      html = "sync: <b>SYNCING…</b>";
    } else if (TruthStore.sync === "error") {
      cls += " err";
      // parse a status code out of the honest syncError reason (e.g.
      // "…/history/orders failed (403)") so the chip names WHY at a glance; fall
      // back to a bare ERR when no code is present (network drop, parse failure).
      const m = TruthStore.syncError ? TruthStore.syncError.match(/\b(\d{3})\b/) : null;
      html = m ? `sync: <b>ERR (${m[1]})</b>` : "sync: <b>ERR</b>";
    } else if (TruthStore.txnsPartial) {
      // deep deposit history blocked (T212 pagination gap) — NET CONTRIBUTIONS is
      // understated; amber so the user knows the truth deck is caveated.
      cls += " partial";
      html = "sync: <b>PARTIAL</b>";
    } else if (TruthStore.syncedAtISO) {
      // healthy: last successful landing, HH:MM local.
      const t = new Date(TruthStore.syncedAtISO);
      const hhmm = Number.isNaN(t.getTime())
        ? "--:--"
        : t.toTimeString().slice(0, 5);
      html = `sync: <b>LIVE · ${hhmm}</b>`;
    } else {
      // no sync has landed yet this launch (idle) — honest "awaiting first sync".
      html = "sync: <b>—</b>";
    }
    chip.className = cls;
    chip.innerHTML = html;
  }

  /** SYNC NOW (item 14) — force an immediate account + history re-sync. The chip
   *  flips to SYNCING… on its own the moment TruthStore.sync goes "syncing" (the
   *  subscription repaints it); refreshLive() is a no-op under mock / no key. */
  function syncNow(): void {
    if (IS_MOCK) return;
    refreshLive();
  }

  /* ---------------- MOUNT: clock, keyboard, jitter, delegates ---------------- */
  useEffect(() => {
    setGotoScreenImpl(gotoScreen);

    // the shell owns the engine clock: 1–2s mock walk + boot-time Coinbase
    // handshake (15s re-poll on success) live inside DataEngine.start().
    DataEngine.start();
    // LIVE ORCHESTRATOR (phase 2a): pull the user's real Trading 212 holdings +
    // live prices into the engine (no-op under VITE_MOCK / no key).
    // ITEM 17 — the poll interval is now the persisted Settings preference, not a
    // hardcoded 5 min. getSyncIntervalMs() returns 0 for MANUAL, which live.ts's
    // startLive treats as ONE-SHOT (refresh on entry, no timer) — manual mode then
    // relies on SYNC NOW (item 14) for every subsequent sync.
    startLive(getSyncIntervalMs());
    const unsubTick = DataEngine.subscribe(() => {
      // Watches evaluate UNCONDITIONALLY so a TRIGGERED cross surfaces the orange
      // roster .flag star even while the user is on another screen (latching).
      if (evaluateWatchesNow()) notifyState();
      updateTaskbar(); // feed banner tracks live/offline flips
    });
    updateTaskbar();
    // ITEM 13 — the sync chip mirrors the history/account sync. Repaint it from
    // BOTH the clock (below, for "LIVE · HH:MM" freshness) and a TruthStore
    // subscription (here, so a landing sync / 403 / PARTIAL flips instantly).
    updateSyncChip();
    const unsubSync = TruthStore.subscribe(updateSyncChip);
    // clock also patches the sync chip so the "LIVE · HH:MM" reading never goes
    // stale between TruthStore notifications (which only fire on sync activity).
    const clockIv = window.setInterval(() => { updateTaskbar(); updateSyncChip(); }, 1000);

    // window resize → re-fit every registered canvas (debounced, prototype cadence)
    let rz = 0;
    const onResize = () => { clearTimeout(rz); rz = window.setTimeout(runRedraws, 120); };
    window.addEventListener("resize", onResize);

    /* ---- [S6+] PHOSPHOR LIFE: one-frame horizontal jitter (verbatim gates) ---- */
    const scheduleJitter = () => {
      if (prefersReduced) return;
      const wait = 9000 + Math.random() * 6000; // 9–15s
      shell.current.jitterTimer = setTimeout(() => {
        const scr = screenRef.current, fx = fxRef.current;
        // ITEM 38 — pause when hidden: don't animate the phosphor jitter (a
        // transform write + repaint) while the app is not visible. The timer chain
        // is kept alive (scheduleJitter() below still re-arms) so the effect
        // resumes cleanly on show; only the jitter BODY is skipped this cycle.
        const hidden = typeof document !== "undefined" && document.hidden;
        const idle = !hidden && !shell.current.switching && scr && (!fx || fx.style.display === "none" || fx.style.display === "") && !scr.style.transform;
        if (idle && scr) {
          const dx = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.round(Math.random())); // ±1 or ±2px
          scr.style.transition = "transform 0s";
          scr.style.transform = "translateX(" + dx + "px)";
          requestAnimationFrame(() => { requestAnimationFrame(() => {
            // only clear if we still own the transform (a switch may have started meanwhile)
            if (scr.style.transform === "translateX(" + dx + "px)") { scr.style.transform = ""; scr.style.transition = ""; }
          }); });
        }
        scheduleJitter();
      }, wait);
    };
    scheduleJitter();

    /* ---- GLOBAL KEYBOARD MAP (prototype dispatch, verbatim gating) ---- */
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "Shift" && e.location === 1) { rootRef.current?.classList.add("tips"); return; } // LSHIFT tooltips
      const ae = document.activeElement;
      const editing = !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA"); // TEXTAREA covers the JOURNAL note field
      // ITEM 14 — SYNC NOW chord: Shift+R forces an immediate account + history
      // re-sync. Handled in the SHELL, BEFORE runKeyExtras, so it never collides
      // with the heavily-overloaded bare "r" (scanner sort / alerts reset / news
      // re-wire) — the audit found no screen claims a Shift chord, and bare Shift
      // (location 1) is the tooltip toggle above, not a chord. Gated on !editing so
      // holding Shift to type an uppercase "R" in the journal note still types.
      // EXACT chord only: Cmd/Ctrl/Alt+Shift+R (WebView hard-reload, future menu
      // accelerators) must fall through untouched. Mock builds skip entirely —
      // syncNow() no-ops there and swallowing the key would change the locked
      // mock keyboard behaviour.
      if (
        !IS_MOCK &&
        (e.key === "R" || e.key === "r") &&
        e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey &&
        !editing
      ) {
        syncNow(); e.preventDefault(); return;
      }
      // screens claim DOM-touching keys first (A focus level input, N/W journal, tutorial gate…)
      if (runKeyExtras(e, editing)) return;
      // PERFORMANCE quick-toggles: number keys 1–9 flip the first nine indicators.
      if (State.screen === "perf" && !editing && /^[1-9]$/.test(k)) {
        const id = PERF_FLAT[parseInt(k, 10) - 1];
        if (id) { perfOn[id] = !perfOn[id]; Perf.cache = {}; notifyState(); }
        e.preventDefault(); return;
      }
      // NEWS lane quick-select 1/2/3 (guarded to news so it never collides with PERF's 1-9)
      if (State.screen === "news" && !editing && /^[1-3]$/.test(k)) {
        const lane = NEWS_LANES[parseInt(k, 10) - 1];
        if (lane) { News.lane = lane.key; News.focusId = null; notifyState(); }
        e.preventDefault(); return;
      }
      switch (k.toLowerCase()) {
        case "i": if (editing) break; if (State.screen === "perf") { Perf.railHidden = !Perf.railHidden; notifyState(); e.preventDefault(); } break;
        case "q": if (editing) break; cycleApp(-1); e.preventDefault(); break;
        case "e": if (editing) break; cycleApp(1); e.preventDefault(); break;
        case "arrowleft": if (!editing) { moveRoster(-1); e.preventDefault(); } break;
        case "arrowright": if (!editing) { moveRoster(1); e.preventDefault(); } break;
        case "arrowup": if (State.screen === "pos" && !editing) { stageDelta(+1); e.preventDefault(); } break;
        case "arrowdown": if (State.screen === "pos" && !editing) { stageDelta(-1); e.preventDefault(); } break;
        case "+": case "=":
          if (State.screen === "pos" && !editing) { stageDelta(+1); e.preventDefault(); }
          else if (State.screen === "alerts" && editing) { alertTicketStep(+1); e.preventDefault(); }
          break;
        case "-": case "_":
          if (State.screen === "pos" && !editing) { stageDelta(-1); e.preventDefault(); }
          else if (State.screen === "alerts" && editing) { alertTicketStep(-1); e.preventDefault(); }
          break;
        case "enter":
          // pos+editing (stepQty commit) and alerts+editing (level commit + arm)
          // are handled by the screens' own input onKeyDown — the inputs hold
          // focus, so the commit needs THEIR DOM (registerKeyExtra/input handlers).
          if (State.screen === "pos" && !editing) {
            const fill = confirmStage();
            if (fill) pushMarquee("▸ ORDER FILLED :: " + fill.line, true);
            e.preventDefault();
          }
          break;
        case "s": if (editing) break; if (State.screen === "scan") { const ks = SCAN_PRESETS.map((p) => p.key); Scan.preset = ks[(ks.indexOf(Scan.preset) + 1) % ks.length]; notifyState(); e.preventDefault(); } break;
        case "c": if (editing) break; if (State.screen === "compare") { Compare.picker.cycle(); notifyState(); e.preventDefault(); } break; // cycle the ACTIVE slot (orange focus ring)
        case "d":
          if (editing) break;
          if (State.screen === "scan") { const ks = SCAN_PRESETS.map((p) => p.key); Scan.preset = ks[(ks.indexOf(Scan.preset) - 1 + ks.length) % ks.length]; notifyState(); e.preventDefault(); }
          else if (State.screen === "compare") { Compare.picker.slots[Compare.picker.active] = null; notifyState(); e.preventDefault(); } // clear active slot -> diegetic empty
          break;
        case "r":
          if (editing) break;
          if (State.screen === "scan") { const so = ["SCORE", "1D%", "RSI"] as const; Scan.sortKey = so[(so.indexOf(Scan.sortKey) + 1) % so.length]; notifyState(); e.preventDefault(); }
          else if (State.screen === "alerts") { alertResetWatch(); e.preventDefault(); }
          else if (State.screen === "news") { void NewsEngine.tryLive().then(() => notifyState()); e.preventDefault(); } // re-run the wire (static seam -> diegetic CACHED)
          break;
        case "n": if (editing) break;
          if (State.screen === "alerts") { alertCycleMetric(); e.preventDefault(); }
          // journal's N (focus newest note) needs the screen's DOM → key extra
          break;
        case "g": if (editing) break; if (State.screen === "alerts") { alertToggleOp(); e.preventDefault(); } break;
        case "tab": if (!editing) { cyclePanel(); e.preventDefault(); } break;
        case "x": if (editing) break; if (State.screen === "pos") { resetStage(); e.preventDefault(); } break;
        case "f": if (editing) break; if (State.screen === "pos") { toggleStrategy(); e.preventDefault(); } break;
        case "escape":
          if (editing) { (ae as HTMLElement).blur(); e.preventDefault(); break; } // ESC first exits an editing field, not the screen
          if (State.screen !== "dash") { gotoScreen("dash"); }
          else { navigate("/"); } // dashboard is the terminal's root — ESC exits to the Animus (app convention)
          e.preventDefault(); break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") { rootRef.current?.classList.remove("tips"); }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    /* ---- ITEM 33 — snapshot on quit/hide ----
       Snapshots otherwise only land on the poller, so a session shorter than the
       interval records nothing. Capture ONE honest value point when the window is
       hidden or about to close, at the live account's confirmed total. Only when a
       real live account exists — recordSnapshot self-guards mock / gating (net
       deposits not yet known) / non-positive values, so we just void it and never
       await (a beforeunload handler must be fire-and-forget). It shares the
       minute-key dedupe with the poller, so a snapshot on hide immediately after a
       poll collapses to one row.
       NOTE: the beforeunload leg is BEST-EFFORT ONLY — the async invoke→SQLite
       chain often won't complete before the WKWebView dies on quit. The reliable
       leg is visibilitychange→hidden (macOS Cmd+Q typically hides first, and any
       app-switch/minimize before quitting records the point). */
    const snapshotIfLive = () => {
      const a = State.liveAccount;
      if (!a) return; // no real account (mock world / pre-first-sync) → nothing honest to record
      // ccy is string|null on the live account; recordSnapshot wants a string —
      // fall back to the account currency (never fabricate a value, only the label).
      void recordSnapshot(a.totalMinor, a.ccy || State.accountCcy);
    };
    const onVisibility = () => { if (document.hidden) snapshotIfLive(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", snapshotIfLive);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", snapshotIfLive);
      window.removeEventListener("resize", onResize);
      clearTimeout(rz);
      clearTimeout(shell.current.jitterTimer);
      shell.current.timers.forEach(clearTimeout);
      window.clearInterval(clockIv);
      unsubTick();
      unsubSync();
      DataEngine.stop();
      stopLive();
      setGotoScreenImpl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // clear the TAB focus ring whenever the screen changes (prototype showScreen did)
  useEffect(() => { clearPanelFocus(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [screenId]);

  if (!def) return <Navigate to="/dashboard" replace />;

  return (
    <div className="t77" ref={rootRef}>
      {/* CRT overlays (above everything, pointer-events none) — [S6+] amplified analog stack */}
      <div id="crtBend" /><div id="crtVig" /><div id="crtRoll" /><div id="crtScan" /><div id="crtGlass" /><div id="crtBezel" />

      {/* DESKTOP */}
      <div id="desk">
        {/* TOP BAR */}
        <div id="topbar">
          <div
            className="tb-logo"
            role="button"
            tabIndex={0}
            title="Return to Animus menu"
            onClick={() => navigate("/")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/"); } }}
          >◆ <b>MDN</b> // MARKET DISPATCH NETWORK</div>
          <div className="tb-ctrl"><span>^</span><span>⌄</span><span>×</span></div>
          <div className="tb-sess">OPERATOR: <b id="opName">STILLSHINING</b> · DESK 07</div>
        </div>

        {/* WORKSPACE */}
        <div id="work">
          {/* WINDOW */}
          <div id="window">
            <div id="winTitle"><span id="winName">{def.name}</span><span className="wid" id="winId">{def.wid}</span></div>
            <div id="screenWrap">
              <div id="screen" ref={screenRef}>
                {/* keyed by id: the SHELL persists; only the screen swaps under the power-off */}
                <def.Comp key={def.id} />
              </div>
              {/* CRT power-off fx layer (inside screenWrap so it covers the picture only) */}
              <div id="crtFx" ref={fxRef}><div id="crtFxWhite" ref={whiteRef} /><div id="crtFxDot" ref={dotRef} /></div>
            </div>
          </div>

          {/* DESKTOP ICONS (LEFT edge — glyph-only; native tooltip carries the filename) */}
          <div id="icons">
            {SCREENS.map((sc) => (
              <div
                key={sc.id}
                className={"dicon" + (sc.id === def.id ? " sel" : "")}
                data-screen={sc.id}
                title={sc.file}
                onClick={() => gotoScreen(sc.id)}
              >
                <div className="glyph" dangerouslySetInnerHTML={{ __html: GLYPHS[sc.icon] }} />
                <div className="lbl">{sc.file}</div>
              </div>
            ))}
          </div>
        </div>

        {/* TASKBAR */}
        <div id="taskbar">
          <span className="seg feed live" ref={tbFeedRef}>feed: <b>LIVE 12ms</b></span>
          {/* ITEM 13/14 — live SYNC chip. LIVE builds only (omitted under VITE_MOCK
              so the locked mock taskbar is unchanged byte-for-byte). Clickable +
              mirrors the Shift+R chord to force an immediate re-sync (SYNC NOW);
              its title documents the chord and the current-state grammar. */}
          {!IS_MOCK && (
            <span
              className="seg sync" ref={tbSyncRef} style={{ cursor: "pointer" }}
              title="SYNC NOW — click or press ⇧R to force an immediate account + history re-sync (LIVE·time = last synced · SYNCING… in flight · PARTIAL = deep deposit history blocked · ERR = failed)"
              onClick={syncNow}
            >sync: <b>—</b></span>
          )}
          <span className="seg" id="tbInput">input detected: <b>keyboard</b></span>
          <span className="seg mkt" ref={tbMktRef}>mkt: <b>—</b></span>
          <span className="seg" id="tbBatt">battery: <b>100% [plugged in]</b></span>
          <span
            className="seg" ref={tbVolRef} style={{ cursor: "pointer" }}
            onClick={() => { State.muted = !State.muted; updateTaskbar(); }}
          >vol: <b>30%</b></span>
          <span className="disc" ref={tbDiscRef}>SIMULATED · NOT INVESTMENT ADVICE</span>
          <span className="spacer" />
          <span className="seg clock mono" ref={tbClockRef}>--:--:--</span>
        </div>
      </div>
    </div>
  );
}
