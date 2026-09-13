// daySummary.ts — the 24-hour gain/loss shown on the Animus DASHBOARD preview
// card (beside the MARKETS save-stack). This is the ONE number that card exists
// to surface: "am I up or down since yesterday?"
//
// ⚠️ PLACEHOLDER-ONLY under VITE_MOCK. The value returned in the mock branch is
// an INVENTED figure chosen to sit consistently on top of the mock story
// (src/data/mockPerformance.ts: a GBP account whose current total value is
// £434.81 / 43481 minor units), NOT a real reading. +210 minor (+£2.10) at
// +0.49% is a plausible one-day move on that pot.
//
// LIVE (item 5) — the honest 24h delta is today's EquitySnapshot vs the latest
// snapshot AT LEAST 24h older, netting out any deposit/withdrawal dated inside
// that window (a top-up is not a gain). Both snapshots are REAL recorded points
// (see src/engine/types.ts `EquitySnapshot` — `{ atISO, totalValueMinor,
// netDepositsMinor }`, one persisted per sync). Recent transactions are complete
// (only pre-May-26 deep history is blocked), so a 24h contribution window is
// honest. Until two snapshots spanning 24h exist, the live branch returns null —
// the card then renders "—" / "SYNC PENDING" rather than inventing a number.
//
// SELF-CONTAINED: this runs in the ANIMUS world (no Terminal mounted, no
// TruthStore). It reads the DB directly (src/db/history) and MUST NEVER throw —
// any failure returns null. The public `getDaySummary()` stays SYNCHRONOUS to
// match Animus.tsx's exact calling convention (it calls it at render, unawaited);
// the DB read runs in the background and warms a module cache that a subsequent
// call returns. `refreshDaySummary()` is primed once at import so the value has a
// chance to be warm by the time the Animus menu (and this card) first paints.

import { readAllEquitySnapshots, readAllTransactions } from "../db/history";
import type { EquitySnapshotRow } from "../db/history";
import type { HistoryTransaction } from "../adapters/trading212";

export interface DaySummary {
  /** 24h change in ACCOUNT-CURRENCY minor units (signed). */
  deltaMinor: number;
  /** 24h change as a ratio of yesterday's total value (signed, e.g. 0.0049 = +0.49%). */
  pct: number;
}

const IS_MOCK = !!import.meta.env.VITE_MOCK;

/** 24 hours in milliseconds — the minimum span between the two snapshots we diff. */
const DAY_MS = 24 * 60 * 60 * 1000;

/* ====================== PURE HELPERS (exported for tests) ====================== */

/**
 * pickSnapshotPair — from all recorded snapshots (any order), pick the LATEST
 * snapshot and the LATEST snapshot that is AT LEAST 24h older than it. Returns
 * null when no such pair exists (fewer than two snapshots, or every earlier
 * snapshot is inside the last 24h) — the honest "not enough history yet" state.
 *
 * "At least 24h older" (not "exactly yesterday") is deliberate: syncs are
 * irregular, so we take the most recent snapshot whose age clears a full day —
 * the tightest honest 24h+ window we actually recorded, never an interpolated
 * "24h ago" point that was never observed.
 */
export function pickSnapshotPair(
  snapshots: EquitySnapshotRow[],
): { latest: EquitySnapshotRow; prior: EquitySnapshotRow } | null {
  if (snapshots.length < 2) return null;

  // Sort chronologically ASC (codepoint on ISO strings — correct + deterministic).
  const ordered = [...snapshots].sort((a, b) => (a.atISO < b.atISO ? -1 : a.atISO > b.atISO ? 1 : 0));
  const latest = ordered[ordered.length - 1];
  const latestMs = new Date(latest.atISO).getTime();
  if (Number.isNaN(latestMs)) return null;

  // Walk backwards for the newest snapshot at least a full day older than latest.
  for (let i = ordered.length - 2; i >= 0; i--) {
    const cand = ordered[i];
    const candMs = new Date(cand.atISO).getTime();
    if (Number.isNaN(candMs)) continue;
    if (latestMs - candMs >= DAY_MS) return { latest, prior: cand };
  }
  return null;
}

/**
 * netContributionsBetween — deposits − withdrawals dated in the window
 * (fromISO, toISO] (exclusive start, inclusive end — the same convention the
 * engine's windowed sums use, so a deposit dated exactly at the prior snapshot
 * is NOT double-counted against it). Recent transactions are complete, so a 24h
 * window is honest. Interest/fees/dividends are NOT contributions.
 */
export function netContributionsBetween(
  txns: HistoryTransaction[],
  fromISO: string,
  toISO: string,
): number {
  let net = 0;
  for (const t of txns) {
    if (t.dateISO <= fromISO || t.dateISO > toISO) continue;
    if (t.kind === "deposit") net += t.amountMinor;
    else if (t.kind === "withdrawal") net -= t.amountMinor;
  }
  return net;
}

/**
 * computeLiveDaySummary — the pure 24h reading from recorded snapshots +
 * transactions. delta = (latest.total − prior.total) − netContributions(window],
 * so a deposit/withdrawal inside the window is stripped out (a top-up is not a
 * gain). pct is delta over the PRIOR total value (the honest denominator: what
 * you started the window holding); null pct when that base is <= 0 (undefined
 * ratio — never divide by zero). Returns null when there is no 24h+ snapshot
 * pair yet.
 */
export function computeLiveDaySummary(
  snapshots: EquitySnapshotRow[],
  txns: HistoryTransaction[],
): DaySummary | null {
  const pair = pickSnapshotPair(snapshots);
  if (!pair) return null;

  const { latest, prior } = pair;
  const net = netContributionsBetween(txns, prior.atISO, latest.atISO);
  const deltaMinor = latest.totalValueMinor - prior.totalValueMinor - net;
  // Base the % on the prior holdings PLUS what was contributed in the window —
  // the capital actually at risk across it — mirroring the snapshot-lens base
  // used elsewhere. Guard a non-positive base (an empty/withdrawn account).
  const base = prior.totalValueMinor + net;
  const pct = base > 0 ? deltaMinor / base : 0;
  return { deltaMinor, pct };
}

/* ====================== LIVE CACHE + BACKGROUND REFRESH ====================== */

// The last computed live reading. `getDaySummary()` returns this synchronously
// (matching Animus.tsx's unawaited call); `refreshDaySummary()` warms it from the
// DB in the background. null = not computed yet OR not enough history (both honest
// "SYNC PENDING" states for the card).
let liveCache: DaySummary | null = null;
let refreshInFlight = false;

/**
 * refreshDaySummary — self-contained DB read that recomputes the live 24h
 * reading and updates the module cache. NO-OP under VITE_MOCK. NEVER throws (any
 * failure leaves the last-good cache in place and resolves quietly) — the Animus
 * world must never be broken by a DB hiccup. Idempotent: overlapping calls
 * collapse to the one in flight.
 */
export async function refreshDaySummary(): Promise<void> {
  if (IS_MOCK || refreshInFlight) return;
  refreshInFlight = true;
  try {
    const [snapshots, txns] = await Promise.all([
      readAllEquitySnapshots(),
      readAllTransactions(),
    ]);
    liveCache = computeLiveDaySummary(snapshots, txns);
  } catch {
    // Keep the last-good cache; a DB failure is an honest null, never a throw.
  } finally {
    refreshInFlight = false;
  }
}

/**
 * The 24-hour gain/loss for the Animus DASHBOARD preview card.
 *
 * Returns an INVENTED placeholder under VITE_MOCK (see the file header — chosen
 * to sit on the mock story) and, in LIVE builds, the last background-computed
 * real reading (or null when not enough snapshot history exists yet, where the
 * card renders "—" / "SYNC PENDING"). SYNCHRONOUS by contract — Animus.tsx calls
 * it at render without awaiting; each live call also kicks a background refresh so
 * the value is fresh on the next paint. The mock branch is tree-shaken (VITE_MOCK
 * is a compile-time constant).
 */
export function getDaySummary(): DaySummary | null {
  if (import.meta.env.VITE_MOCK) {
    // Placeholder only — consistent with the mock's £434.81 pot.
    return { deltaMinor: 210, pct: 0.0049 };
  }
  // Live: kick a background refresh (warms the cache for the next render) and
  // return the last-good reading. Never fabricated: null until a real 24h+
  // snapshot pair has been recorded.
  void refreshDaySummary();
  return liveCache;
}

// Prime the cache once at import, so the read is already in flight well before
// the Animus menu (and this card) first paints — giving the live number a real
// chance to be warm by first render instead of always flashing SYNC PENDING.
void refreshDaySummary();
