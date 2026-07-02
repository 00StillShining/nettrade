// Unit tests for the Animus wafer-stack layout (waferLayout.ts). The scene
// trusts this to be deterministic (stable across remounts) and correctly
// sized (one InstancedMesh of exactly TOTAL_WAFERS). Known-answer style.

import { describe, expect, it } from "vitest";
import { STACK_COUNT } from "./destinations";
import {
  buildWaferLayout,
  TOTAL_WAFERS,
  WAFERS_PER_STACK,
} from "./waferLayout";

describe("Animus wafer layout", () => {
  it("produces exactly STACK_COUNT × WAFERS_PER_STACK wafers", () => {
    const { wafers } = buildWaferLayout();
    expect(TOTAL_WAFERS).toBe(STACK_COUNT * WAFERS_PER_STACK);
    expect(wafers).toHaveLength(TOTAL_WAFERS);
  });

  it("is deterministic — two builds are byte-identical (no Math.random)", () => {
    const a = buildWaferLayout();
    const b = buildWaferLayout();
    expect(a).toEqual(b);
  });

  it("assigns every wafer to a valid stack, contiguous by instance id", () => {
    const { wafers } = buildWaferLayout();
    wafers.forEach((wf, id) => {
      expect(wf.stack).toBe(Math.floor(id / WAFERS_PER_STACK));
      expect(wf.stack).toBeGreaterThanOrEqual(0);
      expect(wf.stack).toBeLessThan(STACK_COUNT);
      expect(wf.rank).toBe(id % WAFERS_PER_STACK);
    });
  });

  it("fans stacks out symmetrically about x=0", () => {
    const { stackBaseX } = buildWaferLayout();
    expect(stackBaseX).toHaveLength(STACK_COUNT);
    const sum = stackBaseX.reduce((s, x) => s + x, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-9); // centred → sums to zero
    // strictly increasing left → right
    for (let i = 1; i < stackBaseX.length; i++) {
      expect(stackBaseX[i]).toBeGreaterThan(stackBaseX[i - 1]);
    }
  });

  it("keeps brightness/scale jitter in sane bounds (no blown-out additive)", () => {
    const { wafers } = buildWaferLayout();
    for (const wf of wafers) {
      expect(wf.brightness).toBeGreaterThanOrEqual(0.45);
      expect(wf.brightness).toBeLessThanOrEqual(1.0);
      expect(wf.scale).toBeGreaterThan(0.5);
      expect(wf.scale).toBeLessThan(1.5);
    }
  });
});
