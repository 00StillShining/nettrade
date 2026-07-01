# Actuality — RUNTIME & STACK

**Status:** The honest engineering plan. Decisive, but truthful about risk.
**Core lesson (never violate):** *Chrome previews lied.* Effects stable in Chromium broke in the real WKWebView `.app`. Every gate in this plan verifies in the **real compiled app on the actual Mac**, never in a browser preview.

---

## 1. The decision (and why it changed after scrutiny)

The initial research recommended **Electron + React + react-three-fiber** as primary, on the strength of "Chromium removes the WKWebView risk class." Three adversarial reviews were run against that recommendation — a performance/compositor review, a non-coder-workflow review, and a backend-reuse review. Here is what survived.

### RECOMMENDATION: **Tauri v2 + React 19 + react-three-fiber**, with a hard real-`.app` spike gate. Electron is the **escape hatch**, not the default.

This is a deliberate *inversion* of the original research's primary pick. Reasoning:

- **The backend-reuse review is decisive and factually correct.** The "port to Electron is cheap" claim was wrong in a load-bearing way. `src/adapters/trading212.ts:11` imports `fetch` from `@tauri-apps/plugin-http` — a **native-side HTTP transport that bypasses CORS**. Trading 212 does not send `Access-Control-Allow-Origin` for arbitrary web origins. In Electron's renderer (a real web origin), a naive swap to browser `fetch` makes **every Trading 212 call fail CORS** — silently breaking the app's only data path. The correct Electron port re-plumbs all HTTP through the main process over `contextBridge` IPC: a real transport re-architecture, not a two-module swap. Add the keychain's legacy Phase-0 migration (in `keychain.rs`, ~117 lines, easy to drop on a naive port → orphaned credentials) and the SQLite access-layer rewrite (`@tauri-apps/plugin-sql` → `better-sqlite3`, plus `better-sqlite3` is a native module whose `NODE_MODULE_VERSION`/node-gyp rebuild errors are among the least beginner-legible in the JS ecosystem). **Net: Electron mandates a certain, immediate rewrite of the financial data path — to de-risk one cosmetic 3D screen.** On a read-only trading app, the data path breaking is the worst failure. Bad trade.

- **The performance review is decisive and applies to BOTH engines.** The dominant 60fps risks for *this specific look* are **compositor-stack** risks that are ~90% engine-independent: the mandated CRT overlay re-compositing over live content, overdraw/fill-rate from translucent glass + bloom at Retina 2×, the transition frame stacking full-screen effects, and camera-tracked DOM (`drei <Html>`) re-introducing the visual-vs-hit-test drift. **Electron fixes almost none of these.** It genuinely helps only two things: WebGL context-loss (Chromium handles it better; open Tauri issue #6559) and the WKWebView frame-pacing anecdote (Babylon.js forum). Both are real but narrow — and both are *cheaply testable* with an afternoon spike. So the honest move is: **prove Tauri can't do it before paying to leave it**, since you must apply every compositor mitigation on Electron *anyway*.

- **The non-coder review confirms the fallback's weak point and how to cover it.** The one real hole in "stay on Tauri and gate" is that the user has already run that experiment once and lost weeks — and frame-*pacing* defects are exactly what an untrained eye + screenshot-based tooling struggle to measure (rAF fps probes read 1–2fps in the preview per the `machine-no-node` memory). Cover it with the **inter-frame pixel-diff** technique already proven in the `work-efficiency-visual-bugs` memory (static ≈0.02, janking ≈10) instead of trusting an FPS counter, and by treating the spike as a genuine go/no-go, not a formality.

### What we reject outright (all three reviews agree)
- **Electron as primary** — throws away a working, CORS-solving, Keychain-integrated native backend to de-risk one screen whose risk the isolated-canvas discipline already neutralizes. Kept as escape hatch only.
- **Godot / Unity** — wrong tool for an app that's 80% data-dense forms/tables/charts wearing one atmospheric coat. GDScript is thinner in Claude's training corpus; debugging leaves the DOM-devtools loop that is the non-coder's only safety net. The bespoke comic-collage look is trivial in CSS, brutal in Godot's theme editor.
- **SwiftUI + Metal** — strongest *technically*, but total backend rewrite AND loss of the entire Chrome-DevTools/Preview verification loop. A "someday, if the user learns Swift" path, not now.

---

## 2. How this reuses the existing Rust/Tauri backend

Staying on Tauri means **zero backend churn** — this is the whole point. Verified ground truth:

- **`src/adapters/trading212.ts` (~218 lines TS)** — auth, 1-req/s rate limiter with shared promise queue, 429 backoff, dual-schema defensive parser, decimal.js minor-units normalization. **100% reused, untouched.** This is the crown jewel and it already lives in TypeScript.
- **`@tauri-apps/plugin-http` + `capabilities/default.json`** — the CORS-bypassing native transport scoped to `live.trading212.com` / `demo.trading212.com`. **Reused, untouched.** (This is the load-bearing bridge Electron would have forced us to rebuild.)
- **`src-tauri/src/keychain.rs` (~117 lines)** — the only hand-written Rust; `keyring` crate + Phase-0 legacy credential migration. **Reused, untouched.**
- **`tauri-plugin-sql` + `src/db/*.ts` + migration string in `lib.rs`** — SQLite cache; schema in Rust, queries in TS. **Reused, untouched.**

The 3D/menu work is **additive** — a new isolated WebGL canvas layer + new UI screens. It does not touch the backend at all. That is the safest possible shape for this rebuild.

**If (and only if) the spike gate fails** and we defect to Electron, the honest migration cost is: (1) move all Trading 212 HTTP into the Electron main process via `undici`, expose over `contextBridge` (keep `trading212.ts`'s parser/rate-limiter verbatim, rewrite only its transport line); (2) `keychain.rs` → `safeStorage`/`keytar` **and re-implement the Phase-0 migrate** (or accept one-time re-onboarding); (3) `plugin-sql` → `better-sqlite3` in main, port the migration runner + queries; (4) build the main/preload/renderer shell + IPC. Budget this as **days, with two sharp edges (CORS re-plumb, keychain migration, native-module rebuild)** — not "an afternoon."

---

## 3. Asset pipeline

Sequenced so the risky, expensive work is gated behind the cheap, reversible work.

### 3a. Figma → tokens/layout → code (cheapest iteration surface, do first)
- Build the design system with **Figma Variables** (not just styles) — two token sets / themed modes: **Animus** (dark + red) and **SDN** (paper + amber/teal), plus the shared dark frame. Tokens FIRST, then screens referencing them (retrofitting tokens onto built screens is real rework).
- Use **Dev Mode** + **Code Connect** so Claude reads real component code, not screenshots. Export tokens via Tokens Studio (DTCG JSON) → Style Dictionary → CSS custom properties / TS token file matching VISUAL_DIRECTION §1.
- Flat 2D assets (ink-outline comic panels, icons) → SVG export with `currentColor` for theming.
- The user iterates layout/color here by eye ("no, redder") before any code — this is where a non-coder steers cheaply.

### 3b. Blender → glTF/GLB → react-three-fiber (highest cost/risk — GATED on the spike)
Only the Animus menu needs 3D. Do NOT invest Blender time until §4 Phase-0 spike passes.
- Model wafers/particles in Blender; **apply all modifiers before export** (glTF has no modifier stack). Join meshes that don't need individual raycast. **Principled BSDF only**; pack Occlusion/Roughness/Metalness into one ORM texture. **Bake lighting/AO** (no real-time lights).
- Export **.glb (binary)**. Optimize: `gltf-transform optimize in.glb out.glb --compress draco --texture-compress webp`. Generate the R3F component with **gltfjsx --transform** (Draco + WebP + resize + dedupe + instancing in one pass).
- Budgets: textures 256–512px (2K only for a hero bust), **≤1–2MB per loaded scene**, merge meshes sharing a material (each material ≈ one draw call — critical for the many-wafer strata; use `InstancedMesh`).
- **Tauri asset gotcha:** bundled GLB/textures resolve via Tauri's `convertFileSrc`, not raw relative paths — works in `dev`, 404s in the packaged `.app`. Test in the real `.app`.
- **Permanent fallback (legitimate, not a defeat):** the Animus menu is a *menu*, not an interactive 3D view. If live WebGL is unstable, pre-render the strata + parallax layers from Blender to a sprite sequence / short loop / layered PNGs driven by cursor `transform` — genuine depth illusion, zero runtime WebGL risk. P5 menus are literally this (baked, directed camera, not live 3D).

### 3c. Midjourney → textures / character art (manual-in-loop, usage caveats)
- Use for **paper-grain, ink-wash, halftone textures, backplates, mood-boards** — NOT the app's single "face" asset. Lower legal exposure, matches the tool's real strength.
- **Licensing (get right before shipping):** must be a **paid plan** (any tier) for commercial rights — free-tier grants zero. Pro/Mega only matters above $1M/yr (irrelevant here). Raw AI output is **not independently copyrightable** without meaningful human edit — for anything identity-load-bearing, generate then paint/composite over it in Blender/Figma before shipping (also just better craft).
- Flow stays hands-on: user generates candidates, downloads, hands to Claude to crop/recompress/texture-map. This is the one leg that stays manual by design.

---

## 4. Phased rebuild plan — every gate verifies in the REAL `.app`

The verification loop is the product-saving discipline. **No gate is passed on a Chrome/Playwright/Preview render** — only on the compiled Tauri `.app` on the user's actual Mac, measured with inter-frame pixel-diff (not an FPS counter, which lies about pacing).

### PHASE 0 — The spike gate (do this BEFORE anything else; ~half a day)
Build a ~30-line R3F scene (a few translucent instanced wafers, a camera dolly, additive blending, `frameloop="demand"`, `pixelRatio` capped ~1.5) — **but reproduce the worst frame, not the average:**
- Stack the **baked CRT overlay** over the moving WebGL scene.
- Include a **live-ticking mono telemetry readout** in the DOM beside it.
- Run a **screen-transition** (clip-path wipe) while both are live.

Compile to `.app`, run on the real Mac. **Measure with inter-frame pixel-diff** (static ≈0.02, janking ≈10) across the transition frame specifically.
- **PASS** (smooth in the real app) → proceed on Tauri. This is the expected outcome.
- **FAIL** (WKWebView pacing/context-loss reproduces and can't be tamed by isolated-canvas + demand-frameloop + capped pixelRatio + suspending the CRT during transitions) → **defect to Electron** (§2 migration), having lost half a day, not weeks.

Also resolve the **CRT-blend contradiction here, as a Phase-0 blocker** (VISUAL_DIRECTION §5): the CRT becomes a static, non-blend baked overlay (or baked into the WebGL shader), `pointer-events:none`, suspended during transitions. Do not build the menu until this is settled.

### PHASE 1 — Frame + shell (Tauri, no 3D)
Dark cinematic frame (gradient+vignette+baked facets+static grain), the SDN bezel + telemetry chrome, routing, the two theme token sets. Wire the existing backend (positions, keychain, sync) into a plain flat-DOM Dashboard. **Gate:** real `.app` shows live Trading 212 data through the untouched native transport; no CORS errors; keychain reads/migrates correctly.

### PHASE 2 — SDN data screens (flat 2D, richly textured)
Dashboard → Positions → Watchlist → Performance → Compare → Journal → Settings, per VISUAL_DIRECTION §5. Paper-grain as baked texture on a quad/img (not live CSS filter), ink outlines as flat strokes, radar/pentagon as reusable canvas-2D/SVG component, roster cards, dossier layout. Honest charts per CHART_CRAFT. **Gate:** each screen verified in the real `.app`; single persistent state, pooled/capped canvas-2D contexts (never per-route mount/unmount).

### PHASE 3 — Animus menu (WebGL, gated on Phase 0 PASS)
Blender assets (§3b) → instanced strata, DoF post-pass, projected 2D labels, red selection + camera dolly. **One persistent WebGL context, reused across the app — never mount/unmount per route.** In-scene text/lines only; NO `drei <Html>` for anything interactive. **Gate:** 60fps by pixel-diff in the real `.app` with the CRT overlay composited around it.

### PHASE 4 — Persona transitions
Signature per-screen wipes (`transform`/`opacity`/`clip-path` only), stamped type, speed-differentiated layers, per VISUAL_DIRECTION §4. **Transition effect budget = ONE:** suspend CRT, freeze data DOM, transition lives in the canvas layer, no concurrent framer-motion DOM layout. Re-key nodes per transition (WKWebView clip-path staleness). **Gate:** the transition frame — the peak-load moment — holds pace by pixel-diff in the real `.app`.

### PHASE 5 — Polish + honest-data pass
Bloom/rim/particle tuning, Midjourney textures composited in, Performance-Truth stamp-in beats. Confirm loud motion is navigation-only; numbers stay calm. **Gate:** full real-`.app` walkthrough.

---

## 5. Hard rules (compiled from all three reviews)
1. **Verify in the compiled `.app`, never a preview.** Measure pacing with inter-frame pixel-diff, not an FPS counter.
2. **One persistent WebGL context**, reused app-wide. Pool/cap canvas-2D contexts. Never per-route mount/unmount.
3. **No `backdrop-filter`, no whole-screen live SVG/CSS filter over live content.** CRT is baked + inert + suspended during transitions.
4. **No camera-tracked interactive DOM** (`drei <Html>`). In-scene text/lines; flat DOM panels otherwise.
5. **Transition budget = one full-screen effect.** Suspend CRT + freeze data DOM during transitions.
6. **Cap `pixelRatio` (~1.5), `frameloop="demand"`, additive blending, minimal post-passes** — these are LOOK-driven, required on either engine, not Tauri-only mitigations.
7. **Don't leave Tauri unless the Phase-0 spike fails in the real `.app`.** Backend continuity (CORS transport, keychain migration, SQLite) is worth more than a speculative rendering risk the discipline already covers.

---

## 6. Non-coder honesty notes (things the plan doesn't hide)
- **Code signing / notarization / Gatekeeper** hits both Tauri and Electron: an unsigned `.app` the user double-clicks trips "damaged/can't be opened." Budget a real, non-code step for this regardless of engine.
- **Cost/scope:** £0/month, Mac-first, two users. Tauri's ~3–10MB vs Electron's 80–150MB is irrelevant here — but so is any distribution pressure to *leave* Tauri. Nothing forces Electron; the discipline covers the risk.
- **The spike requires a real go/no-go judgment.** If the user genuinely can't tell whether the spike passed (pacing is subtle), lean on the pixel-diff number, not the eye — that's what it's for.
