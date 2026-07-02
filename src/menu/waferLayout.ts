// Actuality — Animus wafer-stack layout (Phase 3a).
//
// The resting geometry of the 7 wafer-stacks (VISUAL_DIRECTION.md §5 MENU:
// "7 vertical stacks of thin translucent wafers … one-point perspective
// receding into -Z, camera slightly above"). Pure data: no three.js, no React,
// no side effects — so the layout is deterministic across remounts/hot-reloads
// and reads as intentional, not noisy (the spike's discipline, generalised).
//
// One InstancedMesh holds every wafer of every stack; this module hands back a
// flat instance table PLUS a per-stack index map so the selection controller
// can address / tint / move one stack at a time (anti-brick: one mesh, one
// draw call, no per-route mounts).

import { STACK_COUNT } from "./destinations";

// ---------------------------------------------------------------------------
// Deterministic per-instance hash (NOT Math.random) — copied from the spike so
// the jitter is stable and the layout never "shuffles" between renders.
// ---------------------------------------------------------------------------
function hash(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x); // 0..1
}

/** Wafers per stack. Kept modest — 7 stacks × this is the whole instance count. */
export const WAFERS_PER_STACK = 14;

/** Total instances across all stacks (drives the single InstancedMesh size). */
export const TOTAL_WAFERS = STACK_COUNT * WAFERS_PER_STACK;

/** Horizontal gap between adjacent stacks, in world units. */
export const STACK_SPACING = 2.15;

/** Vertical gap between wafers within a stack. */
const WAFER_GAP = 0.5;

/** Wafer plane size (matches the additive-blended quad in the scene). */
export const WAFER_W = 1.9;
export const WAFER_H = 0.34;

export interface WaferInstance {
  /** Which stack (0..STACK_COUNT-1) this wafer belongs to. */
  readonly stack: number;
  /** Rank within its stack, 0 = bottom. */
  readonly rank: number;
  /** Resting local position RELATIVE to the stack's own origin (x,y,z). */
  readonly local: readonly [number, number, number];
  /** Resting y-rotation jitter (radians). */
  readonly rot: number;
  /** Resting uniform scale jitter. */
  readonly scale: number;
  /** Base bone-white brightness 0..1 (varies per wafer to avoid wallpaper flatness). */
  readonly brightness: number;
}

export interface WaferLayout {
  /** Every wafer instance, grouped stack-by-stack (index === instance id). */
  readonly wafers: readonly WaferInstance[];
  /**
   * Resting WORLD x for each stack's origin (the stacks fan out along X). Y/Z
   * of a stack's origin are animated by the selection controller (selected
   * stack dollies forward/up), so only the static X lives here.
   */
  readonly stackBaseX: readonly number[];
}

/**
 * Build the deterministic resting layout. Stacks fan out along X centred on 0;
 * within a stack, wafers climb in Y with small per-wafer jitter so the strata
 * read hand-stacked, not printed (anti-slop: vary opacity/jitter, §6).
 */
export function buildWaferLayout(): WaferLayout {
  const wafers: WaferInstance[] = [];
  const stackBaseX: number[] = [];

  for (let s = 0; s < STACK_COUNT; s++) {
    stackBaseX.push((s - (STACK_COUNT - 1) / 2) * STACK_SPACING);

    for (let w = 0; w < WAFERS_PER_STACK; w++) {
      const id = s * WAFERS_PER_STACK + w;
      const jx = (hash(id, 1.0) - 0.5) * 0.22;
      const jy = (hash(id, 2.0) - 0.5) * 0.1;
      const jz = (hash(id, 3.0) - 0.5) * 0.35;
      const rot = (hash(id, 4.0) - 0.5) * 0.1;
      const scale = 0.9 + hash(id, 5.0) * 0.2;
      const brightness = 0.45 + hash(id, 6.0) * 0.55;

      const y = (w - (WAFERS_PER_STACK - 1) / 2) * WAFER_GAP + jy;

      wafers.push({
        stack: s,
        rank: w,
        local: [jx, y, jz],
        rot,
        scale,
        brightness,
      });
    }
  }

  return { wafers, stackBaseX };
}
