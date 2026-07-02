// Actuality — Animus dive-transition timing (Phase 3a).
//
// The dive is ONE full-screen effect (anti-brick #5): the camera dolly (the
// selected stack pulling to the lens, in AnimusScene) runs first, then the
// clip-path wipe sweeps and — at its cover point — we navigate() to the screen
// and flip mode to "screen" (which freezes the canvas + un-suspends the CRT
// over the now-opaque screen). Kept as named constants so the sequence reads
// and can be tuned in one place.

/** Lead time the dolly runs alone before the wipe starts (ms). */
export const DIVE_DOLLY_LEAD_MS = 260;

/** Wipe duration — MUST match the @keyframes in MenuWipe.module.css (ms). */
export const DIVE_WIPE_MS = 560;

/** Fraction of the wipe at which the screen is fully covered (nav happens here). */
export const DIVE_COVER_FRACTION = 0.55;

/** ms from wipe-start to the covered moment where we navigate + show the screen. */
export const DIVE_NAV_AT_MS = Math.round(DIVE_WIPE_MS * DIVE_COVER_FRACTION);

/** Total ms from dive-start to when the wipe DOM can be torn down. */
export const DIVE_TOTAL_MS = DIVE_DOLLY_LEAD_MS + DIVE_WIPE_MS;
