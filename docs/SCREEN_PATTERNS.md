# Actuality — SCREEN PATTERNS (locked laws for every data screen)

**Status:** Source of truth for data-screen LAYOUT + behaviour. Established on the
Phase-1 Dashboard (2026-07-01) and signed off by the user ("really happy with this
screen"). These are laws, not suggestions — apply them to every data screen
(Positions, Watchlist, Performance, Compare, Journal, Settings). Complements the
`actuality-ui` skill (the look + usability doctrine) and `VISUAL_DIRECTION.md`.

---

## 1. Fill the space — no aimless deadspace
Empty area is a bug, not breathing room (breathing is *intentional* space around the
hero only). Every gutter earns its keep with **useful, honest** supporting info.
- Stretch panels to the working width (`max-width: ~1600px`, centred). Never a narrow
  floating centred column with empty sides.
- Dashboard proof: a right **rail** (Top Gainers / Top Losers / Allocation-with-bars /
  Snapshot) fills beside the holdings table; the hero band carries micro-stats
  (Invested / Unrealised / Positions / Best / Worst) + an allocation bar.
- This is the Dispatch **PURSUIT / REQUIREMENTS** briefing grammar: a main column
  flanked by supporting utility panels.

## 2. Future-proof for growing data — internal scroll, viewport-locked
The screen fits **one window** (NO page scroll — it is a fixed instrument / CRT, it
does not scroll as a whole). Data lists scroll **inside their own panels**. The frame
(hero, chrome bars, rail) stays anchored. **Rows never shrink; nothing is ever
clipped** — 20 holdings or 200, they're all reachable by scrolling that panel.

Implementation (a full-height flex chain, bounded at EVERY link with `min-height: 0`):
```
Frame (fixed, inset:0)
 └ Chrome (height:100%, flex column)
    ├ topBar         (flex: 0 0 auto)
    ├ .chromeBody    (flex: 1 1 auto; min-height: 0; flex column)
    │  └ .screen     (flex: 1 1 auto; min-height: 0; overflow: hidden; flex column)
    │     ├ hero     (flex: 0 0 auto)
    │     └ .mainRow (flex: 1 1 auto; min-height: 0;
    │                 display:grid; grid-template-rows: minmax(0,1fr))  ← essential
    │                 ├ panel (flex column, min-height:0)
    │                 │  └ .tableScroll (flex:1; min-height:0; overflow-y:auto) ← scrolls
    │                 └ rail  (flex column; the flexible panel's list overflow-y:auto)
    └ statusBar      (flex: 0 0 auto)   ← always visible, pinned at the bottom
```
`grid-template-rows: minmax(0, 1fr)` is load-bearing: without it the grid row
auto-grows to the full content and overflows (the status bar gets clipped).

## 3. Function-first hierarchy
ONE hero = the screen's single answer, big + calm. Supporting detail is quieter +
denser. Chrome (telemetry, status) is peripheral, mono, low-contrast. Dense where it
counts, calm where it doesn't. (Per the `actuality-ui` skill §1–2.)

## 4. Honest data only
Derive supporting stats from the **real snapshot** (allocation %, movers,
concentration, average position, best/worst). **No fabricated** equity/time-series or
"today's change" until that data actually exists. Label scope honestly (e.g.
"Unrealised · Open Positions"; note deposits/realised arrive with the Performance
engine). Gain/loss always by sign + drawn ▲/▼ + colour + position, tabular mono.

## 5. CRT legibility balance
Keep the baked barrel/tube curve via the **corners + left/right edges**, but keep the
**top/bottom edges LIGHT** — the telemetry bar and status bar live there and MUST stay
readable. Never crush the edges where chrome sits. (Bug we hit: a strong bottom
vignette hid the entire status bar; it looked like content was "cut off.")

## 6. Dev workflow — placeholder data (no Keychain)
Build with `MOCK=1` (the `VITE_MOCK` flag; see `src/data/mockPositions.ts`)
to render sample data with **zero** Keychain/API/password prompts, so the real `.app`
can be rebuilt and eyeballed freely during design iteration. Flip to live data (omit
the flag) as the final step before sign-off.

---

**Direction RESOLVED (2026-07-01) — follow the doc: cream-paper SDN data panels on the
dark frame** (`VISUAL_DIRECTION.md` §5 / `actuality-ui` skill §5). The dark Phase-1
Dashboard was the interim *"plain flat-DOM Dashboard"* (RUNTIME §4); the final data-screen
look is **cream panels (`#ece2ce`), ~3px warm-ink (`#2b241c`) outlines, solid-colour header
ribbons, amber (`#e8842a`) accent, baked paper-grain, radar/pentagon + roster cards** —
the dark is the *frame/bezel*, the data *panels* are cream. All the layout laws above
(fill space, viewport-lock + internal scroll, honest data) still apply — only the skin
changes.

---

## 7. Cream-paper SDN skin — the panel recipe (LOCKED on the Dashboard, signed off 2026-07-01)

Every DATA panel is a "cream card slotted into the dark scanner". Build every one the
same way so screens are cohesive:
- **Fill:** `--paper` (`#ece2ce`) cream.
- **Baked paper-grain:** a single static `feTurbulence` SVG **data-URI** as a
  low-opacity (~0.07) `::before` background, `pointer-events:none`. STATIC ONLY — no
  live `filter`, no `backdrop-filter`, no `mix-blend-mode` over live content (anti-brick).
  Share it via a `--paper-grain` custom property so panels don't duplicate the data-URI.
- **Outline:** ~2.5–3px solid `--ink` (`#2b241c`, warm near-black, NOT pure black),
  rounded corners ~6–7px.
- **Header ribbon:** a solid-colour bar flush to the panel's top edge (negative-margined),
  display font, ALL-CAPS, wide-tracked. Colour per the palette below.
- **Framed by dark deadspace** — the dark frame shows in the gutters; panels never touch
  the bezel edge.

### 7a. Ribbon colour palette (a disciplined set from existing tokens — NEVER rainbow)
Colour carries meaning; reuse a small palette across panel *types*:
- **Amber** (`--amber` + `--ink` text): the hero/title ribbon (DASHBOARD) and amber-themed
  panels (Allocation — ties to its amber bars).
- **Teal** (`--teal` + `--ink` text): the main data / roster panel (Holdings) — the "SDN
  terminal" colour.
- **Green** (`--gain-ink` `#3f6f45` + `--paper` cream text): positive / gainers.
- **Red** (`--panel-red`/`--loss-ribbon` + cream/ink text): negative / losers / alerts.
- **Dark-teal** (`--ink-trace` `#1f4a44` + `--paper` cream text): summary / secondary
  utility panels (Snapshot).
- Neutral tan (`--paper-2` + `--ink`) only as a fallback when a panel has no meaningful colour.
- **Every ribbon must pass AA contrast** for its text colour (ink on light grounds, cream on
  dark grounds). The deeper `--gain-ink` / `--loss-ribbon` tokens exist specifically for
  cream-text legibility — use them, not the lighter `--gain`.

### 7b. Text + P/L on cream
- Labels → `--ink-body`; figures/values → `--ink` (dark, bold, tabular mono).
- **P/L on cream:** gains → `--gain-ink` (the deeper AA-legible green, NOT the lighter
  `--gain`); losses → `--loss`/`--panel-red`. Always **sign + drawn ▲/▼ + colour + position**.
- `--amber` is the single interaction accent (SYNC button, allocation bars, selected).

### 7c. Honest charts (radar / pentagon etc.)
- Compute ONLY from data we actually have. The Dashboard radar is **"PORTFOLIO SHAPE"**
  (breadth / balance / winners / in-profit / return — all from the current snapshot), NOT a
  fabricated account-health radar. Label the scope honestly and note the fuller version
  (realised / cash / risk axes) arrives with the Performance engine.
- Render per `CHART_CRAFT.md`: canvas-2D, **woodcut-parchment** (dark warm-ink grid + spokes
  on cream), ONE polygon in the `--radar-*` family (olive `--radar-max` @ ~55% alpha),
  ink-stamp vertex nodes, no chartjunk. Draw ONCE per data change (no per-frame loop; redraw
  only on a debounced resize), dpr capped ≤2.

### 7d. Rail sizing (so no panel collapses or clips)
Fixed panels (e.g. Top Gainers / Top Losers / Snapshot) are `flex: 0 0 auto` (show all their
rows, never shrink). ONE flexible panel (e.g. Allocation) is `flex: 1 1 auto` with a
**`min-height` floor** (~148px) so it always shows its ribbon + a few rows *and* absorbs
leftover height + scrolls its own list. The `.rail` itself keeps `overflow-y:auto` as a
last-resort valve for very short windows.
