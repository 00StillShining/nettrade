// Actuality — Animus smoke atmosphere (Phase 3b).
//
// The "cool smokey void" that the Animus rack falls through. Two pure, deterministic
// pieces, kept out of the scene component so they stay testable and allocation-free
// at frame time (anti-brick: no per-frame allocation, no Math.random — the drift is
// a stable hash so the atmosphere never "reshuffles" between renders/hot-reloads):
//
//   1. makeSmokeTexture()  — a canvas-generated soft radial puff, drawn ONCE into a
//      2D canvas and handed to three as a CanvasTexture (no drei, no external image,
//      no live filter). This is the sprite every smoke billboard samples.
//   2. buildSmokeField()   — the deterministic resting layout of N smoke sprites
//      spread through the void behind/around the rack, each with its own drift speed
//      and phase so the fall reads as organic haze, not a marching grid.
//
// The perpetual fall itself (advancing y each active frame, wrapping at the bottom)
// lives in AnimusScene's useFrame — but ONLY while mode!=="screen" and NOT under
// prefers-reduced-motion (then the field is frozen dead-still at its resting layout).

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Deterministic per-sprite hash (NOT Math.random) — same technique as the wafer
// layout so the smoke field is byte-stable across remounts.
// ---------------------------------------------------------------------------
function hash(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x); // 0..1
}

/** How many smoke billboards fill the void. Modest — one draw of a cheap sprite. */
export const SMOKE_COUNT = 46;

/** Vertical span the field occupies; sprites wrap from -SMOKE_SPAN_Y/2 → +span/2.
 *  The shared fall accumulator is reset by THIS span (the least common multiple
 *  of every wrap period: 18 = 2 × RACK_WRAP_Y(9) = 1 × this span = 2 full sway
 *  cycles), so BOTH the rack and the smoke land on whole spans at the reset —
 *  the relationship must run this direction (reset step = multiple of every
 *  span), otherwise the smoke field visibly teleports each reset. */
export const SMOKE_SPAN_Y = 18;

/** Horizontal + depth spread of the field (world units, half-extents). */
const SMOKE_SPAN_X = 11;
const SMOKE_SPAN_Z = 9;
/** Sprites sit at/behind the rack (rack rests near z ≈ -2.5), never in front of it. */
const SMOKE_Z_BACK = -2.0;

export interface SmokeSprite {
  /** Resting world position (x,y,z). y is advanced by the fall loop at runtime. */
  readonly base: readonly [number, number, number];
  /** Per-sprite world size (billboards vary so the haze isn't a printed grid). */
  readonly size: number;
  /** Resting opacity 0..1 (soft; the void reads as depth, never a wall). */
  readonly opacity: number;
  /** Phase offset for a tiny lateral sway (kept transform-only, cheap). */
  readonly swayPhase: number;
}

export interface SmokeField {
  readonly sprites: readonly SmokeSprite[];
}

/**
 * Build the deterministic resting smoke field. Sprites spread through a slab of
 * the void, biased BEHIND the rack in Z so they read as atmosphere the strata
 * fall through — never a fog wall in front of the readable wafers.
 */
export function buildSmokeField(): SmokeField {
  const sprites: SmokeSprite[] = [];
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const x = (hash(i, 1.0) - 0.5) * 2 * SMOKE_SPAN_X;
    const y = (hash(i, 2.0) - 0.5) * SMOKE_SPAN_Y;
    // Push most sprites back; a few drift near the rack plane for parallax.
    const z = SMOKE_Z_BACK - hash(i, 3.0) * SMOKE_SPAN_Z;
    const size = 4.2 + hash(i, 5.0) * 6.0;
    // Deeper sprites are fainter (aerial perspective) — cheap real depth cue.
    const depthT = (SMOKE_Z_BACK - z) / SMOKE_SPAN_Z; // 0 near … 1 far
    const opacity = 0.05 + hash(i, 6.0) * 0.1 * (1 - depthT * 0.5);
    const swayPhase = hash(i, 7.0) * Math.PI * 2;

    sprites.push({
      base: [x, y, z],
      size,
      opacity,
      swayPhase,
    });
  }
  return { sprites };
}

/**
 * Draw a soft circular smoke puff into a 2D canvas ONCE and wrap it as a
 * CanvasTexture. A radial gradient from a faint cool-white core to fully
 * transparent — no external asset, no live filter, generated at module use.
 * Cool tint (very slightly blue) so the void reads "cool smokey", per the brief.
 */
export function makeSmokeTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    // Cool-white core → transparent. Alpha (not colour) carries the puff so it
    // tints correctly against the pale --animus-field void via the sprite colour.
    g.addColorStop(0.0, "rgba(232, 234, 240, 0.9)");
    g.addColorStop(0.35, "rgba(226, 230, 238, 0.45)");
    g.addColorStop(0.7, "rgba(220, 226, 236, 0.12)");
    g.addColorStop(1.0, "rgba(220, 226, 236, 0.0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
