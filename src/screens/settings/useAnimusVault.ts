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
import { resetLiveCaches, refreshLive } from "../../terminal/engine/live";

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
  /** The SECOND credential part (T212's API Secret — a key+secret PAIR; the
   *  secret is shown once at generation). Unused ("" always) for single-token
   *  slots like FMP. */
  input2: string;
  setInput2: (v: string) => void;
  /** True while the input diverges from what's committed (enables SAVE). */
  dirty: boolean;
  /** Whether a key is seated in the Keychain. */
  seat: SeatState;
  /** Masked tail of the COMMITTED key (•••• + last 4), or "" if none. */
  maskedTail: string;
  /** Live probe state + an honest one-line note (e.g. plan / reason). */
  probe: ProbeState;
  note: string;
  /** Wall-clock ms of the last COMPLETED probe this session (any outcome —
   *  verified or rejected), or null if never tested. Session-scoped ONLY:
   *  deliberately NOT persisted (a stale "last tested" across launches would be
   *  a lie about freshness). Drives the "last tested HH:MM" stamp (item 22a). */
  lastTestedAt: number | null;
  /** True while a Keychain write is in flight. */
  saving: boolean;
  /** Write the typed key to the Keychain (real), then refresh seat state. */
  save: () => Promise<void>;
  /** Delete the seated key from the Keychain. */
  clear: () => Promise<void>;
  /** Run a live connection probe and record the honest result. */
  test: () => Promise<void>;
}

/** Touch ID (biometric) protection state for the seated keys. */
export interface TouchIdState {
  /** The Mac supports a biometric access-control policy. */
  available: boolean;
  /** At least one seated key is currently protected by Touch ID. */
  enabled: boolean;
  /** An enable/disable operation is in flight. */
  busy: boolean;
  /** Honest one-line status. */
  note: string;
  /** Move the seated key(s) behind Touch ID (prompts to confirm a fingerprint). */
  enable: () => Promise<void>;
  /** Return the key(s) to the standard Keychain (prompts Touch ID once to read). */
  disable: () => Promise<void>;
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
  /** Touch ID protection for the seated keys. */
  touchId: TouchIdState;
  /** Whether we're in the mock (no-Keychain) build. */
  isMock: boolean;
}

const BIO_SLOTS = ["creds", "marketdata"] as const;

/** Strip the internal "keychain error: " prefix for a user-facing note. */
function shortErr(e: unknown): string {
  return String(e).replace(/^.*keychain error:\s*/i, "").trim() || "unexpected error";
}

/** Touch ID vault control. Under VITE_MOCK it's an inert "unavailable" stub. */
function useTouchId(): TouchIdState {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (IS_MOCK) {
      setAvailable(false);
      setEnabled(false);
      setNote("Not available in the demo build");
      return;
    }
    const avail = await invoke<boolean>("keychain_bio_available").catch(() => false);
    let any = false;
    for (const slot of BIO_SLOTS) {
      if (await invoke<boolean>("keychain_bio_has", { slot }).catch(() => false)) any = true;
    }
    if (!mounted.current) return;
    setAvailable(avail);
    setEnabled(any);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (IS_MOCK) return;
    setBusy(true);
    setNote("Setting up Touch ID…");
    try {
      let done = false;
      let lastErr = "";
      for (const slot of BIO_SLOTS) {
        // ALWAYS call enable — it's idempotent (the gate step is skipped once the
        // flag is on) and it performs the slot's ACL migration. Skipping a slot
        // that "looks protected" (gate on + key seated) would leave that key
        // un-migrated and still password-prompting.
        try {
          await invoke("keychain_bio_enable", { slot });
          done = true;
        } catch (e) {
          // "no key seated" just means that slot is empty — not a failure
          if (!/no key/i.test(String(e))) lastErr = shortErr(e);
        }
      }
      resetLiveCaches();
      refreshLive();
      if (!mounted.current) return;
      if (lastErr) setNote(`Couldn't enable Touch ID — ${lastErr}`);
      else if (done) setNote("Touch ID on — a fingerprint is required each launch");
      else setNote("No seated key to protect — save a key first");
      await refresh();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [refresh]);

  const disable = useCallback(async () => {
    if (IS_MOCK) return;
    setBusy(true);
    setNote("Turning Touch ID off…");
    try {
      let lastErr = "";
      for (const slot of BIO_SLOTS) {
        if (!(await invoke<boolean>("keychain_bio_has", { slot }).catch(() => false))) continue;
        try {
          await invoke("keychain_bio_disable", { slot });
        } catch (e) {
          lastErr = shortErr(e);
        }
      }
      resetLiveCaches();
      refreshLive();
      if (!mounted.current) return;
      setNote(
        lastErr
          ? `Couldn't fully turn off — ${lastErr}`
          : "Touch ID off — back to the standard Keychain",
      );
      await refresh();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [refresh]);

  return { available, enabled, busy, note, enable, disable };
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
  /** Writes the raw credential to the Keychain. `raw2` is the optional SECOND
   *  part (T212's API Secret); single-token slots ignore it. */
  setKey: (raw: string, raw2: string) => Promise<void>;
  /** Deletes the seated key from the Keychain. */
  delKey: () => Promise<void>;
  /** Runs the live probe → { probe, note }. */
  probeFn: (raw: string) => Promise<{ probe: ProbeState; note: string }>;
}

function useSlot(cfg: SlotConfig): VaultSlot {
  const [input, setInput] = useState("");
  const [input2, setInput2] = useState("");
  const [seat, setSeat] = useState<SeatState>("unknown");
  // The tail of the committed key, for the mask. Set on save; discovered as
  // "••••" placeholder on load (we can't read the real value back from the
  // Keychain, so a seated-but-unedited slot masks generically).
  const [committedTail, setCommittedTail] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeState>("idle");
  const [note, setNote] = useState("");
  // Session-scoped "last tested" wall-clock — set when a probe RESOLVES (any
  // outcome), never persisted (item 22a). null until the first completed test.
  const [lastTestedAt, setLastTestedAt] = useState<number | null>(null);
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
  const trimmed2 = input2.trim();
  const dirty = trimmed.length > 0;

  const save = useCallback(async () => {
    if (trimmed.length === 0) return;
    setSaving(true);
    try {
      await cfg.setKey(trimmed, trimmed2);
      // A newly-saved key invalidates the in-memory Keychain caches so the next
      // live sync uses it (otherwise the cached old/absent key would win until an
      // app restart), then re-sync immediately.
      resetLiveCaches();
      refreshLive();
      if (!mounted.current) return;
      setSeat("seated");
      setCommittedTail(trimmed.slice(-4));
      setInput(""); // never keep the raw credential in component state after commit
      setInput2("");
      setProbe("idle"); // a new key invalidates the prior probe result
      // the prior probe TIME belongs to the OLD key — clear it so we never stamp
      // a fresh, untested key with a stale "last tested" (that would be a lie).
      setLastTestedAt(null);
      setNote("Saved — press TEST to verify");
    } catch {
      // a denied Keychain prompt / write failure must NOT read as success
      if (!mounted.current) return;
      setProbe("error");
      setNote("Keychain write failed — not saved");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [trimmed, trimmed2, cfg]);

  const clear = useCallback(async () => {
    try {
      await cfg.delKey();
      // a removed key must also drop the in-memory caches + re-sync (falls back to
      // the honest mock/last-good world rather than a stale live claim).
      resetLiveCaches();
      refreshLive();
      // only report "removed" once the Keychain delete actually succeeded
      if (!mounted.current) return;
      setSeat("empty");
      setCommittedTail(null);
      setInput("");
      setInput2("");
      setProbe("idle");
      setLastTestedAt(null); // no key → no meaningful last-tested time
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
      // Stamp the completion time for the "last tested HH:MM" readout — on ANY
      // resolved outcome (verified OR rejected), since both are honest evidence
      // the link was checked just now. Session-scoped; never persisted.
      setLastTestedAt(Date.now());
    } catch {
      if (!mounted.current) return;
      setProbe("error");
      setNote("Probe failed unexpectedly");
      setLastTestedAt(Date.now());
    }
  }, [cfg, trimmed]);

  return {
    id: cfg.id,
    input,
    setInput,
    input2,
    setInput2,
    dirty,
    seat,
    maskedTail: maskTail(committedTail),
    probe,
    note,
    lastTestedAt,
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
    setKey: async (raw: string, raw2: string) => {
      // T212 credentials are a KEY + SECRET PAIR (the API Secret is shown ONCE at
      // generation — help centre confirmed). Basic auth is base64(key:secret), so
      // saving a key with an empty secret authenticates as base64(key:) → 401
      // "bad key". The second field carries the secret; a combined "KEY:SECRET"
      // paste in the first field is tolerated too (split on the FIRST colon).
      let apiKey = raw;
      let apiSecret = raw2;
      if (!apiSecret && raw.includes(":")) {
        const i = raw.indexOf(":");
        apiKey = raw.slice(0, i).trim();
        apiSecret = raw.slice(i + 1).trim();
      }
      await invoke("keychain_set_credentials", { accountId, apiKey, apiSecret });
      // Touch ID on for this slot → migrate the fresh key into the bio store
      // (reads pick the bio item first, so a stale one would shadow the new key).
      if (await invoke<boolean>("keychain_bio_has", { slot: "creds" }).catch(() => false)) {
        await invoke("keychain_bio_enable", { slot: "creds" });
      }
    },
    delKey: async () => {
      await invoke("keychain_delete_credentials", { accountId });
      // CLEAR must also remove the bio copy or the key stays seated behind Touch ID.
      await invoke("keychain_bio_delete", { slot: "creds" }).catch(() => undefined);
    },
    probeFn: async () => {
      // Touch ID store first (after migration the password copy is gone) — this
      // read prompts a fingerprint, which is honest: TEST reads the seated key.
      let creds: { apiKey: string; apiSecret: string } | null = null;
      if (await invoke<boolean>("keychain_bio_has", { slot: "creds" }).catch(() => false)) {
        const payload = await invoke<string | null>("keychain_bio_get", { slot: "creds" });
        if (payload) creds = JSON.parse(payload) as { apiKey: string; apiSecret: string };
      } else {
        creds = await invoke<{ apiKey: string; apiSecret: string } | null>(
          "keychain_get_credentials",
          { accountId },
        );
      }
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
    // keychain_has_marketdata_key is now PROMPT-FREE in Rust (attribute-only +
    // bio existence) — the right seat-check. (A full cached read here would fire
    // a Touch ID prompt just for opening Settings once the key is bio-protected.)
    hasKey: () => invoke<boolean>("keychain_has_marketdata_key"),
    setKey: async (raw: string, _raw2: string) => {
      await invoke("keychain_set_marketdata_key", { key: raw });
      if (await invoke<boolean>("keychain_bio_has", { slot: "marketdata" }).catch(() => false)) {
        await invoke("keychain_bio_enable", { slot: "marketdata" });
      }
    },
    delKey: async () => {
      await invoke("keychain_delete_marketdata_key");
      await invoke("keychain_bio_delete", { slot: "marketdata" }).catch(() => undefined);
    },
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
    setKey: async (raw: string, _raw2: string) => {
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
  const touchId = useTouchId();

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

  return { t212, fmp, combined, touchId, isMock: IS_MOCK };
}
