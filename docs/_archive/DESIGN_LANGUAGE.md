# NETTRADE — Design Language: "NEON-METAL PHANTOM"

A scuffed-metal cyberpunk trading station charged with Persona-5-style kinetic
comic-collage energy. Harsh contrast, glowing neon orange, rich drifting smoke,
outlined + jittered display type, skewed metal tabs, comic halftones.

> Bangers (the display/title font) is an **approximation** of the proprietary
> Persona-5 font; it carries the same hand-placed comic energy.

## Where to tune everything (one place each)

All knobs live in **`src/styles/tokens.css`** as CSS variables, re-exposed to
Tailwind in **`tailwind.config.js`**. Change a value once, the whole app follows.

| Knob | Token(s) in `tokens.css` | Notes |
|------|--------------------------|-------|
| **Palette** | `--orange`, `--orange-deep`, `--red`, `--cyan`, `--teal`, `--ink`, `--paper`, `--peri`, `--rust` | Primary signal = orange; hot = red; cool = cyan/teal. |
| **Glow** | `--glow-text`, `--glow-text-hot`, `--glow-text-soft`, `--glow-cyan`, `--glow-drop`, `--glow-box` | Text/icon/box glow recipes. Active glows brighter than idle. |
| **Metal** | `--metal-sheen`, `--metal-brush`, `--metal-base`, `--metal-shadow`, `--metal-active*`, `--metal-recess*` | Layered gradients for the brushed/beveled light-silver surface + orange active + dark recessed slab. |
| **Skew** | `--skew` (-12°), `--skew-soft` (-9°) | Parallelogram tab angle. Children counter-skew with `.nt-unskew`. |
| **Smoke** | `--smoke-drift`, `--smoke-displace` + JS drift in `SmokeBackground.tsx` | feTurbulence + feDisplacementMap. Palettes: `ember`, `ice`. |
| **Motion** | `--dur-*`, `--ease-snap` + Framer springs in components | Spring entrances (stiffness/damping/delay) live in `StationRow`, `MainMenu`. |

## Signature components (`src/components/`)

- **MetalPanel** — THE single source for all light scuffed-metal surfaces.
  Layered gradient base (tokens) + feTurbulence wear overlays + a JS canvas
  scuff/bolt scatter (`useScuff`). Props: `active`, `recessed`, `scuff`, `bolts`.
- **SmokeBackground** — full-bleed drifting marbled smoke (`palette="ember"|"ice"`).
- **P5Text** — outlined + per-character jittered Bangers display type.
  `variant="ink"` (white fill / red offset) · `"orange"` · `"cyan"` (glow fills).
- **ShardPanel** — torn-metal plaque (angular SVG + wear) behind the title.
- **StationRow / KineticList** — skew-tab station slabs; KineticList owns the
  staggered spring entrance + keyboard nav (Up/Down move active, Enter launches).
- **LedReadout** — Share Tech Mono numbers on a recessed slab + scanline + LIVE dot.
- **AccountToggle** (`NeonButton.tsx`) — You/Partner/COMBINED segmented control.
- **Halftone**, **ComicBubble**, **Silhouette**, **BrandMark**, **DataSculpture**
  — comic decoration + original focal art + the topographic value sculpture.

## Motion & accessibility

Framer Motion drives explosive spring entrances (overshoot then settle),
selection pop, idle wobble on decoration, smoke drift, and the sculpture draw-on.
`prefers-reduced-motion` calms it hard everywhere (simple fades, no jitter/drift)
via the `calm`/`reduce` flags and a global CSS override in `index.css`.

## Screens

- `src/screens/MainMenu.tsx` — Phase 1 (the POSTER composition).
- `src/screens/Dashboard.tsx` — Phase 2 data-sculpture command center (6 charts +
  Performance-Truth panel + position roster). Ember smoke.
- `src/screens/Settings.tsx` — Phase 2 options screen (skew tab bar + working
  Slider/Toggle/Dropdown controls + Apply/Reset). Ice smoke.
- Router lives in `src/App.tsx` (HashRouter): `/`, `/dashboard`, `/settings`;
  unbuilt stations redirect to `/`. `src/data/stations.ts` carries each route.

## Charts (`src/charts/`)

Shared themed Recharts wrappers — every chart matches the language.
- `theme.ts` — series colours (neon-orange primary + teal/peri/rust supports),
  grid/axis styling, Space-Mono axis font, donut/bar palette.
- `ChartPrimitives.tsx` — shared `<defs>` (glow filters, area gradients, dot
  pattern), themed dark-glass `ChartTooltip`, shared `axisProps`.
- `ChartCard.tsx` — dark-glass chart card with a skewed shard accent + header.
- `charts.tsx` — ValueArea (+deposits overlay), HoldingsDonut, PLSplitBar,
  GrowthGauge (radial), DrawdownLine, PerStockBar, Sparkline.

Shared dataset: `src/data/portfolio.ts` (TRUTH figures, HOLDINGS, value/drawdown
series, formatters). Tune chart colours in `src/charts/theme.ts`.
