// AnimusSettings.tsx — the Settings screen in the Animus PALE-VOID world.
//
// A FAITHFUL React port of the approved mockup's "SETTINGS SCREEN" section
// (scratchpad/animus-design/index.html): the pale void, the red strata PILLAR
// carrying a "⚙ SETTINGS" red chip, and a Configuration panel of animus chip
// controls, over the Animus breadcrumb + key-legend bar. It renders in the
// Animus world (NO Frame, NO BakedCrt) — its own fixed pale-void root, exactly
// like the "/" Animus route.
//
// Every control is wired to useSettingsPanel (the same hook the legacy cream
// Settings used); only the PRESENTATION is the Animus style. This screen follows
// the approved mockup's five groups, so it intentionally shows a leaner control
// set than the old panel (the minute-interval range beyond 5m and the display
// toggles return with the sync-engine step). Interactivity is LOCAL-STATE ONLY
// this sprint — the real Keychain write + live API probe are a later step — so
// the status captions stay honest ("staged locally", "not verified"), never a
// fabricated live connection. The station is READ-ONLY: it never trades.
//
// ESC (and the bar's BACK) dive back to the Animus menu ("/") through the SAME
// white-flash cover the menu leaves use (triggerFlash from ../../animus/flash),
// so Settings enters and leaves under the one shared transition.
//
// LAWS: animate only transform/opacity (no filter/blend/backdrop); the ONE red
// family; NO green — ever.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { triggerFlash } from "../../animus/flash";
import {
  useSettingsPanel,
  type SettingsPanelState,
  type SyncInterval,
} from "./useSettingsPanel";
import s from "./AnimusSettings.module.css";

/* The cog glyph — the same 15px stroke cog the mockup pins to the SETTINGS
   chip. Inline SVG (no asset), stroke inherits so it reads on the red chip. */
function Cog({ size = 15, stroke = "#f6f4f0" }: { size?: number; stroke?: string }) {
  return (
    <svg
      className={s.cog}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
  );
}

/* Mask a credential for the resting slot display — never render the raw key
   back to screen. Shows shape only: dots + last 4 (matches the mockup's
   "••••••••••••3f2a" treatment). */
function maskKey(key: string): string {
  const k = key.trim();
  if (k.length === 0) return "";
  if (k.length <= 4) return "•".repeat(k.length);
  const tail = k.slice(-4);
  return "•".repeat(Math.min(k.length - 4, 12)) + tail;
}

/* The mockup's Refresh chips are 15s / 30s / 60s / 5m. The hook's SyncInterval
   is minute-based (manual | 5 | 15 | 30 | 60). We surface the mockup labels but
   commit HONEST hook values: the three sub-minute chips stage as MANUAL (the
   1 req/s limit means sub-minute auto-refresh is not offered as a real
   schedule), and "5m" stages the real 5-minute interval. The active chip
   reflects the committed interval so the UI never lies about what was set. */
type RefreshChip = { label: string; interval: SyncInterval; disabled?: boolean };
// HONEST set: at 1 req/s only MANUAL and 5M are schedules the station can truly
// keep. The sub-minute chips are shown DISABLED (they'd assert a cadence the
// rate-limit can't honour), so the lit chip always names the interval that is
// actually committed — the UI never claims a schedule it didn't set.
const REFRESH_CHIPS: RefreshChip[] = [
  { label: "MANUAL", interval: "manual" },
  { label: "15s", interval: "manual", disabled: true },
  { label: "30s", interval: "manual", disabled: true },
  { label: "60s", interval: "manual", disabled: true },
  { label: "5m", interval: 5 },
];

/* Control groups, top→bottom, for ↑↓ keyboard focus. Enter/↵ acts on the
   focused group's PRIMARY control (edit the key field, or advance the toggle);
   mouse-click on any chip is always the primary path. */
const GROUP_IDS = ["key", "connection", "environment", "refresh", "datamode"] as const;
type GroupId = (typeof GROUP_IDS)[number];

function SettingsView({
  panel,
  keychainNote,
}: {
  panel: SettingsPanelState;
  keychainNote: string;
}) {
  const {
    keyInput,
    setKeyInput,
    keyStatus,
    dirty,
    saveKey,
    savedKey,
    env,
    setEnv,
    interval,
    setInterval,
  } = panel;

  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;

  // Dive back to the Animus menu under the shared white flash — the same
  // mechanism the menu's leaves use (triggerFlash → cover → navigate → fade).
  const diveBack = useCallback(() => {
    triggerFlash((r) => navRef.current(r), "/");
  }, []);

  // Reveal-while-editing: the resting slot shows the masked shape; focusing the
  // field reveals the raw text to edit. Local UI state only.
  const [revealed, setRevealed] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);

  // Keyboard focus across control groups (↑↓). Mouse remains the priority path;
  // this is the "↑↓ NAVIGATE / ↵ EDIT / ESC BACK" legend, kept simple.
  const [focusIdx, setFocusIdx] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing while the key field is focused (except Escape).
      const editingKey = document.activeElement === keyRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        if (editingKey) keyRef.current?.blur();
        else diveBack();
        return;
      }
      if (editingKey) return;
      // If a real control (button/input) holds focus, let IT handle Enter/Space
      // natively — never re-route the activation to the group-focus target.
      const ae = document.activeElement;
      if (
        (e.key === "Enter" || e.key === " ") &&
        ae instanceof HTMLElement &&
        (ae.tagName === "BUTTON" || ae.tagName === "INPUT")
      )
        return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => (i + 1) % GROUP_IDS.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => (i - 1 + GROUP_IDS.length) % GROUP_IDS.length);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const g: GroupId = GROUP_IDS[focusIdx];
        if (g === "key") {
          keyRef.current?.focus();
        } else if (g === "connection") {
          // Reconnect is an honest no-op this sprint (needs the deferred probe).
        } else if (g === "environment" || g === "datamode") {
          setEnv(env === "live" ? "demo" : "live");
        } else if (g === "refresh") {
          // cycle only the ENABLED intervals (manual ⇄ 5m)
          const order: SyncInterval[] = ["manual", 5];
          const cur = order.indexOf(interval as SyncInterval);
          setInterval(order[(cur + 1) % order.length]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusIdx, env, interval, setEnv, setInterval, diveBack]);

  const grpCls = (g: GroupId) =>
    `${s.grp} ${GROUP_IDS[focusIdx] === g ? s.grpFocus : ""}`;

  // Honest key-slot status word + tone. Never claims a live/verified key.
  const stored = keyStatus === "saved-local";
  const staged = keyStatus === "staged";
  const keyStatusWord = stored ? "Staged locally" : staged ? "Key staged" : "Slot empty";

  // The lit chip is the ENABLED chip whose committed interval matches — MANUAL for
  // manual, 5m for the 5-minute schedule. Disabled sub-minute chips never light.
  const activeRefreshLabel =
    REFRESH_CHIPS.find((c) => !c.disabled && c.interval === interval)?.label ?? "MANUAL";

  return (
    <div className={s.root} role="region" aria-label="Settings — Animus configuration">
      <div className={s.strataBg} />
      <div className={s.hint}>ACTUALITY — ANIMUS INTERFACE</div>
      <div className={s.wnd}>SYSTEM · CONFIG · 0x01</div>

      {/* red strata pillar — its own tower, carrying the SETTINGS chip */}
      <div className={s.pillarStage}>
        <div className={s.pillar}>
          <div className={s.waf} />
          <div className={s.waf} />
          <div className={`${s.waf} ${s.wafSel}`} />
          <div className={s.waf} />
          <div className={s.waf} />
          <div className={s.waf} />
          <div className={s.waf} />
          <div className={s.waf} />
          <div className={s.waf} />
          <div className={s.waf} />
          <div className={s.waf} />
          <div className={s.waf} />
        </div>
        <div className={s.pillarTag}>
          <Cog />
          SETTINGS
        </div>
      </div>

      {/* the configuration panel */}
      <div className={s.panel}>
        <div className={s.panelHead}>
          <h1>Configuration</h1>
          <span className={s.sub}>System · Actuality</span>
        </div>
        <div className={s.rule} />

        {/* (1) TRADING 212 KEY */}
        <div className={grpCls("key")}>
          <div className={s.lab}>
            <div className={s.t}>Trading 212 Key</div>
            <div className={s.d}>
              Your API credential — bound for the macOS Keychain, never written to disk.
            </div>
          </div>
          <div className={s.ctl}>
            <div className={s.field}>
              {revealed || !savedKey ? (
                <input
                  ref={keyRef}
                  className={s.keyInput}
                  type={revealed ? "text" : "password"}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="paste key to seat it…"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onFocus={() => setRevealed(true)}
                  onBlur={() => setRevealed(false)}
                  aria-label="Trading 212 API key"
                />
              ) : (
                <button
                  type="button"
                  className={s.val}
                  style={{ background: "transparent", border: 0, cursor: "text", font: "inherit" }}
                  onClick={() => {
                    setRevealed(true);
                    // focus after the input mounts
                    requestAnimationFrame(() => keyRef.current?.focus());
                  }}
                  aria-label="Edit Trading 212 API key"
                >
                  <span className={s.val}>{maskKey(dirty ? keyInput : savedKey ?? "")}</span>
                </button>
              )}
            </div>
            <button
              type="button"
              className={`${s.chip} ${dirty ? s.on : ""}`}
              onClick={saveKey}
              disabled={!dirty}
              title={!dirty ? "Nothing to save — key already staged locally" : "Stage this key locally"}
            >
              Save
            </button>
            <span className={`${s.status} ${stored ? s.stored : s.pending}`}>
              <i className={s.dot} />
              {keyStatusWord}
            </span>
          </div>
        </div>

        {/* (2) CONNECTION — honest pending state (no real probe this sprint) */}
        <div className={grpCls("connection")}>
          <div className={s.lab}>
            <div className={s.t}>Connection</div>
            <div className={s.d}>Live link to your account through the app backend.</div>
          </div>
          <div className={s.ctl}>
            <span className={`${s.status} ${s.pending}`}>
              <i className={s.dot} />
              Not verified · check pending
            </span>
            <button
              type="button"
              className={s.chip}
              disabled
              title="Wired with the sync engine — needs the deferred Keychain read + API probe"
            >
              Reconnect
            </button>
          </div>
        </div>

        {/* (3) ENVIRONMENT */}
        <div className={grpCls("environment")}>
          <div className={s.lab}>
            <div className={s.t}>Environment</div>
            <div className={s.d}>Which Trading 212 account the station reads.</div>
          </div>
          <div className={s.ctl}>
            <button
              type="button"
              className={`${s.chip} ${env === "demo" ? s.on : ""}`}
              aria-pressed={env === "demo"}
              onClick={() => setEnv("demo")}
            >
              Demo
            </button>
            <button
              type="button"
              className={`${s.chip} ${env === "live" ? s.on : ""}`}
              aria-pressed={env === "live"}
              onClick={() => setEnv("live")}
            >
              Live
            </button>
          </div>
        </div>

        {/* (4) REFRESH */}
        <div className={grpCls("refresh")}>
          <div className={s.lab}>
            <div className={s.t}>Refresh</div>
            <div className={s.d}>How often the station re-syncs while open.</div>
          </div>
          <div className={s.ctl}>
            {REFRESH_CHIPS.map((c) => {
              const lit = !c.disabled && c.label === activeRefreshLabel;
              return (
                <button
                  key={c.label}
                  type="button"
                  className={`${s.chip} ${lit ? s.on : ""}`}
                  aria-pressed={lit}
                  disabled={c.disabled}
                  style={c.disabled ? { opacity: 0.4, cursor: "default" } : undefined}
                  onClick={c.disabled ? undefined : () => setInterval(c.interval)}
                  title={
                    c.disabled
                      ? "Sub-minute auto-refresh isn't offered — the 1 req/s limit can't keep it"
                      : c.interval === "manual"
                        ? "Re-sync only when you ask (no auto-refresh)"
                        : "Every 5 minutes while open (staged locally)"
                  }
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* (5) DATA MODE — Live account vs the seeded demo model. Same truth as
            Environment (env), mirrored here exactly as the mockup captions it. */}
        <div className={grpCls("datamode")}>
          <div className={s.lab}>
            <div className={s.t}>Data Mode</div>
            <div className={s.d}>Live account, or the seeded demo model.</div>
          </div>
          <div className={s.ctl}>
            <button
              type="button"
              className={`${s.chip} ${env === "live" ? s.on : ""}`}
              aria-pressed={env === "live"}
              onClick={() => setEnv("live")}
            >
              Live
            </button>
            <button
              type="button"
              className={`${s.chip} ${env === "demo" ? s.on : ""}`}
              aria-pressed={env === "demo"}
              onClick={() => setEnv("demo")}
            >
              Model
            </button>
            <span className={s.note}>
              — read-only · the station never places trades or moves money
            </span>
          </div>
        </div>

        {/* honest framing of the whole panel's local-state-only behaviour */}
        <p className={s.note} style={{ marginTop: 14 }}>
          {keychainNote}
        </p>
      </div>

      {/* Animus breadcrumb + key legend bar. BACK dives to the menu. */}
      <div className={s.bar}>
        <button type="button" className={s.crumb} onClick={diveBack} aria-label="Back to the Animus menu">
          <span className={s.dia} />
          <span>ANIMUS · ACTUALITY · SETTINGS</span>
        </button>
        <div className={s.sp} />
        <div className={s.legend}>
          <span>
            <span className={s.key}>↑↓</span>NAVIGATE
          </span>
          <span>
            <span className={s.key}>↵</span>EDIT
          </span>
          <span>
            <span className={s.key}>ESC</span>BACK
          </span>
        </div>
      </div>
    </div>
  );
}

/* Live container — honest real-world baseline. Does NOT read the Keychain or
   probe the API this sprint (deferred), so it seeds an empty slot and reports a
   plainly-pending state; SAVE stages locally until the Keychain + sync wiring
   lands. */
function LiveSettings() {
  const panel = useSettingsPanel({ env: "demo", accountLabel: "DEFAULT" });
  const keychainNote =
    "Changes here are staged locally for now — writing the key to the macOS Keychain and verifying a live connection arrive with the sync-engine wiring, so nothing you type is stored to disk this build.";
  return <SettingsView panel={panel} keychainNote={keychainNote} />;
}

/* Mock container — placeholder panel for design iteration (VITE_MOCK builds).
   Seeds an INVENTED demo key so the "seated" slot renders; the note labels it
   sample state, never a real stored/verified credential. Never touches the
   Keychain/API. */
function MockSettings() {
  const panel = useSettingsPanel({
    savedKey: "T212DEMoxxxxxxxxxxxx3f2a",
    env: "demo",
    accountLabel: "DEMO-01",
    interval: 5,
  });
  const keychainNote =
    "DEMO placeholder — no real credential is stored or verified, and the station is read-only (it never places trades or moves money). Sample UI state for design.";
  return <SettingsView panel={panel} keychainNote={keychainNote} />;
}

/* Build-time switch: VITE_MOCK => placeholder (no Keychain); else live. The
   unused branch is tree-shaken (VITE_MOCK is a compile-time constant). */
export default function AnimusSettings() {
  return import.meta.env.VITE_MOCK ? <MockSettings /> : <LiveSettings />;
}
