// Unit tests for the Animus selection state machine (destinations.ts) — the
// pure logic that drives ←/→ selection and the dive route. Matches the engine
// tests' known-answer style. The scene reads these same helpers, so proving
// them here keeps the visual selection honest and non-wrapping.

import { describe, expect, it } from "vitest";
import {
  DESTINATIONS,
  STACK_COUNT,
  clampSelection,
  moveLeft,
  moveRight,
  routeForSelection,
  selectionForRoute,
} from "./destinations";

describe("Animus destinations", () => {
  it("has exactly 7 stacks (one per screen)", () => {
    expect(STACK_COUNT).toBe(7);
    expect(DESTINATIONS).toHaveLength(7);
  });

  it("maps DASHBOARD to /dashboard (— '/' is the menu itself, the hub)", () => {
    expect(DESTINATIONS[0]).toEqual({ label: "DASHBOARD", route: "/dashboard" });
  });

  it("has unique routes and no stack pointing back at the menu '/'", () => {
    const routes = DESTINATIONS.map((d) => d.route);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).not.toContain("/");
  });

  describe("clampSelection", () => {
    it("clamps below 0 to 0", () => {
      expect(clampSelection(-3)).toBe(0);
    });
    it("clamps above the last index to the last index", () => {
      expect(clampSelection(99)).toBe(STACK_COUNT - 1);
    });
    it("passes valid indices through", () => {
      expect(clampSelection(3)).toBe(3);
    });
  });

  describe("moveLeft / moveRight do NOT wrap (rack, not carousel)", () => {
    it("moveLeft holds at 0 (does not wrap to the last)", () => {
      expect(moveLeft(0)).toBe(0);
      expect(moveLeft(1)).toBe(0);
    });
    it("moveRight holds at the last (does not wrap to 0)", () => {
      const last = STACK_COUNT - 1;
      expect(moveRight(last)).toBe(last);
      expect(moveRight(last - 1)).toBe(last);
    });
    it("walks the middle normally", () => {
      expect(moveRight(2)).toBe(3);
      expect(moveLeft(3)).toBe(2);
    });
  });

  describe("route round-trip", () => {
    it("routeForSelection returns the destination's route (clamped)", () => {
      expect(routeForSelection(1)).toBe("/positions");
      expect(routeForSelection(-1)).toBe("/dashboard");
      expect(routeForSelection(999)).toBe("/settings");
    });
    it("selectionForRoute inverts routeForSelection for every stack", () => {
      for (let i = 0; i < STACK_COUNT; i++) {
        expect(selectionForRoute(routeForSelection(i))).toBe(i);
      }
    });
    it("selectionForRoute returns null for the menu route and unknowns", () => {
      expect(selectionForRoute("/")).toBeNull();
      expect(selectionForRoute("/nope")).toBeNull();
    });
  });
});
