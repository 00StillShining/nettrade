import { useState } from "react";
import Chrome from "../../shell/Chrome";
import {
  useSettingsPanel,
  SYNC_INTERVALS,
  type SettingsPanelState,
  type SyncInterval,
} from "./useSettingsPanel";
import s from "./Settings.module.css";

/**
 * Settings — the SDN "control-panel dossier" (VISUAL_DIRECTION.md §5
 * "Settings"; SCREEN_PATTERNS.md §7 the LOCKED cream-paper recipe). Function
 * first (actuality-ui skill §1-2): answers ONE question — "how does Actuality
 * connect and behave, and how do I change it?" — as grouped labelled rows of
 * a physical instrument's control panel: a credential SLOT (masked key +
 * honest keychain status + amber SAVE/RECONNECT), the account demo/live
 * indicator, a sync-interval selector, and display toggles. All controls use
 * the beveled keycap-button / keycap-toggle language (obvious pressable
 * affordances, amber = active), mirroring Performance's period keycaps.
 *
 * INTERACTIVITY IS LOCAL-STATE ONLY this sprint (see useSettingsPanel.ts):
 * toggles flip, the field edits, active states move, SAVE commits to local
 * state — but the real Keychain write/read + preference persistence are the
 * LIVE step (deferred, noted in the hook + at the actions). Honest data: in
 * MOCK the connection/keychain status is a clearly-labelled DEMO/placeholder
 * state, NEVER a fabricated "Connected"; the Live container shows an honest
 * pending state because verifying a real connection needs the deferred
 * Keychain read + API probe.
 */

/** Mask a credential for display — never render the raw key back to screen
 * (it would be shoulder-surfable and, once real, is a secret). Shows the
 * shape only: first 2 + last 2 chars, middle as dots. */
function maskKey(key: string): string {
  const k = key.trim();
  if (k.length === 0) return "";
  if (k.length <= 5) return "•".repeat(k.length);
  return `${k.slice(0, 2)}${"•".repeat(Math.min(k.length - 4, 18))}${k.slice(-2)}`;
}

/** One labelled control-panel row: bold display label + description on the
 * left, the control on the right. The grammar every group repeats. */
function ControlRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        <span className={s.rowLabel}>{label}</span>
        {hint && <span className={s.rowHint}>{hint}</span>}
      </div>
      <div className={s.rowControl}>{children}</div>
    </div>
  );
}

/** A beveled keycap toggle — the "LSHIFT/ENTER" keycap language as an
 * on/off switch. Pressed/active = amber. Reads state by sign + label + colour
 * (ON/OFF text), never colour alone. */
function KeycapToggle({
  on,
  onToggle,
  ariaLabel,
}: {
  on: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      className={`${s.keycap} ${s.keycapToggle} ${on ? s.keycapActive : ""}`}
      onClick={onToggle}
    >
      {on ? "ON" : "OFF"}
    </button>
  );
}

/** A group of keycap buttons acting as a single-select (env, interval). */
function KeycapGroup<T extends string | number>({
  options,
  value,
  onChange,
  render,
  ariaLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => string;
  ariaLabel: string;
}) {
  return (
    <div className={s.keycapRow} role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          className={`${s.keycap} ${opt === value ? s.keycapActive : ""}`}
          aria-pressed={opt === value}
          onClick={() => onChange(opt)}
        >
          {render(opt)}
        </button>
      ))}
    </div>
  );
}

function intervalLabel(i: SyncInterval): string {
  return i === "manual" ? "MANUAL" : `${i}M`;
}

/** The presentational panel. `keychainNote` is the HONEST status caption for
 * the credential slot — supplied by the container so Mock/Live differ without
 * this view ever inventing a connection state. */
function SettingsView({
  panel,
  keychainNote,
  connection,
  lastSyncISO,
}: {
  panel: SettingsPanelState;
  keychainNote: string;
  connection: "ok" | "loading" | "no-key" | "error";
  lastSyncISO: string | null;
}) {
  const {
    keyInput,
    setKeyInput,
    keyStatus,
    dirty,
    saveKey,
    clearKey,
    env,
    setEnv,
    accountLabel,
    interval,
    setInterval,
    crtCurve,
    toggleCrtCurve,
    reduceMotion,
    toggleReduceMotion,
    compactFigures,
    toggleCompactFigures,
  } = panel;

  // Reveal-while-editing: focus the raw field to edit, but the resting
  // display is masked (the credential-slot metaphor — the card is "seated"
  // and only its shape shows). Local UI state, no bearing on persistence.
  const [revealed, setRevealed] = useState(false);

  const statusTone =
    keyStatus === "saved-local" ? s.statusStaged : keyStatus === "staged" ? s.statusStaged : s.statusEmpty;
  const statusWord =
    keyStatus === "saved-local" ? "KEY SEATED · LOCAL" : keyStatus === "staged" ? "KEY STAGED" : "SLOT EMPTY";

  return (
    <Chrome
      title="SETTINGS"
      env={env}
      accountLabel={accountLabel}
      connection={connection}
      lastSyncISO={lastSyncISO}
      positionsCount={null}
      rateLimitNote="1 req/s"
    >
      <div className={s.screen}>
        {/* ============================== HERO — the one purpose ============================== */}
        <section className={s.hero} aria-label="Control panel">
          <div className={s.heroRibbon}>
            <span>Control Panel</span>
            <span className={s.heroScope}>Local</span>
          </div>
          <div className={s.heroTop}>
            <div>
              <div className={s.heroLabel}>Manage how Actuality connects &amp; behaves</div>
              <p className={s.heroNote}>
                Slot your Trading&nbsp;212 credential, pick demo or live, set how often Actuality re-reads your
                account, and tune the display. Changes here are staged locally for now — writing the key to the
                macOS Keychain, applying the display switches and persisting your preferences arrive with the
                sync-engine wiring, so nothing you type is stored to disk this build.
              </p>
            </div>
          </div>
        </section>

        {/* ============================== CONTROL GROUPS ============================== */}
        <div className={s.groups}>
          {/* -------- (1) TRADING 212 KEY — the credential slot -------- */}
          <section className={s.panel} aria-label="Trading 212 credential">
            <div className={`${s.panelHead} ${s.headAmber}`}>Trading 212 Key</div>
            <div className={s.panelBody}>
              {/* The slot: framed as seating a credential card into the device. */}
              <div className={s.slot}>
                <div className={s.slotRail} aria-hidden="true" />
                <div className={s.slotField}>
                  <span className={s.slotLabel}>API Key</span>
                  <input
                    className={`${s.keyInput} ${!revealed && keyInput.trim() ? s.keyInputMasked : ""}`}
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
                  {/* Resting masked shape — shown only when not focused and a
                      value exists, so the seated card reads as present without
                      exposing the secret. */}
                  {!revealed && keyInput.trim().length > 0 && (
                    <span className={s.keyMask} aria-hidden="true">
                      {maskKey(keyInput)}
                    </span>
                  )}
                </div>
              </div>

              {/* Honest keychain / connection status — never a fake "Connected". */}
              <div className={s.slotStatusRow}>
                <span className={`${s.statusChip} ${statusTone}`}>
                  <span className={s.statusDot} aria-hidden="true">
                    ▪
                  </span>
                  {statusWord}
                </span>
                <span className={s.keychainNote}>{keychainNote}</span>
              </div>

              <div className={s.slotActions}>
                {/* Amber PRIMARY action — SAVE when staging a new key. When a key
                    is already seated the only thing left to do is RE-PROBE the
                    live connection, which needs the deferred Keychain read + API
                    probe — so RECONNECT is disabled with an honest hint rather
                    than presented as an enabled no-op (give every action clear
                    feedback). SAVE KEY stays fully functional. */}
                <button
                  type="button"
                  className={s.primaryBtn}
                  onClick={saveKey}
                  disabled={!dirty}
                  title={!dirty ? "Wired with the sync engine (a later step)" : undefined}
                >
                  {dirty ? "SAVE KEY" : keyStatus === "saved-local" ? "RECONNECT" : "SAVE KEY"}
                </button>
                {!dirty && keyStatus === "saved-local" && (
                  <span className={s.actionHint}>Wired with the sync engine</span>
                )}
                <button type="button" className={s.ghostBtn} onClick={clearKey} disabled={keyStatus === "empty"}>
                  CLEAR
                </button>
              </div>
            </div>
          </section>

          {/* -------- (2) ACCOUNT — demo/live indicator + label -------- */}
          <section className={s.panel} aria-label="Account">
            <div className={`${s.panelHead} ${s.headTeal}`}>Account</div>
            <div className={s.panelBody}>
              <ControlRow label="Environment" hint="Demo is safe to explore; live reads your real account.">
                <KeycapGroup
                  options={["demo", "live"] as const}
                  value={env}
                  onChange={setEnv}
                  render={(v) => v.toUpperCase()}
                  ariaLabel="Account environment"
                />
              </ControlRow>
              <ControlRow label="Account Label" hint="Which stored account this station reads.">
                <span className={s.readout}>{accountLabel}</span>
              </ControlRow>
              <ControlRow label="Mode" hint="Reflects the environment above.">
                <span className={`${s.modePill} ${env === "live" ? s.modeLive : s.modeDemo}`}>
                  {env === "live" ? "LIVE" : "DEMO"}
                </span>
              </ControlRow>
            </div>
          </section>

          {/* -------- (3) SYNC — interval keycaps -------- */}
          <section className={s.panel} aria-label="Sync">
            <div className={`${s.panelHead} ${s.headTeal}`}>Sync</div>
            <div className={s.panelBody}>
              <ControlRow
                label="Sync Interval"
                hint="How often Actuality re-reads your account (respecting the 1 req/s limit)."
              >
                <KeycapGroup
                  options={SYNC_INTERVALS}
                  value={interval}
                  onChange={setInterval}
                  render={intervalLabel}
                  ariaLabel="Sync interval"
                />
              </ControlRow>
              <p className={s.groupNote}>
                {interval === "manual"
                  ? "Manual — Actuality only re-reads when you press SYNC on a data screen. Nothing runs in the background."
                  : `Every ${interval} minutes while the app is open. Automatic scheduling is wired with the sync engine (a later step); this only stages the preference now.`}
              </p>
            </div>
          </section>

          {/* -------- (4) DISPLAY — keycap toggles -------- */}
          <section className={s.panel} aria-label="Display">
            <div className={`${s.panelHead} ${s.headTeal}`}>Display</div>
            <div className={s.panelBody}>
              <ControlRow label="CRT Curve" hint="Will control the baked tube-monitor bezel &amp; scanlines.">
                <KeycapToggle on={crtCurve} onToggle={toggleCrtCurve} ariaLabel="CRT curve" />
              </ControlRow>
              <ControlRow label="Reduce Motion" hint="Calms screen-transition wipes &amp; stamped-in figures.">
                <KeycapToggle on={reduceMotion} onToggle={toggleReduceMotion} ariaLabel="Reduce motion" />
              </ControlRow>
              <ControlRow label="Compact Figures" hint="Tighter number spacing in dense tables.">
                <KeycapToggle on={compactFigures} onToggle={toggleCompactFigures} ariaLabel="Compact figures" />
              </ControlRow>
              <p className={s.groupNote}>
                Display switches stage the preference only for now — actually applying them (and keeping them across
                launches) is wired alongside the key store, a later step.
              </p>
            </div>
          </section>
        </div>
      </div>
    </Chrome>
  );
}

/** Live container — the real-world control panel. Honest status: this sprint
 * does NOT read the Keychain or probe the API (that read/write is deferred),
 * so it cannot claim a verified connection. It seeds an empty slot and reports
 * an explicit pending state; the SAVE/RECONNECT actions stage locally until
 * the Keychain + sync wiring lands. */
function LiveSettings() {
  const panel = useSettingsPanel({ env: "demo", accountLabel: "DEFAULT" });
  const keychainNote =
    "Not yet checked — Keychain read and live connection test are wired with the sync engine. Saving stages the key locally for now.";
  return <SettingsView panel={panel} keychainNote={keychainNote} connection="no-key" lastSyncISO={null} />;
}

/** Mock container — placeholder control panel for design iteration
 * (VITE_MOCK builds). Seeds a plausible-but-INVENTED demo key so the "seated"
 * slot state renders; the status is explicitly labelled DEMO/placeholder and
 * never presented as a real connection. Never touches the Keychain/API. */
function MockSettings() {
  const panel = useSettingsPanel({
    savedKey: "T212DEMoxxxxxxxxxxxxxxxK9",
    env: "demo",
    accountLabel: "DEMO-01",
    interval: 15,
    crtCurve: true,
  });
  const keychainNote = "DEMO placeholder — no real credential is stored or verified. This is sample UI state.";
  const lastSync = new Date(Date.now() - 15 * 60_000).toISOString();
  return <SettingsView panel={panel} keychainNote={keychainNote} connection="no-key" lastSyncISO={lastSync} />;
}

/** Build-time switch: VITE_MOCK => placeholder data (no Keychain); else live.
 * The unused branch is tree-shaken since VITE_MOCK is a compile-time constant. */
export default function Settings() {
  return import.meta.env.VITE_MOCK ? <MockSettings /> : <LiveSettings />;
}
