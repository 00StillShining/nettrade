// useSettingsPanel — LOCAL, in-directory settings state for the Settings
// control-panel screen (kept inside the screen dir per the parallel-sprint
// conflict rules: no shared src/state file this sprint). This hook owns ONLY
// ephemeral, in-memory form state — the credential field, its
// staged/committed status, the chosen environment, sync interval and display
// toggles.
//
// PERSISTENCE IS DEFERRED (this sprint = local-state interactivity only):
//   - The real Trading 212 key is written to / read from the macOS Keychain
//     via the keychain_* Tauri commands (see usePositions.ts +
//     adapters/trading212.ts). This hook DELIBERATELY does NOT touch the
//     Keychain, src/db, or the network — SAVE/RECONNECT commit to this local
//     state only, so the control panel is fully interactive to eyeball in the
//     real .app without any password prompt. Wiring the commit to
//     keychain_set_credentials + persisting the interval/theme preferences is
//     the LIVE step (a later task), noted where each action fires below.
//
// Honest status: because nothing here reads a real connection, the derived
// keychain/connection status is a clearly-labelled staged/placeholder state,
// never a fabricated "Connected". The Live container decides the honest
// real-world status separately.

import { useCallback, useMemo, useState } from "react";

/** Sync-interval options (minutes) surfaced as keycap buttons. `manual`
 * means "only when I press SYNC" — an honest option, not a fake schedule. */
export type SyncInterval = "manual" | 5 | 15 | 30 | 60;

export const SYNC_INTERVALS: SyncInterval[] = ["manual", 5, 15, 30, 60];

/** How the staged credential relates to what would be persisted. Drives the
 * honest keychain-status readout — none of these claim a verified live
 * connection (that needs a real Keychain read + API probe, deferred). */
export type KeyStatus =
  | "empty" // no key entered and none staged
  | "staged" // a key is typed but not yet "saved" to local state
  | "saved-local"; // committed to LOCAL state this session (NOT the Keychain yet)

export interface SettingsPanelState {
  /** The credential text as typed (masked in the UI). */
  keyInput: string;
  setKeyInput: (v: string) => void;
  /** The key value last committed to local state via SAVE (deferred: Keychain). */
  savedKey: string | null;
  keyStatus: KeyStatus;
  /** True once the input diverges from the locally-saved value (enables SAVE). */
  dirty: boolean;
  /** Commit the typed key to LOCAL state only. Keychain write is DEFERRED. */
  saveKey: () => void;
  /** Clear the staged + saved local key (does not touch any real store). */
  clearKey: () => void;

  env: "demo" | "live";
  setEnv: (e: "demo" | "live") => void;
  accountLabel: string;

  interval: SyncInterval;
  setInterval: (i: SyncInterval) => void;

  /** Display toggles — local UI preferences (persistence deferred). */
  crtCurve: boolean;
  toggleCrtCurve: () => void;
  reduceMotion: boolean;
  toggleReduceMotion: () => void;
  compactFigures: boolean;
  toggleCompactFigures: () => void;
}

export interface SettingsSeed {
  savedKey?: string | null;
  env?: "demo" | "live";
  accountLabel?: string;
  interval?: SyncInterval;
  crtCurve?: boolean;
  reduceMotion?: boolean;
  compactFigures?: boolean;
}

/** The single state container for the control panel. Seeded so the Mock and
 * Live containers can start it from different honest baselines. */
export function useSettingsPanel(seed: SettingsSeed = {}): SettingsPanelState {
  const [savedKey, setSavedKey] = useState<string | null>(seed.savedKey ?? null);
  const [keyInput, setKeyInput] = useState<string>(seed.savedKey ?? "");
  const [env, setEnv] = useState<"demo" | "live">(seed.env ?? "demo");
  const [interval, setInterval] = useState<SyncInterval>(seed.interval ?? "manual");
  const [crtCurve, setCrtCurve] = useState<boolean>(seed.crtCurve ?? true);
  const [reduceMotion, setReduceMotion] = useState<boolean>(seed.reduceMotion ?? false);
  const [compactFigures, setCompactFigures] = useState<boolean>(seed.compactFigures ?? false);

  const trimmedInput = keyInput.trim();
  const dirty = trimmedInput !== (savedKey ?? "");

  const keyStatus: KeyStatus = useMemo(() => {
    if (savedKey && !dirty) return "saved-local";
    // Emptying the field over a seated key is a PENDING change, not an empty
    // slot — otherwise the chip would misreport committed local state as
    // "SLOT EMPTY" and CLEAR would disable (honest-data + the seated key must
    // stay removable).
    if (trimmedInput.length > 0 || savedKey) return "staged";
    return "empty";
  }, [savedKey, dirty, trimmedInput]);

  const saveKey = useCallback(() => {
    // DEFERRED (live step): this is where keychain_set_credentials would run.
    // This sprint it commits to local state ONLY — no Keychain, no network.
    setSavedKey(trimmedInput.length > 0 ? trimmedInput : null);
  }, [trimmedInput]);

  const clearKey = useCallback(() => {
    setSavedKey(null);
    setKeyInput("");
  }, []);

  return {
    keyInput,
    setKeyInput,
    savedKey,
    keyStatus,
    dirty,
    saveKey,
    clearKey,
    env,
    setEnv,
    accountLabel: seed.accountLabel ?? "DEFAULT",
    interval,
    setInterval,
    crtCurve,
    toggleCrtCurve: useCallback(() => setCrtCurve((v) => !v), []),
    reduceMotion,
    toggleReduceMotion: useCallback(() => setReduceMotion((v) => !v), []),
    compactFigures,
    toggleCompactFigures: useCallback(() => setCompactFigures((v) => !v), []),
  };
}
