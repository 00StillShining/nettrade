// useAnimusVault — the REAL dual-key credential vault behind the Animus Settings
// screen. Unlike useSettingsPanel (which owns only ephemeral form prefs — env,
// interval, display toggles, all local-state), THIS hook does the real thing:
//   • SLOT A — Trading 212 key → keychain_set_credentials + trading212
//     testConnection().
//   • SLOT B — Market Data key (FMP) → keychain_set_marketdata_key + fmpTestKey().
//
// SAVE writes the secret to the macOS Keychain for real (no longer local-state).
// TEST performs a live probe and records the honest result. The masked slot
// shows only the COMMITTED key's tail — the raw key is never rendered back or
// logged. On load the hook asks the Keychain whether each slot is seated (via
// keychain_has_*), so the UI reflects the real stored state without ever reading
// the secret value into the front-end.
//
// MOCK mode (VITE_MOCK): the whole hook runs against an in-memory stub — no
// Keychain, no network — so design builds render the two slots with sample state
// and never prompt for a macOS password. Honest: mock statuses are labelled
// sample state, never a fabricated live connection in a live build.
//
// SECURITY: the committed key value is held only transiently (to compute the
// masked tail for display); it is NEVER logged, echoed, or persisted anywhere
// but the Keychain. The Keychain WRITE takes the value straight from the input.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { testConnection, type Environment } from "../../adapters/trading212";
import { fmpTestKey } from "../../adapters/fmp";

const IS_MOCK = !!import.meta.env.VITE_MOCK;

/** Which vault slot. */
export type SlotId = "t212" | "fmp";

/** Whether a key is seated in the Keychain for this slot (independent of a probe). */
export type SeatState = "unknown" | "seated" | "empty";

/** The honest result of a live connection probe. Never a fabricated "connected". */
export type ProbeState =
  | "idle" //  never probed this session
  | "checking" //  a probe is in flight
  | "connected" //  probe succeeded
  | "bad-key" //  401/403 / rejected
  | "rate-limited" //  429 / free-tier daily/second limit
  | "no-key" //  nothing seated to test
  | "unreachable" //  network / host-scope failure
  | "error"; //  anything else

export interface VaultSlot {
  id: SlotId;
  /** The credential text as typed (masked in the UI while resting). */
  input: string;
  setInput: (v: string) => void;
  /** True while the input diverges from what's committed (enables SAVE). */
  dirty: boolean;
  /** Whether a key is seated in the Keychain. */
  seat: SeatState;
  /** Masked tail of the COMMITTED key (•••• + last 4), or "" if none. */
  maskedTail: string;
  /** Live probe state + an honest one-line note (e.g. plan / reason). */
  probe: ProbeState;
  note: string;
  /** True while a Keychain write is in flight. */
  saving: boolean;
  /** Write the typed key to the Keychain (real), then refresh seat state. */
  save: () => Promise<void>;
  /** Delete the seated key from the Keychain. */
  clear: () => Promise<void>;
  /** Run a live connection probe and record the honest result. */
  test: () => Promise<void>;
}

export interface AnimusVault {
  t212: VaultSlot;
  fmp: VaultSlot;
  /** Combined honest connection state for the CONNECTION group. */
  combined: {
    /** "◆ CONNECTED" only when BOTH required links verify; otherwise honest. */
    label: string;
    tone: "connected" | "partial" | "pending" | "problem";
    detail: string;
  };
  /** Whether we're in the mock (no-Keychain) build. */
  isMock: boolean;
}

/* ============================ MASKING ============================ */

/** Mask a committed key to its shape only — never the raw value. */
function maskTail(committedTail: string | null): string {
  if (!committedTail) return "";
  const t = committedTail.trim();
  if (t.length === 0) return "";
  const tail = t.length <= 4 ? t : t.slice(-4);
  return "••••••••" + tail;
}

/* ============================ MOCK STORE ============================ */

// A tiny in-memory stand-in for the Keychain under VITE_MOCK: seat state + a
// last-4 for the mask, no real secret. Reset per module load.
const mockStore: Record<SlotId, { seated: boolean; tail: string | null }> = {
  t212: { seated: true, tail: "3f2a" },
  fmp: { seated: false, tail: null },
};

/* ============================ SLOT HOOK ============================ */

interface SlotConfig {
  id: SlotId;
  /** Reads whether a key is seated (Keychain has-check). */
  hasKey: () => Promise<boolean>;
  /** Writes the raw key to the Keychain. */
  setKey: (raw: string) => Promise<void>;
  /** Deletes the seated key from the Keychain. */
  delKey: () => Promise<void>;
  /** Runs the live probe → { probe, note }. */
  probeFn: (raw: string) => Promise<{ probe: ProbeState; note: string }>;
}

function useSlot(cfg: SlotConfig): VaultSlot {
  const [input, setInput] = useState("");
  const [seat, setSeat] = useState<SeatState>("unknown");
  // The tail of the committed key, for the mask. Set on save; discovered as
  // "••••" placeholder on load (we can't read the real value back from the
  // Keychain, so a seated-but-unedited slot masks generically).
  const [committedTail, setCommittedTail] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeState>("idle");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // On mount, discover whether the Keychain already has this key seated.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const has = await cfg.hasKey();
        if (!alive) return;
        setSeat(has ? "seated" : "empty");
        // We can't read the value back (by design) — a seated slot masks with a
        // generic tail until the user edits + re-saves.
        if (has) setCommittedTail((t) => t ?? "••••");
      } catch {
        if (alive) setSeat("empty");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = input.trim();
  const dirty = trimmed.length > 0;

  const save = useCallback(async () => {
    if (trimmed.length === 0) return;
    setSaving(true);
    try {
      await cfg.setKey(trimmed);
      if (!mounted.current) return;
      setSeat("seated");
      setCommittedTail(trimmed.slice(-4));
      setInput(""); // never keep the raw key in component state after commit
      setProbe("idle"); // a new key invalidates the prior probe result
      setNote("Saved — press TEST to verify");
    } catch {
      // a denied Keychain prompt / write failure must NOT read as success
      if (!mounted.current) return;
      setProbe("error");
      setNote("Keychain write failed — not saved");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [trimmed, cfg]);

  const clear = useCallback(async () => {
    try {
      await cfg.delKey();
      // only report "removed" once the Keychain delete actually succeeded
      if (!mounted.current) return;
      setSeat("empty");
      setCommittedTail(null);
      setInput("");
      setProbe("idle");
      setNote("");
    } catch {
      if (!mounted.current) return;
      setProbe("error");
      setNote("Keychain delete failed — key still stored");
    }
  }, [cfg]);

  const test = useCallback(async () => {
    setProbe("checking");
    setNote("Probing…");
    try {
      // If the user typed a new key but hasn't saved, we still probe the SEATED
      // key (the probe reads from the Keychain) — so TEST reflects what's stored.
      const result = await cfg.probeFn(trimmed);
      if (!mounted.current) return;
      setProbe(result.probe);
      setNote(result.note);
    } catch {
      if (!mounted.current) return;
      setProbe("error");
      setNote("Probe failed unexpectedly");
    }
  }, [cfg, trimmed]);

  return {
    id: cfg.id,
    input,
    setInput,
    dirty,
    seat,
    maskedTail: maskTail(committedTail),
    probe,
    note,
    saving,
    save,
    clear,
    test,
  };
}

/* ============================ REAL SLOT CONFIGS ============================ */

function t212Config(env: Environment, accountId: string): SlotConfig {
  return {
    id: "t212",
    hasKey: () => invoke<boolean>("keychain_has_credentials", { accountId }),
    // Trading 212 credentials are a key:secret pair. The Animus single-field slot
    // captures the API key; the secret half is empty for now (T212 personal API
    // keys authenticate as key-only in Basic auth for read scopes). We store what
    // the user pasted as the api_key and an empty secret — testConnection reads
    // both back through the Keychain.
    setKey: (raw: string) =>
      invoke("keychain_set_credentials", { accountId, apiKey: raw, apiSecret: "" }),
    delKey: () => invoke("keychain_delete_credentials", { accountId }),
    probeFn: async () => {
      const creds = await invoke<{ apiKey: string; apiSecret: string } | null>(
        "keychain_get_credentials",
        { accountId },
      );
      if (!creds) return { probe: "no-key", note: "No Trading 212 key seated" };
      const status = await testConnection(creds, env);
      switch (status) {
        case "ok":
          return { probe: "connected", note: "Verified — live account link" };
        case "unauthorized":
          return { probe: "bad-key", note: "Key rejected — check the value" };
        case "rate_limited":
          return { probe: "rate-limited", note: "Rate-limited — try again shortly" };
        case "network":
          return { probe: "unreachable", note: "Could not reach Trading 212" };
        default:
          return { probe: "error", note: "Unexpected response from Trading 212" };
      }
    },
  };
}

function fmpConfig(): SlotConfig {
  return {
    id: "fmp",
    hasKey: () => invoke<boolean>("keychain_has_marketdata_key"),
    setKey: (raw: string) => invoke("keychain_set_marketdata_key", { key: raw }),
    delKey: () => invoke("keychain_delete_marketdata_key"),
    probeFn: async () => {
      const r = await fmpTestKey();
      if (r.ok) {
        return { probe: "connected", note: r.plan ? `Verified — ${r.plan} plan` : r.note };
      }
      switch (r.reason) {
        case "bad_key":
          return { probe: "bad-key", note: r.note };
        case "rate_limited":
          return { probe: "rate-limited", note: r.note };
        case "no_key":
          return { probe: "no-key", note: r.note };
        case "network":
          return { probe: "unreachable", note: r.note };
        default:
          return { probe: "error", note: r.note };
      }
    },
  };
}

/* ============================ MOCK SLOT CONFIGS ============================ */

function mockConfig(id: SlotId): SlotConfig {
  return {
    id,
    hasKey: async () => mockStore[id].seated,
    setKey: async (raw: string) => {
      mockStore[id] = { seated: true, tail: raw.slice(-4) };
    },
    delKey: async () => {
      mockStore[id] = { seated: false, tail: null };
    },
    probeFn: async () => {
      if (!mockStore[id].seated) return { probe: "no-key", note: "No key seated (sample)" };
      // Honest sample: the mock build never claims a real live connection — it
      // reports a clearly-labelled sample verified state for design preview only.
      return { probe: "connected", note: "Sample state — not a real connection" };
    },
  };
}

/* ============================ THE VAULT ============================ */

export function useAnimusVault(env: Environment, accountId = "default"): AnimusVault {
  const t212 = useSlot(IS_MOCK ? mockConfig("t212") : t212Config(env, accountId));
  const fmp = useSlot(IS_MOCK ? mockConfig("fmp") : fmpConfig());

  // Combined honest state for the CONNECTION group. Trading 212 is the REQUIRED
  // link (the app's whole point); FMP is the optional market-data enrichment.
  // We never claim a blanket "CONNECTED" unless the required link verifies.
  const t = t212.probe;
  const f = fmp.probe;

  let combined: AnimusVault["combined"];
  if (t === "connected" && f === "connected") {
    combined = {
      label: "◆ CONNECTED",
      tone: "connected",
      detail: "Account + market data both live",
    };
  } else if (t === "connected") {
    combined = {
      label: "◆ CONNECTED",
      tone: "partial",
      detail:
        fmp.seat === "seated"
          ? "Account live · market-data key not yet verified"
          : "Account live · no market-data key",
    };
  } else if (t === "bad-key" || f === "bad-key") {
    combined = { label: "BAD KEY", tone: "problem", detail: "A seated key was rejected" };
  } else if (t === "rate-limited" || f === "rate-limited") {
    combined = { label: "RATE-LIMITED", tone: "problem", detail: "A provider limit was hit" };
  } else if (t === "unreachable" || f === "unreachable") {
    combined = { label: "UNREACHABLE", tone: "problem", detail: "A provider could not be reached" };
  } else if (t212.seat === "empty" && fmp.seat === "empty") {
    combined = { label: "NO KEY", tone: "pending", detail: "No credentials seated yet" };
  } else {
    combined = {
      label: "NOT VERIFIED",
      tone: "pending",
      detail: "Keys seated — press TEST to verify the live link",
    };
  }

  return { t212, fmp, combined, isMock: IS_MOCK };
}
