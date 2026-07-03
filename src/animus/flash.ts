// flash.ts — the white "load memory" flash, hoisted OUT of the Animus component
// so it SURVIVES the route swap. In the reference (menu.html) the #flash element
// is a <body>-level div and loadMemory() drives its opacity: cover (~240ms) →
// navigate under the cover → fade (~0.7s) over whatever is now mounted. Here the
// Animus component unmounts at the cover point (route "/" → a data screen), so
// the element can't live inside it. Instead <AnimusFlash/> in App.tsx renders a
// persistent element and registers it here; triggerFlash() runs the reference's
// exact flash grammar and calls navigate() at the cover point.
//
// Plain module-scoped singleton — no React context needed (the brief's
// instruction). The element is a stable DOM node; we drive it with the same
// inline-style opacity/transition writes the reference used.

let flashEl: HTMLElement | null = null;

/** Registered by <AnimusFlash/> once mounted. */
export function registerFlashEl(el: HTMLElement | null): void {
  flashEl = el;
}

// Timings mirror the reference's loadMemory(): 0.22s ease-in cover, hold while
// the route swaps under it, then 0.7s ease-out fade. COVER_MS is the reference's
// 240ms "setTimeout(...,240)" beat — the point at which the cover is opaque and
// it's safe to swap the route beneath it.
const COVER_MS = 240;

/**
 * Run the load-memory flash and navigate under its cover. The caller (Animus)
 * fires SFX.thunk()+SFX.whoosh() itself (it owns the AudioContext), exactly as
 * the reference's loadMemory() does, then calls this to drive the visual cover +
 * the navigation.
 *
 * @param navigate  the react-router navigate fn
 * @param route     destination route, e.g. "/dashboard"
 */
export function triggerFlash(navigate: (route: string) => void, route: string): void {
  const el = flashEl;
  if (!el) {
    // No flash element mounted (shouldn't happen once App renders) — navigate
    // anyway so the action never silently no-ops.
    navigate(route);
    return;
  }
  // Cover — reference: flashEl.style.transition="opacity .22s ease-in"; opacity=1
  el.style.transition = "opacity .22s ease-in";
  el.style.opacity = "1";
  // At the cover point, swap the route UNDER the opaque flash, then fade the
  // flash out over the freshly-mounted screen (reference: 0.7s ease-out). The
  // fade is driven from a macrotask (setTimeout), NOT rAF: rAF is suspended for
  // a backgrounded tab, which could otherwise leave the white cover stuck opaque
  // if the window lost focus mid-dive. A short delay still lets the routed
  // screen mount + paint one tick beneath the cover before the reveal begins.
  window.setTimeout(() => {
    navigate(route);
    // Hold the cover a beat longer before revealing: react-router v7 wraps
    // navigation in startTransition and a heavy screen (Dashboard mounts many
    // canvases) can commit/paint AFTER a 32ms reveal has already dropped the
    // cover to ~70-90% opacity — faintly exposing the raw swap. 250ms of extra
    // hold absorbs that; the reference itself held its flash far longer.
    window.setTimeout(() => {
      el.style.transition = "opacity .7s ease-out";
      el.style.opacity = "0";
    }, 250);
  }, COVER_MS);
}

/**
 * bootFlash — the reference's finishBoot() bloom: a quick white kiss (opacity
 * 0.55) that fades out over 0.5s as the camera flies in. Runs on the same
 * hoisted element (available at "/" because App.tsx always renders
 * <AnimusFlash/>). Kept verbatim to the reference's timings.
 */
export function bootFlash(): void {
  const el = flashEl;
  if (!el) return;
  el.style.transition = "opacity .12s";
  el.style.opacity = "0.55";
  window.setTimeout(() => {
    el.style.transition = "opacity .5s";
    el.style.opacity = "0";
  }, 140);
}
