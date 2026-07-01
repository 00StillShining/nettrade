// Phase-0 spike: phase machine types + timing constants.
// These timings let external measurement (inter-frame pixel-diff capture)
// correlate captured frames back to a known phase.

export type SpikePhase = "idle" | "dolly" | "wipe" | "settle";

export const IDLE_MS = 1200;
export const DOLLY_MS = 1400;
export const WIPE_MS = 600;
export const SETTLE_MS = 500;

const ORDER: SpikePhase[] = ["idle", "dolly", "wipe", "settle"];

const DURATIONS: Record<SpikePhase, number> = {
  idle: IDLE_MS,
  dolly: DOLLY_MS,
  wipe: WIPE_MS,
  settle: SETTLE_MS,
};

/** Duration in ms that `phase` should hold before advancing. */
export function durationFor(phase: SpikePhase): number {
  return DURATIONS[phase];
}

/** Next phase in the idle -> dolly -> wipe -> settle -> idle cycle. */
export function nextPhase(phase: SpikePhase): SpikePhase {
  const i = ORDER.indexOf(phase);
  return ORDER[(i + 1) % ORDER.length];
}
