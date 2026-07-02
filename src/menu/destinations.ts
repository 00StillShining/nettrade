// Actuality — Animus menu destinations (Phase 3a).
//
// The 7 wafer-stacks of the Assassin's-Creed "Animus" menu, one per screen
// (VISUAL_DIRECTION.md §5 MENU). Order here IS the left-to-right order the
// stacks recede in one-point perspective, and the order ArrowLeft/Right walk.
//
// Pure data + pure helpers only — no three.js, no React — so the selection
// logic is unit-testable and can't drift from what the scene renders.

export interface Destination {
  /** Screen name shown in the projected label + HUD (ALL-CAPS display voice). */
  readonly label: string;
  /** HashRouter route the dive navigates to. */
  readonly route: string;
}

/** The 7 destinations, in stack order (index 0 = leftmost).
 * NOTE: "/" is the Animus menu itself (home), so DASHBOARD dives to
 * "/dashboard" — the menu is the hub, the seven stacks are the screens. */
export const DESTINATIONS: readonly Destination[] = [
  { label: "DASHBOARD", route: "/dashboard" },
  { label: "POSITIONS", route: "/positions" },
  { label: "WATCHLIST", route: "/watchlist" },
  { label: "PERFORMANCE", route: "/performance" },
  { label: "COMPARE", route: "/compare" },
  { label: "JOURNAL", route: "/journal" },
  { label: "SETTINGS", route: "/settings" },
];

export const STACK_COUNT = DESTINATIONS.length;

/**
 * Clamp a selection index into range. Selection does NOT wrap: the Animus is a
 * physical rack; walking off the left/right end simply holds at the end wafer
 * (an unmistakable, non-surprising affordance — usability doctrine §1).
 */
export function clampSelection(index: number): number {
  if (index < 0) return 0;
  if (index > STACK_COUNT - 1) return STACK_COUNT - 1;
  return index;
}

/** Move selection left (toward index 0), clamped. */
export function moveLeft(index: number): number {
  return clampSelection(index - 1);
}

/** Move selection right (toward the last stack), clamped. */
export function moveRight(index: number): number {
  return clampSelection(index + 1);
}

/** The route a dive from `index` navigates to (clamped for safety). */
export function routeForSelection(index: number): string {
  return DESTINATIONS[clampSelection(index)].route;
}

/** Map a route back to its stack index, or null if the route isn't a stack. */
export function selectionForRoute(route: string): number | null {
  const i = DESTINATIONS.findIndex((d) => d.route === route);
  return i === -1 ? null : i;
}
