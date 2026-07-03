import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import styles from "./Chrome.module.css";

/** Flat top-nav destinations for hopping between DATA SCREENS without diving
 * back through the Animus. ANIMUS returns to the 3D menu at "/"; the seven
 * screens each go to their route (the menu now lives at "/", so DASHBOARD is
 * "/dashboard"). This row renders ONLY on data screens — Chrome never wraps the
 * menu route. Restored in Phase 3c (removed in 3a while the Animus was built). */
const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: "/", label: "Animus", end: true },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/positions", label: "Positions" },
  { to: "/watchlist", label: "Watchlist" },
  { to: "/performance", label: "Performance" },
  { to: "/compare", label: "Compare" },
  { to: "/journal", label: "Journal" },
  { to: "/settings", label: "Settings" },
];

export type ConnectionState = "ok" | "error" | "loading" | "no-key";

export interface ChromeProps {
  /** Screen title shown in the wordmark row context, e.g. "DASHBOARD". */
  title: string;
  /** Environment label, e.g. "DEMO" | "LIVE" (drives the pill). */
  env: "demo" | "live";
  accountLabel: string;
  connection: ConnectionState;
  /** ISO timestamp of the last successful sync, or null if never synced. */
  lastSyncISO: string | null;
  /** Open-positions count, or null when the screen doesn't know it (renders "—"). */
  positionsCount: number | null;
  rateLimitNote: string;
  /** The screen body — rendered between the top bar and the bottom status bar. */
  children: ReactNode;
}

/** SYNC telemetry word derived from connection state — mono, peripheral. */
const SYNC_WORD: Record<ConnectionState, string> = {
  ok: "SYNC OK",
  error: "SYNC FAIL",
  loading: "SYNC…",
  "no-key": "SYNC IDLE",
};

const CONNECTION_COPY: Record<ConnectionState, { word: string; dot: string; cls: string }> = {
  ok: { word: "CONNECTED", dot: "●", cls: styles.connOk },
  error: { word: "OFFLINE", dot: "▲", cls: styles.connError },
  loading: { word: "SYNCING", dot: "●", cls: styles.connLoading },
  "no-key": { word: "NO KEY", dot: "●", cls: styles.connNoKey },
};

/** Humanize an ISO timestamp into a short relative-ish mono string. */
function humanizeSync(iso: string | null): string {
  if (!iso) return "NEVER";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "NEVER";
  const diffMs = Date.now() - then;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 5) return "JUST NOW";
  if (diffSec < 60) return `${diffSec}S AGO`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}M AGO`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}H AGO`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}D AGO`;
}

function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Chrome — presentational shell frame for a screen: top wordmark + telemetry
 * ticker, bottom persistent status bar. All mono, low-contrast, peripheral
 * (§ chrome weight in the actuality-ui skill). Data wiring lives in the
 * screen that renders this (e.g. Dashboard) — Chrome itself holds no state
 * beyond the live clock, which updates via textContent only (never triggers
 * a React re-render / layout animation).
 */
export default function Chrome({
  title,
  env,
  accountLabel,
  connection,
  lastSyncISO,
  positionsCount,
  rateLimitNote,
  children,
}: ChromeProps) {
  const clockRef = useRef<HTMLSpanElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const tick = () => {
      if (clockRef.current) {
        clockRef.current.textContent = formatClock(new Date());
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // RETURN-TO-ANIMUS: Esc surfaces the user back to the 3D menu from any screen
  // (the consistent control the brief mandates — this Chrome wraps every
  // screen, so wiring it here covers all seven). The visible affordance is the
  // wordmark + "◄ ANIMUS" button below.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Yield to an already-consumed Esc (an open detail modal handles it
        // first, on document, and marks it defaultPrevented) so dismissing a
        // modal doesn't also yank the user out to the Animus menu.
        if (e.defaultPrevented) return;
        // Esc while typing (e.g. the Settings API-key field) means "cancel this
        // edit", NOT "leave the screen" — blur the field and stay put, so an
        // in-progress key entry is never discarded + the user ejected.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
          t.blur();
          return;
        }
        e.preventDefault();
        navigate("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const toAnimus = () => navigate("/");

  const conn = CONNECTION_COPY[connection];

  return (
    <div className={styles.chrome}>
      <div className={styles.topBar}>
        <div className={styles.wordmarkRow}>
          {/* RETURN-TO-ANIMUS affordance — the wordmark is a button back to the
              3D menu ("/"); Esc does the same. Consistent on every screen. */}
          <button
            type="button"
            className={styles.animusBtn}
            onClick={toAnimus}
            title="Return to the Animus menu (Esc)"
          >
            <span className={styles.animusArrow} aria-hidden="true">
              &#9668;
            </span>
            <span className={styles.wordmark}>Actuality</span>
          </button>
          <span className={styles.sdnTag}>&middot;SDN</span>
          <span className={styles.sdnTag}>{title}</span>
        </div>
        <div className={styles.ticker}>
          <span className={styles.tickerItem}>
            <span className={styles.tickerLabel}>BASE</span>
            <span className={styles.tickerValue}>GBP</span>
          </span>
          <span className={styles.tickerItem}>
            <span className={styles.tickerLabel}>MARKET</span>
            <span className={styles.tickerValue}>&mdash;</span>
          </span>
          <span className={styles.tickerItem}>
            <span className={styles.tickerLabel}>POS</span>
            <span className={styles.tickerValue}>{positionsCount ?? "—"}</span>
          </span>
          <span className={styles.tickerItem}>
            <span className={styles.tickerLabel}>ACCT</span>
            <span className={styles.tickerValue}>{accountLabel}</span>
          </span>
          <span className={`${styles.tickerItem} ${styles.tickerSync} ${conn.cls}`}>
            <span className={styles.tickerGlyph} aria-hidden="true">
              {conn.dot}
            </span>
            <span className={styles.tickerValue}>{SYNC_WORD[connection]}</span>
          </span>
          <span className={styles.tickerItem}>
            <span ref={clockRef} className={styles.clock}>
              00:00:00
            </span>
          </span>
        </div>
      </div>

      {/* Flat screen nav — hop between data screens without re-diving through
          the Animus. flex:0 0 auto like topBar/statusBar so it does NOT break
          the viewport-lock height chain (topBar → nav → chromeBody(flex:1) →
          statusBar, SCREEN_PATTERNS.md §2). */}
      <nav className={styles.nav} aria-label="Screens">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className={styles.chromeBody}>{children}</div>

      <div className={styles.statusBar}>
        <div className={styles.statusGroup}>
          <span className={styles.statusItem}>
            LAST SYNC <b>{humanizeSync(lastSyncISO)}</b>
          </span>
          <span className={styles.statusSep} aria-hidden="true">
            /
          </span>
          <span className={styles.statusItem}>
            RATE-LIMIT <b>{rateLimitNote}</b>
          </span>
          <span className={styles.statusSep} aria-hidden="true">
            /
          </span>
          <span className={styles.statusItem}>
            ACCT <b>{accountLabel}</b>
          </span>
        </div>
        <div className={styles.statusGroup} style={{ flex: "0 0 auto" }}>
          <span className={`${styles.pill} ${env === "live" ? styles.pillLive : styles.pillDemo}`}>
            {env === "live" ? "LIVE" : "DEMO"}
          </span>
          <span className={styles.statusSep} aria-hidden="true">
            /
          </span>
          <span className={`${styles.connection} ${conn.cls}`}>
            <span className={styles.dot}>{conn.dot}</span>
            {conn.word}
          </span>
        </div>
      </div>
    </div>
  );
}
