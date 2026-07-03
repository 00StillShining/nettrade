// Unit tests for the Animus smoke field (smoke.ts) — the deterministic resting
// layout the perpetual-fall atmosphere drifts. The scene trusts this to be
// stable across remounts (no Math.random) and correctly sized. Known-answer
// style, matching waferLayout.test.ts. Only the pure builder is exercised here;
// makeSmokeTexture needs a DOM canvas and is verified in the real app, not node.

import { describe, expect, it } from "vitest";
import { buildSmokeField, SMOKE_COUNT, SMOKE_SPAN_Y } from "./smoke";

describe("Animus smoke field", () => {
  it("produces exactly SMOKE_COUNT sprites", () => {
    const { sprites } = buildSmokeField();
    expect(sprites).toHaveLength(SMOKE_COUNT);
  });

  it("is deterministic — two builds are byte-identical (no Math.random)", () => {
    expect(buildSmokeField()).toEqual(buildSmokeField());
  });

  it("keeps every sprite inside the wrap span and behind the rack plane", () => {
    const { sprites } = buildSmokeField();
    for (const sp of sprites) {
      // Resting Y within the field's vertical span (the fall loop wraps here).
      expect(Math.abs(sp.base[1])).toBeLessThanOrEqual(SMOKE_SPAN_Y / 2 + 1e-9);
      // Smoke sits at/behind the rack (never in front of the readable wafers).
      expect(sp.base[2]).toBeLessThanOrEqual(-2.0 + 1e-9);
      // Soft, bounded opacity — the void is depth, never an opaque wall.
      expect(sp.opacity).toBeGreaterThan(0);
      expect(sp.opacity).toBeLessThan(0.2);
      expect(sp.size).toBeGreaterThan(0);
    }
  });

  it("keeps the wrap span an exact multiple of the rack wrap (seamless reset)", () => {
    // AnimusScene resets the shared fall accumulator by RACK_WRAP_Y = 9; the
    // smoke span must be a whole multiple of it so the reset is seamless.
    expect(SMOKE_SPAN_Y % 9).toBe(0);
  });
});
