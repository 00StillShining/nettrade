/* =========================================================================
   PREFS — refresh-cadence preference (IMPROVEMENTS item 17). Pure unit tests
   for the ONE persisted setting the poller reads and Settings writes:
     • default when nothing is stored (the honest 5-minute fallback),
     • round-trip persistence for both sanctioned values,
     • ms mapping ("manual" → 0 = no poller; 5 → 5*60_000),
     • corrupt / stale / absent stores never throw and fall back to default.

   The suite runs in the DOM-free node env (vitest environment:"node"), where
   `localStorage` is undefined — so we install a minimal in-memory shim to
   exercise the real read/write paths, and remove it to prove the guards degrade
   gracefully when no store exists at all.
   ========================================================================= */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getSyncIntervalPref,
  getSyncIntervalMs,
  setSyncIntervalPref,
  type SyncIntervalPref,
} from "./prefs";

const STORAGE_KEY = "actuality.syncInterval";
const FIVE_MIN_MS = 5 * 60 * 1000;

/** A minimal in-memory localStorage shim — just enough of the Web Storage
 *  surface that prefs.ts uses (getItem/setItem). */
function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  return store;
}

function removeStorage(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage;
}

describe("prefs — sync interval preference", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installMemoryStorage();
  });
  afterEach(() => {
    removeStorage();
  });

  it("defaults to 5-minute when nothing is stored", () => {
    expect(getSyncIntervalPref()).toBe(5);
    expect(getSyncIntervalMs()).toBe(FIVE_MIN_MS);
  });

  it("round-trips the 'manual' choice and maps to 0 ms (no poller)", () => {
    setSyncIntervalPref("manual");
    expect(store.get(STORAGE_KEY)).toBe("manual");
    expect(getSyncIntervalPref()).toBe("manual");
    expect(getSyncIntervalMs()).toBe(0);
  });

  it("round-trips the 5-minute choice and maps to 5*60_000 ms", () => {
    setSyncIntervalPref(5);
    expect(store.get(STORAGE_KEY)).toBe("5");
    expect(getSyncIntervalPref()).toBe(5);
    expect(getSyncIntervalMs()).toBe(FIVE_MIN_MS);
  });

  it("switching back and forth persists the latest choice", () => {
    setSyncIntervalPref("manual");
    setSyncIntervalPref(5);
    expect(getSyncIntervalPref()).toBe(5);
    setSyncIntervalPref("manual");
    expect(getSyncIntervalMs()).toBe(0);
  });

  it("falls back to the default for a corrupt / stale stored value", () => {
    // A stale sub-minute token from an older build, and outright garbage — both
    // must degrade to the honest default rather than seat an impossible cadence.
    for (const bad of ["15", "30", "60", "", "manualx", "{", "true", "0"]) {
      store.set(STORAGE_KEY, bad);
      expect(getSyncIntervalPref()).toBe(5);
      expect(getSyncIntervalMs()).toBe(FIVE_MIN_MS);
    }
  });

  it("never throws and returns the default when no store exists at all", () => {
    removeStorage();
    expect(() => getSyncIntervalPref()).not.toThrow();
    expect(getSyncIntervalPref()).toBe(5);
    expect(getSyncIntervalMs()).toBe(FIVE_MIN_MS);
    // a write with no store is a harmless no-op, not a throw
    expect(() => setSyncIntervalPref("manual")).not.toThrow();
  });

  it("survives a throwing localStorage (private-mode / quota) on both read and write", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(getSyncIntervalPref()).toBe(5);
    expect(getSyncIntervalMs()).toBe(FIVE_MIN_MS);
    expect(() => setSyncIntervalPref(5)).not.toThrow();
  });

  it("only accepts the two sanctioned pref tokens (type-level guard mirrored at runtime)", () => {
    // Belt-and-braces: the exported type is "manual" | 5, and the writer only
    // ever persists those two canonical strings.
    const prefs: SyncIntervalPref[] = ["manual", 5];
    for (const p of prefs) {
      setSyncIntervalPref(p);
      expect(getSyncIntervalPref()).toBe(p);
    }
  });
});
