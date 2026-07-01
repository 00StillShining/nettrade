# NETTRADE — CREAM & PIGMENT

The single design language for every NETTRADE screen. A tasteful synthesis of
**Bomb Rush Cyberfunk** (slate/options menus, liquid marble), **Dispatch**
(cream paper panels, framed restraint) and **Persona 5** (bold stylisation,
exaggerated angles). Not a copy — a disciplined system. The base layout is
**SLASH**: one extreme diagonal that splits calm cream from a dramatic marble
wedge.

The whole system is **restraint vs drama**. Calm, generous cream paper is
violated by ONE or TWO hard-angled sections of textured colour. That tension is
the look. When in doubt, remove — never crowd.

---

## 1. Surface system

- **Dominant surface = warm off-white / cream paper.** Most of every screen is
  cream with generous negative space.
- **Contrast = one (max two) dramatic colour section** — a hard-angled block
  filled with slow-drifting **liquid marble** and/or solid saturated colour with
  halftone. One restrained dark/ink section is allowed.
- The main menu is deliberately **spare** (cream + one marble wedge + title +
  the 7-item list). Data-heavy screens (charts, rosters, positions) spend their
  density inside the cream field — the marble/colour section stays a contained
  accent, never the canvas.

## 2. Colour (disciplined — not everything-shouting)

| Token | Hex | Role |
|---|---|---|
| `--cream` | `#EDE6D2` | dominant paper |
| `--cream2` | `#F2ECE0` | lighter paper / knockout type |
| `--ink` | `#14110D` | all type, hairlines, frames, hard shadows |
| `--orange` | `#FF5A1F` | THE single signature accent |
| marble purple | `#5D5A86` (+ light `#7370A0`) | dominant marble vein |
| marble orange | `#E8632A` | minority marble vein |
| marble teal | `#2FB5A8` | restrained marble vein |
| marble near-black | `#1A1622` | minority marble vein |
| gain / loss | `#2FB5A8` / `#C8402F` | tiny, used at most once |

Rules: cream + ink + ONE orange signature + the marble palette. **No rainbow.**
Orange appears on the title, the active item, and one key slash/rail — sparingly.
The marble is **purple-dominant** (~60%) with orange/black/teal as minority veins.

## 3. Angles (push much harder than a normal UI)

- One **extreme diagonal** is the spine of every layout (the SLASH). Section
  boundaries are hard diagonals, never level.
- Menu/list items are **sheared parallelograms** (`skewX(-11deg)`, content
  counter-skewed back), `clip-path` for the angles, cascading off-grid down the
  diagonal axis — not a tidy centered stack.
- Title is **rotated into the angle** (-7deg).
- **`border-radius: 0` everywhere.** No exceptions.
- **Hard zero-blur offset shadows only:** `box-shadow: 7px 7px 0 var(--ink)`.
  Never soft/blurred. Active/hover deepen the offset (9–11px) to kick out.
- A thin **orange rail** may run just inside the slash edge as the dramatic
  boundary accent; the slash itself is a hard ink line.

## 4. Type

- **Display:** `Unbounded` 700–900 for the title and menu names — funky, heavy,
  uppercase.
- Title is **knockout**: orange `NET` (ink offset shadow) + cream `TRADE`
  (orange offset shadow), `-webkit-text-stroke: 5px var(--ink)`,
  `paint-order: stroke fill`, rotated into the slash.
- Active item **inverts** to solid orange with cream type.
- **Labels:** `Oswald` 600/700 uppercase, wide letter-spacing — ONLY for the
  tiny index numbers and the status segments. Never for body prose.
- `Anton` is available as an alternate heavy condensed display face.
- **Banned:** system-ui / Inter / Roboto / any thin weight.

## 5. Text discipline (critical)

The ONLY words on the **main menu** are the **title** ("NET TRADE") and the
**7 menu names** (Dashboard / Positions / Watchlist / Performance / Compare /
Journal / Settings). The single permitted extra is a tiny segmented account
status (`YOU / PARTNER / COMBINED`). Per-item taglines are allowed ONLY if they
stay tiny and clean — when in doubt, drop them.

**No** decorative scrawls, slogans, sub-captions, mascots/masks/character art,
or controller button-prompts (✕/A/B/X glyphs — this is a **desktop** app).
Other screens add only the data they exist to show, nothing decorative.

## 6. Texture

- **Ben-day halftone dots** over the cream (`radial-gradient` dot grid,
  low opacity ~6%), clipped to the cream side of the slash.
- A small **halftone dot cluster** flourish may drift from the boundary into the
  cream (BRC touch) — used once, low opacity.
- **Liquid marble** fills the colour wedge via inline SVG:
  `feTurbulence` (large low-freq base) → `feDisplacementMap` domain-warp (second
  turbulence) → `feComponentTransfer type="discrete"` with a **purple-weighted**
  table for crisp flowing veins. Aim for liquid ribbons, **never camouflage
  blobs**. A diagonal ink gradient deepens the far corner; a multiply halftone
  overlays the dark edge with printed dots.
- Optional full-frame grain at very low opacity, `mix-blend-mode: multiply`.
- Hard printed edges throughout. Tasteful, not noisy.

## 7. Motion (capture a clean still)

- Marble **drifts** slowly (~26s, translate/scale/rotate, ease-in-out alternate).
- Menu items **kick/skew** on hover (translateX + deepened offset shadow).
- Active item **inverts** to solid orange and kicks out with an ink arrow marker.
- `@media (prefers-reduced-motion: reduce)` disables drift and transitions.
- Every screen must look great as a **still** — motion is a bonus, never a crutch.

## 8. Output contract

Each screen is a complete standalone HTML document, **fixed 1512×982,
`overflow: hidden`**, self-contained (inline `<style>`, inline `<svg>` for
marble/halftone, vanilla JS), Google Fonts only (`Unbounded`, `Anton`,
`Oswald`). Rendered by headless Chrome at 1512×982 and verified as a screenshot
against this principle before it ships.
</content>
</invoke>
