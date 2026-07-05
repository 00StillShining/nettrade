// AnimusSettings.tsx — the Settings screen in the Animus PALE-VOID world.
//
// A FAITHFUL React port of the approved mockup's "SETTINGS SCREEN" section
// (scratchpad/animus-design/index.html): the pale void, the red strata PILLAR
// carrying a "⚙ SETTINGS" red chip, and a Configuration panel of animus chip
// controls, over the Animus breadcrumb + key-legend bar. It renders in the
// Animus world (NO Frame, NO BakedCrt) — its own fixed pale-void root, exactly
// like the "/" Animus route.
//
// PHASE 1 — the CREDENTIAL FOUNDATION is now LIVE. The panel is a real DUAL-KEY
// vault (useAnimusVault): SAVE writes the secret to the macOS Keychain for real,
// and TEST performs a live connection probe:
//   • SLOT A — Trading 212 Key → keychain_set_credentials + trading212
//     testConnection().
//   • SLOT B — Market Data Key (FMP) → keychain_set_marketdata_key + fmpTestKey().
// The CONNECTION group reflects the REAL combined state. Env/interval/display
// prefs still come from useSettingsPanel (local-state — those are UI prefs, not
// secrets). Under VITE_MOCK the vault runs against an in-memory stub (no
// Keychain, no network) so design builds render without a password prompt, and
// its statuses are labelled sample state — never a fabricated live connection in
// a real build. Masked slots show ONLY the committed key's tail; the raw key is
// never rendered back or logged. The station is READ-ONLY: it never trades.
//
// ESC (and the bar's BACK) dive back to the Animus menu ("/") through the SAME
// white-flash cover the menu leaves use (triggerFlash from ../../animus/flash).
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
import { useAnimusVault, type AnimusVault, type VaultSlot } from "./useAnimusVault";
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

/* The mockup's Refresh chips are 15s / 30s / 60s / 5m. The hook's SyncInterval
   is minute-based (manual | 5 | 15 | 30 | 60). We surface the mockup labels but
   commit HONEST hook values: the sub-minute chips are shown DISABLED (the
   1 req/s limit can't keep a sub-minute schedule), and "5m" stages the real
   5-minute interval. The lit chip always names the interval actually committed. */
type RefreshChip = { label: string; interval: SyncInterval; disabled?: boolean };
const REFRESH_CHIPS: RefreshChip[] = [
  { label: "MANUAL", interval: "manual" },
  { label: "15s", interval: "manual", disabled: true },
  { label: "30s", interval: "manual", disabled: true },
  { label: "60s", interval: "manual", disabled: true },
  { label: "5m", interval: 5 },
];

/* Control groups, top→bottom, for ↑↓ keyboard focus. */
const GROUP_IDS = ["t212", "marketdata", "connection", "environment", "refresh", "datamode"] as const;
type GroupId = (typeof GROUP_IDS)[number];

/* Map a slot's honest probe state to a status word + whether it's a "good" tone
   (drives the red vs. muted dot — red only when a claim is real). */
function slotStatusWord(slot: VaultSlot): { word: string; good: boolean } {
  switch (slot.probe) {
    case "connected":
      return { word: slot.note || "Verified", good: true };
    case "checking":
      return { word: "Probing…", good: false };
    case "bad-key":
      return { word: "Bad key", good: false };
    case "rate-limited":
      return { word: "Rate-limited", good: false };
    case "unreachable":
      return { word: "Unreachable", good: false };
    case "no-key":
      return { word: "No key", good: false };
    case "error":
      return { word: "Probe error", good: false };
    default:
      // idle — reflect seat state honestly
      if (slot.seat === "seated") return { word: "Seated · not verified", good: false };
      return { word: "Slot empty", good: false };
  }
}

/* One credential slot — reused for BOTH Trading 212 and Market Data (FMP). Same
   Animus markup as the original single slot: a masked field that reveals to edit,
   SAVE (real Keychain write), TEST (real probe), CLEAR, and an honest status. */
function CredentialSlot({
  slot,
  title,
  desc,
  placeholder,
  ariaLabel,
  focused,
  registerFieldRef,
}: {
  slot: VaultSlot;
  title: string;
  desc: string;
  placeholder: string;
  ariaLabel: string;
  focused: boolean;
  registerFieldRef?: (el: HTMLInputElement | null) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const seated = slot.seat === "seated";
  const showInput = revealed || (!seated && slot.input.length === 0) || slot.input.length > 0;
  const { word, good } = slotStatusWord(slot);

  return (
    <div className={`${s.grp} ${focused ? s.grpFocus : ""}`}>
      <div className={s.lab}>
        <div className={s.t}>{title}</div>
        <div className={s.d}>{desc}</div>
      </div>
      <div className={s.ctl}>
        <div className={s.field}>
          {showInput ? (
            <input
              ref={(el) => {
                inputRef.current = el;
                registerFieldRef?.(el);
              }}
              className={s.keyInput}
              type={revealed ? "text" : "password"}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={seated ? "paste to replace the seated key…" : placeholder}
              value={slot.input}
              onChange={(e) => slot.setInput(e.target.value)}
              onFocus={() => setRevealed(true)}
              onBlur={() => setRevealed(false)}
              aria-label={ariaLabel}
            />
          ) : (
            <button
              type="button"
              className={s.val}
              style={{ background: "transparent", border: 0, cursor: "text", font: "inherit" }}
              onClick={() => {
                setRevealed(true);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              aria-label={`Edit ${ariaLabel}`}
            >
              <span className={s.val}>{slot.maskedTail || "— no key —"}</span>
            </button>
          )}
        </div>

        <button
          type="button"
          className={`${s.chip} ${slot.dirty ? s.on : ""}`}
          onClick={() => void slot.save()}
          disabled={!slot.dirty || slot.saving}
          title={
            slot.dirty ? "Write this key to the macOS Keychain" : "Type a key to enable Save"
          }
        >
          {slot.saving ? "Saving…" : "Save"}
        </button>

        <button
          type="button"
          className={s.chip}
          onClick={() => void slot.test()}
          disabled={!seated || slot.probe === "checking"}
          title={
            seated
              ? "Probe the seated key for a live connection"
              : "Seat a key first, then test the connection"
          }
        >
          Test
        </button>

        {seated && (
          <button
            type="button"
            className={s.chip}
            onClick={() => void slot.clear()}
            title="Remove the seated key from the Keychain"
          >
            Clear
          </button>
        )}

        <span className={`${s.status} ${good ? s.stored : s.pending}`}>
          <i className={s.dot} />
          {word}
        </span>
      </div>
    </div>
  );
}

function SettingsView({
  panel,
  vault,
  keychainNote,
}: {
  panel: SettingsPanelState;
  vault: AnimusVault;
  keychainNote: string;
}) {
  const { env, setEnv, interval, setInterval } = panel;

  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;

  const diveBack = useCallback(() => {
    triggerFlash((r) => navRef.current(r), "/");
  }, []);

  // Keyboard focus across control groups (↑↓). Mouse remains the priority path.
  const [focusIdx, setFocusIdx] = useState(0);
  const t212FieldRef = useRef<HTMLInputElement | null>(null);
  const fmpFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement;
      const editingKey = ae === t212FieldRef.current || ae === fmpFieldRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        if (editingKey && ae instanceof HTMLElement) ae.blur();
        else diveBack();
        return;
      }
      if (editingKey) return;
      // Let a focused real control handle Enter/Space natively.
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
        if (g === "t212") {
          t212FieldRef.current?.focus();
        } else if (g === "marketdata") {
          fmpFieldRef.current?.focus();
        } else if (g === "connection") {
          // Re-test the required Trading 212 link (the honest "Reconnect").
          void vault.t212.test();
        } else if (g === "environment" || g === "datamode") {
          setEnv(env === "live" ? "demo" : "live");
        } else if (g === "refresh") {
          const order: SyncInterval[] = ["manual", 5];
          const cur = order.indexOf(interval as SyncInterval);
          setInterval(order[(cur + 1) % order.length]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusIdx, env, interval, setEnv, setInterval, diveBack, vault.t212]);

  const grpCls = (g: GroupId) => `${s.grp} ${GROUP_IDS[focusIdx] === g ? s.grpFocus : ""}`;

  const activeRefreshLabel =
    REFRESH_CHIPS.find((c) => !c.disabled && c.interval === interval)?.label ?? "MANUAL";

  const { combined } = vault;
  const combinedGood = combined.tone === "connected";

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

        {/* (1) TRADING 212 KEY — the required broker link */}
        <CredentialSlot
          slot={vault.t212}
          title="Trading 212 Key"
          desc="Your broker API credential — bound for the macOS Keychain, never written to disk."
          placeholder="paste key to seat it…"
          ariaLabel="Trading 212 API key"
          focused={GROUP_IDS[focusIdx] === "t212"}
          registerFieldRef={(el) => (t212FieldRef.current = el)}
        />

        {/* (2) MARKET DATA KEY (FMP) — optional enrichment */}
        <CredentialSlot
          slot={vault.fmp}
          title="Market Data Key"
          desc="Financial Modeling Prep (FMP) key — powers quotes, calendars & fundamentals. Optional."
          placeholder="paste FMP key to seat it…"
          ariaLabel="Market data (FMP) API key"
          focused={GROUP_IDS[focusIdx] === "marketdata"}
          registerFieldRef={(el) => (fmpFieldRef.current = el)}
        />

        {/* (3) CONNECTION — the REAL combined state */}
        <div className={grpCls("connection")}>
          <div className={s.lab}>
            <div className={s.t}>Connection</div>
            <div className={s.d}>Live link to your data through the app backend.</div>
          </div>
          <div className={s.ctl}>
            <span className={`${s.status} ${combinedGood ? s.stored : s.pending}`}>
              <i className={s.dot} />
              {combined.label} · {combined.detail}
            </span>
            <button
              type="button"
              className={s.chip}
              onClick={() => void vault.t212.test()}
              disabled={vault.t212.seat !== "seated" || vault.t212.probe === "checking"}
              title="Re-probe the Trading 212 link"
            >
              Reconnect
            </button>
          </div>
        </div>

        {/* (4) ENVIRONMENT */}
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

        {/* (5) REFRESH */}
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

        {/* (6) DATA MODE — Live account vs the seeded demo model. */}
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

        {/* honest framing of the whole panel's behaviour */}
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

/* Live container — the REAL vault. Reads seat state from the Keychain on mount;
   SAVE writes to the Keychain; TEST probes the live providers. */
function LiveSettings() {
  const panel = useSettingsPanel({ env: "demo", accountLabel: "DEFAULT" });
  const vault = useAnimusVault(panel.env, "default");
  const keychainNote =
    "Keys you Save here are written to the macOS Keychain (never to disk or logs); Test performs a live handshake and the status above reflects the real result. The station is read-only — it never places trades or moves money.";
  return <SettingsView panel={panel} vault={vault} keychainNote={keychainNote} />;
}

/* Mock container — placeholder panel for design iteration (VITE_MOCK builds).
   The vault runs against an in-memory stub (no Keychain, no network); statuses
   are labelled sample state, never a real stored/verified credential. */
function MockSettings() {
  const panel = useSettingsPanel({ env: "demo", accountLabel: "DEMO-01", interval: 5 });
  const vault = useAnimusVault(panel.env, "default");
  const keychainNote =
    "DEMO placeholder — no real credential is stored or verified, and the station is read-only (it never places trades or moves money). Sample UI state for design.";
  return <SettingsView panel={panel} vault={vault} keychainNote={keychainNote} />;
}

/* Build-time switch: VITE_MOCK => placeholder (no Keychain); else live. The
   unused branch is tree-shaken (VITE_MOCK is a compile-time constant). */
export default function AnimusSettings() {
  return import.meta.env.VITE_MOCK ? <MockSettings /> : <LiveSettings />;
}
