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
// LIVE SEAM — how this becomes real (no fabricated live claim until it does):
// the honest 24h delta is today's EquitySnapshot vs yesterday's, i.e.
//   deltaMinor = latest.totalValueMinor − prior.totalValueMinor
// where both are recorded `EquitySnapshot`s (see src/engine/types.ts
// `EquitySnapshot` — `{ atISO, totalValueMinor, netDepositsMinor }`, one
// persisted PER SYNC). That series is what makes the value curve honest rather
// than interpolated. Until per-sync snapshot persistence lands (the app has the
// TYPE but not yet a live store of prior-day snapshots to diff against), the
// live branch returns null — the card then renders "—" / "SYNC PENDING" rather
// than inventing a live number. When persistence lands, replace the live branch
// with the two-snapshot diff (and, to stay honest, net out any deposit/
// withdrawal dated in the window using `netDepositsMinor`, exactly as the
// snapshot-lens does in engine/period.ts — a top-up is not a gain).

export interface DaySummary {
  /** 24h change in ACCOUNT-CURRENCY minor units (signed). */
  deltaMinor: number;
  /** 24h change as a ratio of yesterday's total value (signed, e.g. 0.0049 = +0.49%). */
  pct: number;
}

/**
 * The 24-hour gain/loss for the Animus DASHBOARD preview card.
 *
 * Returns an INVENTED placeholder under VITE_MOCK (see the file header — chosen
 * to sit on the mock story) and `null` in live builds, where no prior-day
 * snapshot store exists yet to diff against. The unused branch is tree-shaken:
 * VITE_MOCK is a compile-time constant.
 */
export function getDaySummary(): DaySummary | null {
  if (import.meta.env.VITE_MOCK) {
    // Placeholder only — consistent with the mock's £434.81 pot.
    return { deltaMinor: 210, pct: 0.0049 };
  }
  // Live: no honest 24h delta yet (per-sync snapshot persistence pending — see
  // the live-seam note in the file header). Never fabricate one.
  return null;
}
