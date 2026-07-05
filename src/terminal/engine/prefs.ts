// prefs.ts — the ONE persisted home for the live-poller refresh preference
// (IMPROVEMENTS item 17: "a setting that lies is an honesty bug"). Settings
// wrote a refresh chip that nothing read; the poller was hardcoded to 5 min.
// This module is the shared TRUTH both sides agree on:
//   • Settings (worker C) WRITES the user's choice through setSyncIntervalPref.
//   • the terminal poller (worker A) READS getSyncIntervalMs() at mount to seat
//     its interval — so the chip and the actual schedule can never disagree.
//
// SCOPE (deliberately tiny): only the refresh cadence lives here. The two honest
// options are the ONLY ones the 1 req/s broker budget can sustain:
//   • "manual" → no auto-poller (SYNC NOW only) → getSyncIntervalMs() === 0.
//   • 5        → every 5 minutes → getSyncIntervalMs() === 5 * 60_000.
// Sub-minute cadences are NOT offered (the Settings chips for them stay disabled)
// so this type is intentionally just `"manual" | 5` — widening it later is a
// conscious act, not an accident.
//
// STORAGE: a single localStorage key. Guarded exactly like fmp.ts's cache layer
// so the DOM-free node test env (localStorage === undefined) never throws —
// reads fall back to the honest default, writes become no-ops. Corrupt or
// unrecognised stored values also fall back to the default rather than
// propagating a lie into the poller.

/** The refresh cadences the broker's 1 req/s budget can honestly sustain.
 *  "manual" = re-sync only on demand (no timer); 5 = every 5 minutes. */
export type SyncIntervalPref = "manual" | 5; // minutes

/** localStorage key — namespaced under the app so it never collides with the
 *  fmp cache prefix or any future pref. */
const STORAGE_KEY = "actuality.syncInterval";

/** The honest default when nothing is stored (or the stored value is corrupt):
 *  the proven 5-minute cadence the poller shipped with. */
const DEFAULT_PREF: SyncIntervalPref = 5;

const FIVE_MIN_MS = 5 * 60 * 1000;

/** Read the persisted preference, tolerating a missing / disabled store and any
 *  corrupt value. Never throws; always returns a valid SyncIntervalPref. */
export function getSyncIntervalPref(): SyncIntervalPref {
  // Guard the store itself — the node test env (and a locked-down WKWebView)
  // may have no localStorage at all. A missing store is not an error; it just
  // means "no choice recorded yet" → the honest default.
  try {
    if (typeof localStorage === "undefined") return DEFAULT_PREF;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_PREF;
    // Only the two sanctioned tokens are accepted. Anything else — a stale
    // "15"/"30"/"60" from an older build, a hand-edited garbage string, a
    // half-written value — is treated as corrupt and falls back to the default,
    // so a bad store can never seat an impossible cadence in the poller.
    if (raw === "manual") return "manual";
    if (raw === "5") return 5;
    return DEFAULT_PREF;
  } catch {
    // A throwing localStorage (Safari private-mode quirk, quota, SecurityError)
    // must degrade to the default, never brick reading the pref.
    return DEFAULT_PREF;
  }
}

/** The preference expressed as milliseconds for the poller's setInterval.
 *  0 means "manual" — the poller reads this as "install no timer" and relies on
 *  SYNC NOW alone. Any real cadence is a positive ms value. */
export function getSyncIntervalMs(): number {
  return getSyncIntervalPref() === "manual" ? 0 : FIVE_MIN_MS;
}

/** Persist the user's refresh choice. A no-op (not an error) when the store is
 *  absent or write-protected — in the mock/test env the value simply isn't kept,
 *  which is harmless because nothing there reads it back across a reload. */
export function setSyncIntervalPref(v: SyncIntervalPref): void {
  try {
    if (typeof localStorage === "undefined") return;
    // Store the canonical string form both branches of getSyncIntervalPref parse.
    localStorage.setItem(STORAGE_KEY, v === "manual" ? "manual" : "5");
  } catch {
    // Quota / disabled / private-mode: the write is dropped. The in-session
    // Settings state still reflects the choice; it just won't survive a reload
    // on this locked-down store. Better a lost preference than a thrown setter.
  }
}
