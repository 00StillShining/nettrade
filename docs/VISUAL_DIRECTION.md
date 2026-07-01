# Actuality — VISUAL DIRECTION

**Status:** Source of truth for THE LOOK. Read this before touching any pixel.
**Owner:** the look is the deliverable. Function is table stakes; the atmosphere is the product.

This document is executable. Where it says a hex, use that hex. Where it says a technique, use that technique and NOT the one it forbids. It is grounded in seven reference images the user chose; those images are cited inline by filename.

---

## 0. The one-paragraph DNA

Actuality is a **dark, cinematic, diegetic instrument** — you are not "using an app," you are looking into a machine that reconstructs the truth of your trading. The whole product lives on a **dark cinematic frame with real depth** (moody near-black, soft light pools, faint volumetric streaks, subtle 3D recession). Inside that frame, two diegetic surfaces appear:

1. The **MENU** is the *Animus* — translucent data-strata receding into true 3D perspective, near-monochrome bone-white on a pale void, with **one** blood-red selection. (`Assassins-Creed-II01172021-041924-29597.jpg`)
2. The **DATA SCREENS** are the *SDN terminal* — warm cream comic-paper panels with ink outlines, radar/pentagon stat charts, and roster cards with status tags, slotted into a dark CRT bezel. (`Dispatch11072025-014322-52604.jpg`, `dispatch-character.png`)

Movement between screens is **Persona 5 kinetic** — directional wipes, stamped type, speed-differentiated layers, red doing all the emphasis. (`Persona 5 ui (1).jpg`)

Four disciplines hold it together, everywhere, without exception:
- **Real depth, never faked-flat.** Depth comes from 3D geometry (menu), layered translucent planes, gradient+vignette, and parallax — never from a whole-screen CSS/SVG filter over live content (that is the exact thing that bricked the last build).
- **Diegetic framing.** Every screen reads as an in-world device: telemetry tickers, corner brackets, status bars, environmental readouts. The chrome sells "this is real hardware."
- **Character.** The app has a face and a voice — comic-illustrated portraits/glyphs, hand-made collage energy, nothing sterile or "SaaS."
- **Disciplined accent.** One accent does emphasis. Red in the dark/Animus world; warm amber-orange in the paper/SDN world. Never rainbow. Restraint is load-bearing.

---

## 1. Palette (specific hexes)

### 1a. Dark cinematic base (the frame, everywhere)
These are the frame the whole app sits in. Grounded in Dispatch's dark shell + the Concord/Pragmata/Nier dark references.

| Token | Hex | Use |
|---|---|---|
| `--ink-void` | `#0d1117` | deepest background, vignette corners |
| `--ink-base` | `#161b26` | primary dark field |
| `--ink-raise` | `#20263480` `#242938` | raised dark panels, glass fills (with alpha) |
| `--ink-bezel` | `#0d1a1a` → `#141f1f` | CRT terminal bezel (warmer/greener than menu navy) |
| `--ink-trace` | `#1f4a44` | faint teal circuit traces behind terminal panels |
| `--ink-line` | `#ffffff14` | hairline panel strokes / corner brackets (low-opacity white) |
| `--ghost-title` | `#39435a` | "bleeding" ghost display titles (barely above background) |

Facet lines in the dark field: draw at ~15–20°, as faint tonal breaks only (a baked gradient/vertex-colored plane, NOT stacked live CSS gradients).

### 1b. Animus (menu only)
Near-monochrome void + single red. Chase the *relationship* (near-white field, one red), not compressed-JPEG hexes.

| Token | Hex | Use |
|---|---|---|
| `--animus-field` | `#e8e6e2` | pale grey-white data-void (the menu background) |
| `--animus-wafer` | `#dcdad4` (with alpha) | the translucent bone-white strata |
| `--animus-wafer-edge`| `#ffffff` | bright bevel/rim on wafer edges |
| `--animus-red` | `#b01f1f` → `#c0332b` | selected wafer + active category banner (the ONLY saturated color) |
| `--animus-red-hot` | `#e0453a` | leading edge of the red gloss ribbon |

### 1c. SDN paper (data screens)
Warm cream comic-paper + ink + one amber accent (+ teal for secondary status).

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#ece2ce` (`#e8ddc7`→`#ede4d3`) | cream panel fill (carries paper-grain texture) |
| `--paper-panel-2` | `#d8cbb0` | tan/khaki utility-panel headers |
| `--ink` | `#2b241c` | warm near-black ink outlines (NOT pure black), ~3px |
| `--ink-body` | `#3a3128` | dossier body text on paper |
| `--amber` | `#e8842a` | THE accent — CTA, selected, positive, status pill, ENTER key |
| `--amber-deep` | `#c96a1c` | amber pressed/hover |
| `--teal-status` | `#2a9d9d` | secondary status only ("BUSY"/neutral) |
| `--radar-max` | `#8a7a3a` @ ~55% | radar "max potential" polygon (olive/gold) |
| `--radar-now` | `#5a8a5a` @ ~55% | radar "current" polygon (green) |
| `--panel-red` | `#c0332b` | comic caption header bar (e.g. mission/alert titles) |

**Cross-world discipline:** amber is the single accent that appears in BOTH the dark shell (badges, subtitles) and the paper content (pills, selected card glow). That continuity is what makes the two material systems feel like one product. Red is reserved for the Animus menu and for genuine alerts/loss; amber for interaction/selection.

**P/L semantics (this is a trading app):** gains = a restrained green wash on paper (`--radar-now` family, not neon); losses = `--panel-red`; the Performance-Truth split (deposits/withdrawals vs realised vs unrealised) uses neutral ink for cash-flow and reserves color strictly for realised/unrealised P/L so the eye reads truth, not noise.

---

## 2. Type system

Three tiers, each doing a specific job (this alone sells "real device"):

1. **Display / condensed** — tall, tightly-tracked, geometric condensed sans, wide letter-spacing, ALL-CAPS for chrome. Menu category labels, card header ribbons, screen titles. Reference face class: Oswald / Bebas Neue / a condensed grotesque.
   - In the dark shell it renders as `--ghost-title` (bleeding, low-contrast, soft outer glow — embedded in the atmosphere, not printed on top).
   - In paper it renders solid ink or white-on-color-bar.
2. **Humanist body** — warmer humanist sans (or humanist serif) for in-world "written" content: journal notes, position detail, dossier-style key/value pairs (AGE/HEIGHT-equivalent → SYMBOL/QTY/AVG). Legible at length, clearly distinct from the shouty display face. (`dispatch-character.png` uses exactly this two-tier split.)
3. **Monospace telemetry** — Space Mono / a mono for ALL system chrome: tickers, status bars, coordinates, timestamps, rate-limit/last-synced readouts. Monospace is the universal shorthand for "machine-generated" and does the most diegetic work per pixel.

Rules: never animate `font-size`/`letter-spacing`/`text-shadow blur` per frame (reflow/repaint). Type "stamps" in via `transform`+`opacity` only (see §4). Keep numeric/data type calm and legible — theatrical energy lives in navigation, not in the numbers.

---

## 3. Depth & atmosphere techniques (what to use, what to ban)

Depth is built from cheap, GPU-safe primitives PLUS real 3D only where it matters. The banned list is the prior failure; treat it as law.

### USE (safe in WKWebView/Chromium):
- **Gradient + vignette backdrops** — pure CSS radial/linear layers, dark edges → lighter center. Highest value-per-effort depth cue; used by every dark reference. GPU-composites as a flat layer.
- **Translucent glass** — flat semi-transparent color (`rgba`) over a **pre-blurred static background asset**. NEVER live `backdrop-filter` (confirmed broken in Tauri/WKWebView, and it's the class that bricked us).
- **Rim light** — `box-shadow`/`border` bright edge glow, or a pre-rendered rim-highlight sprite. Cheap. (True view-angle fresnel only inside the WebGL menu.)
- **Bloom / glow** — layered soft radial gradients or a blurred PNG "glow" sprite behind bright elements (active numbers, red selection, amber pills). Not a per-element live filter.
- **Parallax / layering** — `transform`+`opacity`-only layers at different Z (`perspective`+`translateZ`), driven by cursor/idle. Keep ≤5 layers/screen; `will-change:transform` only on actively-animating layers, removed after.
- **DoF approximation** — a fixed `filter: blur(Npx)` on *inert, non-interactive background* decorative layers (e.g. receding strata behind the focused panel). `filter:blur` on a normal element ≠ `backdrop-filter`; it's stable because it blurs the element's own content once. Never on animating or interactive layers.
- **Grain / dither / scanlines** — a single static (or slow `background-position`) noise/scanline PNG at low opacity via `mix-blend-mode`. This is the Nier trick — a texture asset, not a live filter. **See the CRT caveat in §6.**
- **Subtle real 3D** — WebGL/WebGPU **canvas** (Three.js / react-three-fiber) as its own layer, DOM UI absolutely-positioned over it. Reserved for the Animus menu + screen transitions. WebGL did NOT cause the brick; CSS SVG filters did.

### BAN (these bricked the last build or are documented-broken):
- `backdrop-filter` anywhere in the Tauri shell.
- Whole-screen `feDisplacementMap` / SVG displacement "CRT barrel curve" over live interactive content.
- Any full-screen live filter that must re-rasterize when content beneath it animates.
- Animating `width/height/top/left/margin`, or `box-shadow` blur radius, per frame.
- Camera-tracked interactive DOM (`drei <Html>`) for anything clickable — it re-introduces the visual-vs-hit-test drift bug. In-scene text/lines for labels; flat DOM panels beside/over the canvas otherwise.

---

## 4. Motion language (Persona 5, concretely)

Motion is functional: it (a) guides attention, (b) smooths hard cuts, (c) telegraphs state change. Every flourish earns its place. Reference: `Persona 5 ui (1).jpg` (ransom-note cutout type, diagonal red guide-lines, single-accent emphasis).

**Primitives (only these three CSS properties animate): `transform`, `opacity`, `clip-path`.**

- **Signature directional wipes.** Each navigation direction gets a consistent wipe as a learnable vocabulary. Concretely:
  - Going **deeper** (Menu → a screen; Dashboard → a Position detail): wipe left→right via `clip-path: inset()` + paired `transform: scale()`.
  - Going **back out**: the reverse wipe.
  - Lateral peer moves (Positions ↔ Watchlist): a diagonal top-right→bottom-left sliding shape (the P5 camera-cut bridge).
  - Assign each of the 7 screens one signature and keep it forever.
- **Stamped type.** Titles/figures don't fade — they're placed like a physical cutout: each word/letter is its own node, `translateY`+`opacity`+slight `rotate`, staggered 30–60ms. When new Performance-Truth data lands, the figure "stamps" onto the paper panel with a subtle halftone/ink-burst (our diegetic equivalent of P5's hand-reach / shell-eject beat).
- **Speed-differentiated layers.** Background art layer moves slow (or static); foreground chrome moves fast. Two `transform`-only layers = "depth" for free. This is the single most reproducible P5 feel.
- **Easing & timing.** Camera/wipe tweens ~400–600ms, ease-out-expo class. Keep DoF-focus tween (menu) synced to the same duration. Idle motion is slow and restrained (wafers breathe, particles drift) — too much reads try-hard/glitchy.
- **The transition is the peak-load frame — budget = ONE effect.** During any transition: suspend the CRT overlay, freeze/snapshot the data DOM, run the whole transition inside the single WebGL/canvas layer, and do NOT run a concurrent framer-motion DOM layout animation. Stacking full-screen effects is exactly what turned the last build into a brick.
- **Discipline.** No kinetic flourish on routine numeric ticks — that undermines the honest-data ethos. Loud motion is for navigation only; data rendering stays calm.
- **WKWebView `clip-path` caveat:** WKWebView caches `clip-path` on the GPU layer and can go stale mid-transition. Fix: re-key/re-mount the transitioning node per transition (don't repeatedly reset the same element's clip-path), or force a reflow (`void el.offsetHeight`) after reset.

---

## 5. Per-screen application

Every screen sits on the **dark cinematic frame** (§1a): near-black field, soft top-left light pool, faint 15–20° facet lines, vignette, static grain overlay. The frame never changes; the surface inside it does.

### MENU — Assassin's Creed "Animus" strata  (`Assassins-Creed-II...jpg`)
- **Layer:** WebGL/react-three-fiber canvas. This is the ONE place with true 3D.
- **Look:** 7 vertical stacks of thin translucent "wafers" (one per destination: Dashboard, Positions, Watchlist, Performance, Compare, Journal, Settings), arranged in one-point perspective receding into -Z, camera slightly above looking across. Nearest/selected stack is largest; far stacks compress and soften (real DoF). Pale `--animus-field` void, drifting diamond particles at multiple depths, faint diagonal light-streaks.
- **Selection:** the selected wafer + its category banner go `--animus-red` (a red gloss ribbon, dark→hot at the leading edge, diamond bullet). Red is the ONLY color. Selecting = camera dolly + rack-focus to that stack; the red band physically travels the wafer stack.
- **Labels:** projected 2D overlay (project the 3D wafer's world pos to screen each frame; draw crisp DOM/canvas text + leader-line). NEVER 3D-baked text.
- **Bottom chrome:** a frosted context bar ("Actuality" + a red diamond) and quiet key prompts, sitting at the shallowest depth (HUD plane in front of the scene).
- **Build discipline:** `InstancedMesh` for wafers; additive/screen blending to sidestep transparency sort artifacts; `frameloop="demand"`; capped `pixelRatio` (~1.5); one DoF post-pass max. No floor/skybox — depth is entirely the UI geometry.

### DATA SCREENS — Dispatch "SDN" terminal on the dark frame
All six share the SDN grammar (`Dispatch11072025-014322-52604.jpg`, `dispatch-character.png`): dark teal-black CRT bezel with thin double-line rounded border + faint chromatic-aberration fringe on corner brackets/logo (baked into a static asset, not live); circuit-trace texture in the deadspace between bezel and cream; a top "Actuality ·SDN-style" wordmark + mono telemetry ticker; a persistent bottom mono status bar (`last synced · rate-limit · account · demo/live · connection`). Cream panels never touch the bezel edge — dark deadspace always frames them (card-slotted-into-a-scanner logic). Cream panels carry paper-grain, ink outlines (~3px `--ink`), solid-color header ribbons, rounded corners.

- **Dashboard** — the "mission briefing" layout. Center hero panel with a red caption ribbon ("PERFORMANCE TRUTH") over a cream panel holding the headline split: **Deposits/Withdrawals** (neutral ink) vs **Realised P/L** vs **Unrealised P/L**, each a bold labeled figure that *stamps* in on refresh. A **radar/pentagon** summarizing account health (e.g. exposure / realised / unrealised / cash / risk) rendered as the woodcut-parchment radar (dark-brown grid on cream, one or two `--radar-*` polygons at ~55%, icon-roundel axes). Amber `100%`-style status pill = "synced." Left/right utility panels ("HOLDINGS", "TODAY") mirror PURSUIT/REQUIREMENTS. Environmental-readout equivalents top-right: market open/closed, currency, last tick.
- **Positions** — the **roster-card strip** is the native fit. Each open position = a vertical card: colored status ribbon header (green "OPEN" / amber "PENDING" / grey "CLOSED"), a "portrait" = the ticker logo or a generated abstract glyph on a muddy utility-brown ground, a small pentagon-badge (that position's P/L glyph), and a tan caption bar with the symbol. Selected card = full `--amber` border glow. Rows read like a hero database (`dispatch-character.png` bottom strip).
- **Watchlist** — same roster grammar as Positions but "at rest": neutral/teal status tags, no P/L glow, quieter portraits. Selecting one can wipe (deeper) into a mini-dossier (price, spread, your note).
- **Performance** — the **dossier** layout (`dispatch-character.png` left panel). Large cream panel: a painterly/abstract "splash" of the equity curve on the left, structured **bold-label / plain-value** pairs on the right (PERIOD, REALISED, UNREALISED, FEES, NET, BEST/WORST), a skeuomorphic physical scrollbar thumb. The equity curve is honest canvas-2D per CHART_CRAFT (ink-stamp, no chartjunk), skinned onto paper. Realised vs unrealised drawn as the two-polygon radar or a dual line, both restrained.
- **Compare** — two (or more) dossier/roster cards side by side, each with its own radar/pentagon, overlaid or adjacent so the shapes read against each other (the radar's whole point is silhouette comparison). Amber marks the "winner"/selected axis; a lateral wipe swaps candidates.
- **Journal** — the **written-content** surface: cream paper, humanist body font, entries as ink-outlined note cards with a small date caption ribbon and optional tag chips ("★ WIN" / "☠ MISTAKE", ink-outline pills on cream). This is where the humanist type tier shines; keep it the calmest, most "paper," least kinetic screen.
- **Settings** — cream "control panel" dossier: labeled rows (API key status, account demo/live, sync interval, theme), toggles/keycap-style buttons (the beveled "LSHIFT"/"ENTER" keycap language), an amber primary action ("SAVE"/"RECONNECT"). API-key entry framed as slotting a credential into the device. Keep the diegetic telemetry bar showing connection/keychain status honestly.

### Framing note that resolves the CRT tension
The design bar wants a CRT feel on every screen, but a full-screen live `mix-blend-mode`/SVG-filter CRT over animating content is the brick risk. Resolution: the CRT is **baked** — a static bezel/vignette/scanline PNG asset (or baked into the WebGL layer's own shader), `pointer-events:none`, its own inert layer, and **suspended during transitions**. It reads as CRT without ever re-compositing over live content. This is a hard rule, not a preference.

---

## 6. Anti-slop checklist (what makes knockoffs look wrong)
- Flat 2D cards with CSS `perspective` + drop-shadow instead of real parallax → reads flat instantly. (Menu must actually parallax.)
- Uniform, un-jittered translucency → looks like wallpaper. Vary per-wafer opacity/jitter; add contact shadow in the gaps.
- No depth of field on the menu → collapses to a diagram.
- Over-saturating the palette → kills the diegetic read. One accent per world. Full stop.
- 3D-baked / perspective-skewed text → amateur. Text stays flat via projected overlay.
- Static or linear robotic motion → slideshow. Idle drift + eased tweens, restrained.
- Adding a floor/room/skybox to the Animus → breaks the data-void.
- "Clean SaaS" flatness → the opposite of this brief. The SDN paper panels carry hand-made comic energy — hard ink strokes, a few degrees of tilt on *accents*, textured cream — but the working DATA grid stays aligned and calm (see the `actuality-ui` skill §1–2: character on the frame, clarity in the data).
- `backdrop-filter` / whole-screen live filters → the literal prior brick. Banned.

---

## 7. Reference index (the user's chosen pixels)
- `…/NT ui examples/Assassins-Creed-II01172021-041924-29597.jpg` — Animus strata (MENU).
- `…/Dispatch11072025-014322-52604.jpg` — SDN mission terminal (Dashboard grammar).
- `…/NT ui examples/dispatch-character.png` — SDN hero database (dossier + roster + radar).
- `…/Dispatch11072025-013424-15917.jpg` — Dispatch dark shell (frame + tilted cards + ghost title).
- `…/NT ui examples/Persona 5 ui (1).jpg` — kinetic motion, ransom-note type, single-red emphasis.
- `…/NT ui examples/Concord09072024-043645-61103.jpg`, `pragmata-status.png`, `Cyberpunk ui (1).jpg`, `Nier-Automata…jpg` — dark-cinematic depth/atmosphere (gradient+vignette, layered glass, baked grain, rim glow — all faked cheaply, none via live whole-screen filters).
