# Actuality — Chart & Gauge Craft

> ⚠️ **STATUS (2026-07-01): KEEP THE CRAFT, RE-SKIN THE LOOK.** This doc's **data-viz
> principles/function** are still the law and are worth keeping — honest geometry,
> click-to-expand (viz → clear numbers), tabular figures, gain/loss by sign+shape+position
> (never colour alone), 4 in-frame states, a11y. (Synthesised via **Hallmark** anti-slop
> craft + ui-ux-pro-max + the built Dashboard — the part the user liked.) **BUT its visual
> styling is OLD-DIRECTION** — it was written for the abandoned "CREAM & PIGMENT / comic-collage"
> language (parallelogram clip-path tiles, hard offset shadows, `--tealdk` accents, etc.).
> That styling is **superseded**. The chart LOOK now follows the new source of truth:
> `.claude/skills/actuality-ui/` + `docs/VISUAL_DIRECTION.md` (dark cinematic frame + Dispatch
> "SDN" cream-paper panels; radar/pentagon charts; one accent per world). When building a
> chart: take the **craft/function rules here**, render them in the **new look** there.
>
> **Line refs to `src/screens/dashboard/Dashboard.tsx` below are historical/pre-rebuild**
> — the flat `src/screens/Dashboard.tsx` and its `drawValue`/`drawGauge`/`drawDonut`/`drawPL`
> functions no longer exist at those line numbers. Treat them as **design intent**, not literal
> anchors. Paths are repo-relative.

## Global chart grammar

## Actuality Viz Grammar — "made, not generated"

Every chart, gauge, donut, sparkline, radar, P/L field, drawdown, split, and numeric readout in Actuality is **one hand-built `<canvas>` data-panel** in the LOCKED **CREAM & PIGMENT** language. No archetype is a one-off; they all obey the cross-cutting grammar below. The governing rule that overrides every craft beat: **distinctive must never cost readability or a truthful number.** Every figure drawn is one the caller supplied (or an honest *derivation* — `max(|pl|)`, `min(...dd)`, `Σweights`); nothing is invented to fill the frame.

**1. Canvas-only data plane; SVG reserved for marble + the one drawn glyph.**
All viz are drawn on a raw 2D `<canvas>` via the shipped signature `drawX(c: HTMLCanvasElement, big: boolean)`, sharing `fitCanvas(c)` (backing store = CSS box × `min(dpr,2)`, pre-scaled ctx, returns `{ctx,w,h}` in CSS px) and `line(ctx, pts, col, w)` (round join). **No Recharts/D3/Chart.js, no SVG `<path>` charts.** SVG is for the `#ntMarble` liquid-marble `<symbol>` and the *one* drawn expand corner-arrow glyph only. This is what lets every mark carry the house vocabulary instead of a stock library render. When a lib seems tempting, the answer is no — but if one is ever unavoidable, it must be *fully* restyled (strip stock legend/tooltip/gridlines/bounce-entrance, replace the categorical palette with the single-accent neutral scheme, square every corner) so it never reads as default.

**2. The ink-offset + zero-blur draw idiom (the stamp).** Every primary mark is drawn TWICE: an **ink (#14110D) copy offset first** (+2px lines / +4–6px bars & blocks; line charts go 3-pass: ink-shadow → `--tealdk`/`--accent-dk` underline → `--accent` overline), then the bright mark on top. Nodes are an ink square then a smaller accent square. Donut wedges are each re-stroked in ink like cut paper. This canvas idiom is the equivalent of the DOM `box-shadow: 10px 10px 0 var(--ink)` — it is THE thing that stops a chart reading as a generic SaaS line. Skipping the ink layer = instant slop.

**3. Halftone treatment, marble on borders only.** Ben-day halftone (`radial-gradient` ~6% ink dots, `mix-blend-mode: multiply`, 1.35px dot / 15px grid) sits **under the cream tile body**, clipped to cream, well below data contrast — texture is finish, never foreground, never over the line/numbers. **Marble appears only on the tile/modal frame ring, the rail head, and the SCREEN-TRUTH tag — NEVER behind a chart, gauge dial, or number.** The data plane is flat, crisp, static cream + ink.

**4. Per-screen pigment accent logic.** Exactly **ONE** signature pigment per screen, keyed by the binding map: Dashboard=teal, Positions=magenta, Watchlist=sky, Performance=lime, Compare=violet, Journal=amber, Settings=gold. It is injected as `--accent` / `--accent-dk` + the six `--mrb-*` marble vars — the ONLY thing a new screen overrides. The accent marks ONLY the focal series, the live scrub/active node, the active tile head, the `.ex`/frame tags, and the marble. Footprint ≤3–5% of the plot. Everything else is ink-on-cream. No second bright hue ever enters one chart; no rainbow categorical palette.

**5. gain(up)/loss(down) encoding is NEVER colour-only.** `--gain #2FB5A8` (up) / `--loss #C8402F` (down) are the ONLY semantic colours beyond the accent, used tiny (the decisive figure), and they stay teal/red on **every** screen — never swapped to the per-screen accent. **gain ≠ accent** even where both are teal (Dashboard): they are distinct tokens. Every signed figure carries a non-colour channel: an explicit `+`/`−` sign (U+2212 minus, the locale minus the formatter emits) AND a drawn ▲/▼ triangle (a canvas path or U+25B2/U+25BC+U+FE0E text-presentation glyph — **never an emoji**, never a font-glyph arrow that tofus per-device) AND, where the geometry allows, a redundant positional cue (right=gain / left=loss on the P/L field; needle left of zero; below-target node). Must survive a CVD emulator with hue removed.

**6. Axis / tick / gridline / legend / tooltip grammar.** Gridlines are a deliberate quiet sub-layer at `rgba(20,17,13,.12)` (matched to shipped) — low-contrast by design, never loud SaaS chrome competing with data. The structural rule (zero/waterline/baseline) draws one notch heavier (`rgba(20,17,13,.18–.22)`). **Grid carries a house-texture beat** — dashed-ink reference rules (`[6,4]`/`[7,5]`) + short halftone-style tick stubs / stamped notches — so even the grid reads hand-made, but always kept at/below the gridline alpha so contrast floor holds. **Axis tick TEXT is `rgba(20,17,13,.66)` (~4.6:1), NOT `.5` (3.36:1, fails the 4.5:1 text floor).** Legends sit adjacent to the plot (direct-label ≤3 series and drop the legend); legend swatches are ink-stroked squares + Oswald ticker + a **boxed Space-Mono value tag** (not flat data text). Tooltips obey the visual language: square (`border-radius:0`), `border:2.5px solid var(--ink)`, `box-shadow:3px 3px 0 var(--ink)` zero-blur, Oswald label + tabular Space-Mono value — never a rounded soft-shadow default.

**7. Hand-built-SVG-over-library stance + CRT-awareness.** The whole stack sits under the SAME global `#crt` overlay (z90; bulge/scan/grille/sheen/vig/corners/bezel/glassmask) and the SAME halftone grit as every screen, so screens read as one device. The CRT **bezel's 46px radius is the ONLY curve in the system** — every data container, bar, wedge cap, tag, chip, tooltip is `border-radius:0`. Curvature/motion is never applied to the chart marks themselves.

**8. Marble-on-borders-only & skew discipline (clip-path, never skewX).** Geometry is the shipped **`clip-path` parallelogram** via tokens `--slant 16 / --slant-sm 9 / --vslant 14`; the legacy `--skew/--unskew` are pinned to `0deg` no-ops. **Never `transform: skewX(-11deg)`** (it overhangs and gets clipped — the shipped system removed exactly this). The tile shears via clip-path on the shell only; the canvas (`inset:0`) and any DOM figure overlay carry NO transform and read level for free, content counter-skewed with `transform: skewX(var(--unskew))` (0deg) on a pinned origin. One unified angle per screen, cascading off-grid down a single diagonal spine — disciplined lean, never random per-element tilt.

**9. Tabular figures everywhere.** `font-variant-numeric: tabular-nums` on every DOM numeric run (value tags, hero figures, axis mirrors, tooltips, stale-age chips); right-align numeric table columns; fixed decimals per instrument. Canvas Space-Mono is inherently tabular. **Anton has no true tabular figures** — any live-updating hero figure is set in **Space Mono** (or kept static); the Anton hero is reserved for non-ticking summary numbers, always inside a width-locked `.val` box so it never reflows. Numbers are roman — no italic on any figure, axis label, title, or legend; emphasis via weight/accent/the boxed tag.

**10. The click-to-expand law: viz left → clear numbers right, decoration on the border.** Tap a tile and it *splits*: the SAME `draw(c, big=true)` renders the viz LEFT, a column of boxed-tag numbers appears RIGHT, and ALL decoration (marble `.frmarble`, halftone, hatch, SCREEN-TRUTH tag) is shoved to the **frame/border**; the data plane stays flat cream2 + ink. The overlay is fixed at **z-index 100** (above the CRT z90, outside the clipped stage), `?expand=<key>` deep-linkable, Esc + scrim-click close, focus trapped and returned to the trigger. Numbers are boxed Space-Mono `.val` tags (2.5px ink border + 3px ink offset, no radius), alternating bands kept kinetic (halftone/off-grid, not a striped spreadsheet), with exactly ONE full-ink hero row. The picture can never disagree with itself (one draw fn) or with the numbers (same `series`/`stats`).

**11. Motion discipline — snappy, ≤ a couple primitives, transform/opacity only.** ONE orchestrated entrance on first load (line draws via a clipped progress var / bars `scaleX` from the true-zero origin / arc fills via an interpolated angle in the draw loop / wedge sweeps via an interpolated arc fraction / polygon `scale(0.6→1)` + opacity) — **never** by animating width/height/x/y/geometry per frame, never recompute on scroll. Staggered by DOM index `--i*60ms`, capped ~500ms, `--ease-out cubic-bezier(0.16,1,0.3,1)`. After that the viz is **static** — no loop, no re-animate-on-scroll, no spinning needle / sweeping radar (the loading sweep is the one sanctioned perpetual loop). Tile hover/active = the shipped stamp/kick: `translate(-3px,-3px)` + shadow deepen to `15px 15px 0 var(--tealdk/--accent-dk)` over `0.14s` with the **shipped curve `cubic-bezier(0.2,1.3,0.3,1)`** (do not silently swap for the skill's `0.2,1.4,0.3,1` or generic `0.16,1,0.3,1`). One signal at a time — never stack translate+scale+shadow+colour. No bounce/elastic (control points ≤1.3), no soft ease-in-out, no blur ever. **`prefers-reduced-motion: reduce`** snaps every viz to its final state (line full, dashoffset 0, arc at final fraction, counter at final value), kills tile transitions, pauses marble SMIL (`svg.pauseAnimations()`) + slows `.marble-drift` to ~180s — and still gets full scrub/hover/keyboard interactivity.

**12. Legible + accurate above all (honest geometry).** Chart type matches data shape (trend→line/area, comparison→bar, proportion→donut, profile→radar, single bounded value→gauge — never a gauge for a trend, never a degenerate ≤3-axis radar). **Data-derived domains, true-zero/true-baseline, un-truncated axes** (any non-zero range is a *labelled* value-axis range, not a hidden truncation); arc length = `value/range`; wedge angle = `weight/total×2π`; bars mirror-equal on a symmetric `±max`. Down-sample >maxPoints with an **extrema-preserving** method (LTTB / min-max bucketing) so cited peak/trough/aria match the drawn series. >~1000 points aggregate with drill-down; >50 table rows virtualize. Missing figure → em-dash on a labelled anchor-tinted "metric to confirm" block (never zero-chroma grey, never a fabricated `+47%`). A bare giant number is never the sole hero — always paired with its worded label. Four in-frame states (empty/loading-skeleton-in-silhouette/error+Retry/populated), never a spinner over bare axes or a broken plot. Each canvas gets `role="img"` + a worded key-insight `aria-label` **derived from the data** (and a `role="button"` expander on a *separate* node, since one element can't be both), a visually-hidden `<table>` data mirror, ≥44×44px focusable hit targets with an **instant** ink focus ring, tooltips on hover AND tap AND focus, and `Intl.NumberFormat`/`Intl.DateTimeFormat` with caller locale + instrument currency (never hard-coded `$`/en-US/`£`/`%` concatenation). All colours/fonts/alphas reference named tokens — zero inline hex/oklch, zero mid-render drift.

## Reusable React component contract

## Shared React component family (one canvas grammar, one expand IA)

All components wrap the shipped `drawX(c, big)` canvas idiom + `fitCanvas`/`line` helpers, register a `EXP[key] = { head, sub, draw, rows }` entry, and reuse `<NtMarble/>`/`<MarbleDefs/>` + the global `#crt` — never rebuild marble or chart libs. Shared props appear on every viz: `accent` (per-screen pigment token, default the screen's mapped hue), `data`/`series`/`stats` (caller-supplied, honest), `state` (`loading|empty|error|populated`, never bare), `onExpand`/`expandKey`, `onRetry`, `locale` + `currency` (Intl), `ariaSummary` (worded, data-derived), and implicit reduced-motion via `matchMedia`.

**Primitives (shared internals)**
- **`fitCanvas(c) → {ctx,w,h}`** — backing store = CSS box × `min(dpr,2)`, pre-scaled ctx (shipped, unchanged).
- **`line(ctx, pts, col, w)`** — round-join polyline (shipped). The 3-pass ink→accent-dk→accent line and ink-offset bars/nodes are built from these.
- **`<MarbleDefs/>` (once per screen) + `<NtMarble className/>`** — the `#ntMarble` symbol driven by the six `--mrb-*` vars; host gets `position:relative;overflow:hidden`; label legibility via an `::after` ink veil + text-shadow. Frame/rail/tag only.
- **`formatMoney(v,locale,currency)` / `formatPct(v,locale,d)` / `formatStaleAge(date,locale)`** — Intl wrappers; never string-concat a symbol; emit U+2212 minus.
- **`sampleExtrema(data,maxPoints)`** — LTTB / min-max bucketing preserving high/low.
- **`useScrub(ref) → {index, tooltip, onPointerMove, onKeyDown}`** — crosshair + square ink tooltip; re-strokes overlay only, no per-frame geometry recompute.

**`<ChartFrame>` (the shared shell)** — the clip-path parallelogram tile every viz lives in: `border:6px solid var(--ink)`, `box-shadow:10px 10px 0 var(--ink)`, `clip-path` via `--slant`, `border-radius:0`, the ink `.tl-head` (Anton name + `.ex` accent EXPAND chip with the one drawn SVG arrow), the `.tl-body` (halftone underlay + absolutely-positioned `<canvas inset:0>`), the hover kick. Owns `role="button"`+tabindex+Enter/Space+instant focus ring on the tile and `role="img"`+aria-label on the canvas (the two roles on separate nodes). Composes with `<ChartStates>`.

**`<ChartStates>` (a.k.a. `<VizState>`)** — drives empty/loading/error/stale/populated on the SAME canvas (never reflows the tile). Loading = skeleton in the viz's own silhouette (dashed hollow ink marks via the viz's own geometry helpers + one hard-edged `translateX` sweep, the sole perpetual loop) — never a spinner. Empty/error = stamped ink message + CTA / `--orange` Retry (orange = warning role, not the accent). Stale = real `draw(c,big)` with fills/nodes dimmed (line/bars kept ≥3:1) + dashed hatch band + Intl `STALE · {age}` chip. Branch on state, not presence.

**`<InkAxis>`** — shared axis/grid renderer (canvas helper, not a DOM node): `.12` gridlines, `.18–.22` structural rule, dashed-ink reference + halftone tick stubs (the house-texture beat), `.66` Space-Mono tick text, data-derived steps. Used by every Cartesian viz so grid grammar is identical.

**`<ValueChart>`** — hero value-over-time line/area (`drawValue`): 3-pass accent line, accent-gradient area, purple dashed net-deposits benchmark + faint purple area, ink+accent node squares, data-derived y-domain, the scrub layer (`useScrub`), DOM `.feat-figure` headline overlay. Dashboard=teal, Performance=lime via `accent` only.

**`<Gauge>` (TrueGrowthGauge)** — 180° semicircle (`drawGauge`): ink track + stamped tick ladder (anchors at min/zero/max), ink-shadow→accent value arc, ink needle + ink hub + accent hub cap; `frac=(value−min)/(max−min)`; arc/needle/figure one source of truth; collapsed draws no text (number lives in DOM `.greadout`); negative → `--loss` arc + needle left of zero + ▼.

**`<Donut>` (AllocationDonut)** — part-to-whole (`drawDonut`): cut-paper ink-stroked wedges from per-datum palette, cream2 punched hole, framed center stamp, big-mode boxed-tag legend; `maxSlices` (Dashboard pinned 7, new callers 6) → honest `OTHER`; canvas `aria-hidden` + DOM `<button>` hit-layer (canvas pixels can't be tabbed); accent-aware active signal (cream-fill+thick-ink when accent is teal-on-teal).

**`<PLBars>` (PerStockPLBars)** — diverging horizontal P/L (`drawPL`): ink zero spine (heaviest rule), ink-offset gain/loss bars, symmetric `±max`, outward-reading value labels, largest-gainer/loser end-cap nodes; sortable (`aria-sort`, keyboard); gain/loss ARE the fills (the sanctioned exception); accent is an ink-stroke focal signal, never a fill (would vanish on teal).

**`<Sparkline>`** — in-card micro-trend (`drawSpark`): baseline rule + whisper area + ink-shadow line + colour line + ink/colour end-cap node + up/down tick; ≥2.4px; up=`--tealdk`/down=`--loss`; `sign(plRaw)` wins for both badge sign and line colour; expands to feature-line `big=true`.

**`<Radar>` (NtRadar)** — multi-axis pentagon (`drawRadar`): stamped straight-edged grid + ink-square rim ticks, purple dashed target ring, 3-pass accent value polygon + ink/accent nodes, `% on-target` strip; shared `0..scaleMax` honesty (rejects mixed raw units → bar fallback); ≤3 axes routes to bars, >8 rejected; below-target node = `--loss` + hand-built ink triangle.

**`<StatReadout>`** — the boxed-tag numbers column (the informatics block): `.edrow` label ↔ `.val` tag (Space-Mono, ink border + `3px 3px 0` ink offset), exactly one full-ink `.hero` row, alternating kinetic bands, `confirm` → em-dash "metric to confirm" tag, `tabular-nums`, virtualize >50, never a spreadsheet. Reused inside the modal AND any tile `.greadout`.

**`<ExpandViz>` / `<ExpandModal>` (ExpandableViz)** — the click-to-expand law: registers the EXP entry, renders the collapsed `<ChartFrame>` trigger, opens the z100 `1fr minmax(360px,470px)` modal (viz left via `draw(c,big=true)` on `ResizeObserver`+rAF, `<StatReadout>` right, decoration on `.expFrame` border only), `?expand=` deep-link, Esc/scrim close, focus trap + return.

**Composition:** `<ExpandViz>` → `<ChartFrame>` (→ `<ChartStates>` → one `drawX`) as trigger; on open → `<ExpandModal>` (→ same `drawX(big)` + `<StatReadout>`). Every concrete viz (`<ValueChart>`, `<Gauge>`, `<Donut>`, `<PLBars>`, `<Sparkline>`, `<Radar>`) supplies its `drawX` + `rows` and inherits frame, states, expand, a11y, Intl, accent, and motion from the shared layer.

## Viz tokens

## Viz-layer CSS custom properties (consistent with CREAM & PIGMENT)

**Already shipped on `.screen` (reuse verbatim — do not redefine):**
- `--cream: #ede6d2` · `--cream2: #f2ece0` — data substrate / donut hole / tile body
- `--ink: #14110d` — all axes, gridlines, labels, node outlines, shadows, chrome
- `--orange: #ff5a1f` — WARNING role only (error Retry chip), never the accent
- `--teal: #19e5e5` (=`--accent` on Dashboard) · `--tealdk: #0e8a86` (=`--accent-dk`) · `--teal2: #2fb5a8`
- `--gain: #2fb5a8` · `--loss: #c8402f` — semantic pair, fixed on EVERY screen, ≠ accent
- `--purple: #5d5a86` — net-deposits / target benchmark (dashed reference, never a fill)
- `--slant: 16px` · `--slant-sm: 9px` · `--vslant: 14px` — clip-path parallelogram angles
- `--skew: 0deg` · `--unskew: 0deg` — neutralised no-ops (never set non-zero)
- `--inkw: 14px` · `--pad: clamp(10px,1.4vw,22px)` · `--gap: clamp(10px,1.1vw,18px)` · `--bezel: clamp(14px,1.9vw,30px)`
- `--mrb-base/-deep/-veil/-mid/-core/-bright` — the six marble vars (frame only; the re-skin lever)

**NET-NEW (add to `.screen`/the tile — must exist before reference; not yet shipped):**
- `--accent` — per-screen pigment binding (Dashboard `var(--teal)`, Positions magenta, Watchlist sky, Performance lime, Compare violet, Journal amber, Settings gold). The viz value overline / scrub node / active signal / `.ex` & frame tags read this.
- `--accent-dk` — the accent's darker underline pair (Dashboard `var(--tealdk)`).
- `--grid: rgba(20,17,13,.12)` — gridline sub-layer alpha (named so it's not an inline literal).
- `--rule: rgba(20,17,13,.18)` · `--waterline: rgba(20,17,13,.22)` — structural baseline / zero rule (one notch heavier).
- `--tick-text: rgba(20,17,13,.66)` — axis tick TEXT (≥4.5:1; replaces the failing `.5`).
- `--axis-faint: rgba(20,17,13,.5)` — axis spine/legacy chrome (mark-level, not text).
- `--area-accent-top` / `--area-accent-bot` — value/area gradient stops (Dashboard `rgba(25,229,229,.42)` → `.03`); per-screen these mirror the accent rgba.
- `--area-loss: rgba(200,64,47,.16)` · `--area-loss-recover: rgba(200,64,47,.08)` — drawdown underwater / recovery wash.
- `--area-deposits: rgba(93,90,134,.16)` — purple benchmark fill.
- `--ink-shadow-line: rgba(20,17,13,.25)` — the +2px ink-offset line-shadow pass.
- `--ink-tint-085: rgba(20,17,13,.085)` — alternating readout even-band.
- `--font-display: 'Anton'` (900; static/summary heroes & titles) · `--font-label: 'Oswald'` (600/700 uppercase, ticks/legends/status) · `--font-mono: 'Space Mono'` (700; ALL money/numeric readouts + live heroes; inherently tabular).
- `--num: tabular-nums` — applied via `font-variant-numeric` on every DOM numeric node.

Banned from the viz layer: `system-ui`/`Inter`/`Roboto`/any thin weight; pure `#000`/`#fff`/zero-chroma grey on chrome; any `box-shadow` blur radius >0; any inline hex/oklch/rgb tucked into a state or hover (every colour/alpha is a named token mirrored once as a JS const for canvas).

## Per-archetype craft specs

### Value-over-time chart

## CRAFT SPEC — Value-over-time chart (the hero data-sculpture)

Portfolio value as a line/area over time with a net-deposits overlay; scrubbable; the click-to-expand centrepiece on **Dashboard** and **Performance**. This spec extends the **already-shipped** `drawValue` in `src/screens/dashboard/Dashboard.tsx` — it does **not** replace it. The canvas draw idiom is locked; the net-new work is the **scrub layer, tooltip, keyboard access, aria summary, the four data-states, the data-derived y-domain, and a house-texture pass on the grid**, plus packaging it as a reusable component. Per-screen accent is keyed by the map: **Dashboard = teal** (the shipped values), **Performance = lime** (swap the accent token only — see §8).

> Hard rule that governs all of the below: **distinctive must never cost readability or truthful numbers.** Every number drawn is one the caller supplied; nothing is invented to fill the frame.

### 1. Why hand-built canvas (not Recharts/Chart.js)
This viz is drawn on a raw 2D `<canvas>` with the signature `drawValue(c, big)`, sharing `fitCanvas(c)` (backing store = CSS box × `min(dpr,2)`, pre-scaled ctx) and the `line(ctx, pts, col, w)` helper — exactly as shipped. **No charting library, no SVG `<path>` charts.** SVG is reserved exclusively for the `#ntMarble` liquid-marble texture and for the one small drawn glyph (the expand corner-arrow). That is what lets every mark carry the ink-offset + accent-overline + ink-node-square vocabulary instead of a stock library render.

**Geometry is `clip-path`, never `transform: skewX`.** The shipped tile system neutralises the skew tokens to `--skew:0deg / --unskew:0deg` (legacy no-ops) and gets every parallelogram from a `clip-path` polygon, because `skewX` pushed corners off-screen and got clipped. Do **not** reach for `skewX(-11deg)`; use the shipped `--slant`/`--slant-sm`/`--vslant` clip polygons and counter-transform content with `transform: skewX(var(--unskew))` (a 0deg no-op) on a pinned origin so values stay upright with zero clipping.

### 2. Visual anatomy (collapsed tile → expanded modal)
One `.feature.tile` (a `clip-path` parallelogram, `border:6px solid var(--ink)`, `box-shadow:10px 10px 0 var(--ink)`) containing exactly:
- **`.tlHead`** — ink bar: `.nm` "Value Over Time" (Anton, uppercase, `--cream2`) + `.ex` expand chip. The chip reads the **Oswald word "EXPAND"** plus a small **SVG corner-arrow drawn in the ink stroke weight** (one icon voice) — **never** a Unicode/emoji arrow glyph (no `⤢`, no `↗`, no emoji), which renders differently per device and breaks the stroke voice. Hover flips the head to `--accent` fill / ink type.
- **`.tlBody`** — the plot. Single absolutely-positioned `<canvas id="cv-value">` (`inset:0; width/height:100%`). On top, two DOM overlays sitting over the reserved blank top strip (collapsed `padT = min(120, H*0.30)`): `.featTag` ("TRUE GROWTH · 8 PERIODS", Oswald) and `.featFigure` (the hero figure in Anton + the "vs net deposits" sub in Space Mono). **Every figure in these overlays is formatted through `Intl.NumberFormat` from `stats` — never a string-concatenated literal.** The hero number stays in the DOM in collapsed mode — never drawn on the canvas (matches the shipped convention). A new **`.scrubLayer`** (transparent, `inset:0`, see §5) captures pointer/keyboard and hosts the tooltip.

Inside the canvas, drawn back-to-front (locked, with one new house-texture beat):
1. Horizontal gridlines `rgba(20,17,13,.12)` at the data-derived steps (see §9), with right-aligned `£Nk` Space-Mono labels (`rgba(20,17,13,.5)`). **House-texture beat (net-new):** the zero/start-of-range reference rule is a **dashed ink rule** (`[6,4]`, `rgba(20,17,13,.18)`) rather than a plain solid hairline, and the value axis carries short **halftone-style tick stubs** at each gridline — both kept at or below the gridline alpha so the grid still reads as a quiet sub-layer (contrast floor intact) but no longer reads as bare SaaS chrome.
2. **Net-deposits overlay** — faint purple area `rgba(93,90,134,.16)` beneath a **dashed** (`[7,5]`) `--purple` reference line. This is the "your money vs what you merely deposited" benchmark thesis line.
3. **Value area** — accent vertical gradient (`rgba(25,229,229,.42)` → `.03` on Dashboard; the `--accent` rgba on Performance).
4. **Value line, 3 passes**: ink shadow offset `+2,+2` at `rgba(20,17,13,.25)` → `--accent-dk` thick underline → `--accent` thinner overline.
5. **Node squares** at each anchor: ink square then smaller accent square on top. These identity marks stay even at the smallest collapsed size — the value line is never reduced to a bare library-style sparkline.
6. X-axis labels `W1…NOW` (Space Mono, `rgba(20,17,13,.55)`).

Expanded (`big=true`, same `drawValue`): denser gridlines, all axis labels, more padding; the hero number now renders as an Anton headline on-canvas. Modal is the locked **2-column** layout — viz left (`#cv-exp`), boxed-tag numbers right (`.edlist`), with one full-ink `.hero` row. The boxed-tag list is **never a striped spreadsheet** — values stay boxed Space-Mono tags (ink border + 3px ink offset), one full-ink hero row, with the alternating band kept kinetic (slight off-grid / halftone band), not a generic data table.

**Marble never touches the plot.** Marble appears only on the modal frame (`.frmarble`) and the "PERFORMANCE TRUTH" tag. The data plane is flat, crisp, static cream + ink.

### 3. Colour / encoding (named tokens only — no inline hex)
All from `.screen` tokens: `--ink #14110d` (axes/gridlines/labels/node outline/shadows), `--cream`/`--cream2` (substrate), `--accent` (value overline + per-screen accent; teal `#19e5e5` on Dashboard, lime on Performance), `--accent-dk` (value underline; `--tealdk #0e8a86` on Dashboard), `--purple #5d5a86` (net-deposits benchmark — **reference, dashed, never a fill colour**), `--gain #2fb5a8` / `--loss #c8402f` (semantic, tiny). The accent marks the **one** focal series + the live scrub node only — its footprint stays ≤3–5% of the plot. Everything else is ink-on-cream. JS mirrors these as the existing consts (`INK`, `TEAL`, `TEALDK`, `PURPLE`, …) read from a single accent binding; a new viz must **not** invent a palette or use green-for-gain. **No inline hex/rgb/oklch tucked into a state or hover** — every colour and alpha references a named token (the `rgba(...)` grid/area alphas are defined once as named constants mirrored from the tokens).

**Gain/loss is never colour-only.** The hero delta and the scrub tooltip's "vs deposits" figure always carry a sign **and** a ▲/▼ glyph (drawn as a small ink/accent triangle in canvas, one icon voice — never an emoji), plus the worded label. Loss states additionally switch the figure to `--loss` *and* a ▼; a colour-blind reader still gets sign + arrow + word.

### 4. Type
Canvas + DOM share one face stack: **Anton** for the hero figure / on-canvas headline (`900 …px 'Anton'`); **Space Mono** for every axis tick, money value, and tooltip number (`font-variant-numeric: tabular-nums` on all DOM numeric runs so live scrub values cause **zero layout shift**); **Oswald** 600/700 uppercase wide-tracking for `.featTag`, legend, status segments, and the EXPAND chip word. Modal tile head `.nm` is Anton. **Banned:** system-ui / Inter / Roboto / any thin weight / any italic on a figure, axis label, title, or legend. Draw only after `document.fonts.ready` with the shipped re-draw passes (rAF + 240ms + 380ms) so Anton/Space-Mono are loaded before first paint. Numbers are roman; emphasis comes from weight/accent/the boxed tag, never italics.

### 5. Scrubbing (net-new; the load-bearing interaction)
A transparent `.scrubLayer` over `.tlBody`, `role="slider"` semantics via a focusable element, exposes the value at any period on **hover, tap, and keyboard** — critical values are **not** hidden behind hover-only tooltips.
- **Pointer/touch:** `pointermove`/`pointerdown` → map x to nearest data index → redraw a **crosshair** (1px ink dashed vertical rule), enlarge that period's node to the "active" square, and position a **square ink-outlined tooltip** (`border:2.5px solid var(--ink)`, `box-shadow:3px 3px 0 var(--ink)`, `border-radius:0`) showing the period label, `£value` (tabular, Intl-formatted), and the signed `▲/▼ £delta vs deposits`. Touch target ≥44×44px.
- **Keyboard:** the layer is `tabindex=0` with an **instant** `:focus-visible` ink ring (no transition on outline). ←/→ step the scrubbed index, Home/End jump to first/NOW; the same tooltip + crosshair update; Enter opens the expand modal. Focus-tooltip delay 0ms; hover-tooltip delay ~800ms.
- The crosshair/tooltip redraw only re-strokes the overlay; the base series is cached — **no per-frame geometry recompute** of the line.

### 6. Click-to-expand
The whole tile is clickable and registered in `EXP.value` ({head, sub, draw: drawValue, rows[]}). Clicking (or Enter on the focused tile/scrub layer) opens `#expand` (fixed, z-index 100, above the CRT at z90, outside the clipped stage), redraws `drawValue(cv-exp, big=true)`, and renders the right-hand **boxed-tag** numbers (Space-Mono, ink border + 3px ink offset) with one full-ink **hero** row ("Current value <Intl-formatted>"). `?expand=value` deep-link + Esc-to-close are honoured. Numbers are tags, **not a spreadsheet**.

### 7. Motion — snappy stamp/kick, ≤ a couple primitives, transform/opacity only
- **One orchestrated entrance on first load:** the value line draws on once via a clipped progressive redraw (animate a 0→1 progress var, draw line up to that fraction) — **never** by animating width/height/x/y. Area + nodes fade via `opacity`. Total ≤ `--dur-long` (~420ms); the deposits benchmark draws in slightly behind (stagger ≤120ms). After that the chart is **static** — no looping, no re-animate-on-scroll.
- **Tile hover/active = stamp/kick:** the existing `transform: translate(-3px,-3px)` + shadow deepen to `15px 15px 0 var(--accent-dk)` over ~140ms with the **shipped snappy curve `cubic-bezier(0.2,1.3,0.3,1)`** (the value the shipped tile CSS already uses; do not silently swap it for the skill's `0.2,1.4,0.3,1` or the generic `0.16,1,0.3,1`). Active expand chip inverts to accent fill. No bounce/elastic on the line or nodes; no soft ease-in-out; no blur ever.
- **The still must pass on its own** — values and labels are legible at frame 1; animation is decoration, never the only path to the resting state.
- **`@media (prefers-reduced-motion: reduce)`** (extend the existing block): line drawn fully, area/nodes at final opacity, no entrance, tile transitions off, marble drift 180s, SMIL paused. Reduced-motion still gets full scrub interactivity.

### 8. Reusability / per-screen accent
Ship as `<ValueChart>` (see componentApi). It owns one `drawValue` + the scrub layer + the four states + the EXP registration. **Performance** mounts the *same* component with `accent="lime"`, which swaps only `--accent` / `--accent-dk` (the value overline + scrub node + entrance use `--accent`; underline uses `--accent-dk`); ink/cream/purple-benchmark/gain-loss stay locked. No second bright hue enters the plot. Do **not** rebuild the marble — reuse `<MarbleDefs/>`+`<NtMarble/>` on the frame only.

### 9. Data → numbers (honesty contract)
The component renders **only** caller-supplied numbers. `value[]` and `netDeposits[]` are plotted; `stats` (current value, net deposits, true growth £/%, period high/low, etc.) drive the hero figure and EXP rows verbatim. **The y-domain is data-derived** — `min`/`max` come from the actual range of `value[]` ∪ `netDeposits[]` with honest, labelled padding; **the shipped fixed 7.5–15 domain (Dashboard.tsx lines 127–128) is replaced** so a different account can't be drawn dishonestly. **Bars/areas anchor at a true baseline and the axis is never truncated to exaggerate a trend** (if the domain doesn't include zero, that is a labelled value-axis range, not a hidden truncation). Gridline step is derived from the domain so the grid stays readable at any range. If `stats.trueGrowth` (or any figure) is missing, the slot renders an em-dash on a grey "metric to confirm" tag — **never** a fabricated number, and the hero figure is never a bare number without its worded label ("vs net deposits"). When the series exceeds `maxPoints`, down-sample with an **extrema-preserving** method (LTTB or min/max bucketing) so the `periodHigh`/`periodLow` cited in words and the aria summary are the peak/trough actually drawn.

### 10. Four states (mandatory, in-frame)
- **empty:** in-frame message + CTA ("No history yet — fund the account to grow your equity curve"), no bare axes.
- **loading:** a skeleton in the **chart silhouette** — a faint ink dashed baseline + ghost gridlines + a shimmering placeholder line, **not** a spinner over empty axes.
- **error:** worded cause + a **Retry** affordance that re-runs the fetch.
- **populated:** the real chart, mounted only once data has arrived.

### 11. Accessibility wrap
- The canvas gets `role="img"` + an `aria-label` stating the **key insight in words**, **auto-derived from `stats` via `Intl` and matching the drawn (down-sampled) series** — e.g. "Portfolio £14,240, up 9.5% (+£1,240) versus £13,000 net deposits over 8 periods; peak £14,200 at NOW." The example figures are templated, not literals.
- A visually-hidden `<table>` mirrors `period → value → net deposits` as the text/data equivalent.
- Scrub layer is keyboard-reachable with a visible instant focus ring; every value exposed by hover is equally reachable by tap and keyboard.
- All money/%/dates formatted via `Intl.NumberFormat`/`Intl.DateTimeFormat` with the **caller locale (default `navigator.language`) and the instrument currency** — `currency` is required (or defaults to the account's instrument currency); the component **never** invents `$`/en-US or string-concatenates a symbol.
- Contrast floors clear: data marks ≥3:1 on cream, all labels/ticks ≥4.5:1, gridlines (and the new dashed-baseline/halftone-tick beat) kept as a quiet `rgba(20,17,13,.12)` sub-layer.

### 12. Anti-slop checklist (must all hold)
border-radius:0 on tile/tooltip/tags (CRT bezel is the only curve) · angles via clip-path only, never transform:skewX · hard zero-blur ink offset shadows only · marble never over data · cream substrate + ink chrome (no #fff bg, no #000, no zero-chroma grey) · one accent + tiny purple benchmark + tiny gain/loss, no rainbow · grid carries a house-texture beat (dashed baseline + halftone ticks) and never bare SaaS chrome, yet stays a quiet sub-layer · tabular-nums everywhere · gain/loss always carries sign+arrow+word · expand affordance is a drawn SVG glyph or the Oswald word, never a Unicode/emoji arrow · transform/opacity motion only, shipped `cubic-bezier(0.2,1.3,0.3,1)`, no bounce, one entrance, reduced-motion fallback · canvas only (no chart lib, no SVG chart) · shallow DOM, no card-in-card, no fake window chrome · honest data-derived true-baseline un-truncated axis · extrema-preserving down-sample · Intl locale+currency, never hard-coded $ · all colours/fonts/alphas from named tokens.

**Component API**

```ts
// Reusable hero value-over-time chart. Drawn on raw <canvas> via drawValue(c, big),
// scrubbable, click-to-expand. NO charting library; SVG reserved for marble + the one
// drawn expand-arrow glyph only. Renders only caller-supplied numbers. Mounted on
// Dashboard (accent="teal") and Performance (accent="lime"); accent swaps the value
// overline + underline + scrub node only. Geometry via clip-path, never skewX.

type Money = number;                         // minor-unit or float; formatted via Intl
type ChartState = "loading" | "error" | "empty" | "ready";

interface ValuePoint {
  /** ISO date or period bucket key driving the x-axis label (e.g. "W1"…"NOW"). */
  t: string;
  /** Portfolio value at t. Plotted — never invented. */
  value: Money;
  /** Net deposits at t (the purple dashed benchmark). */
  netDeposits: Money;
}

interface ValueStats {
  currentValue: Money;
  netDeposits: Money;
  trueGrowthAbs: Money;        // +1240
  trueGrowthPct: number;       // +9.5
  periodHigh: Money;           // MUST equal the peak actually drawn after down-sampling
  periodLow: Money;            // MUST equal the trough actually drawn after down-sampling
  startOfRange: Money;
  /** Any missing stat renders an em-dash "metric to confirm" tag — never fabricated. */
}

interface ValueChartProps {
  /** The plotted series. Empty array -> "empty" state. */
  data: ValuePoint[];
  /** Headline figures for the hero overlay + expand rows. */
  stats?: Partial<ValueStats>;
  /** Drives loading / error / empty / ready in-frame states. */
  state?: ChartState;
  onRetry?: () => void;                      // wired to the error-state Retry button

  /** Per-screen pigment accent (binding map). Default "teal" (Dashboard).
   *  Swaps --accent / --accent-dk only; ink/cream/purple/gain/loss stay locked. */
  accent?: "teal" | "lime" | "magenta" | "sky" | "violet" | "amber" | "gold";

  /** "feature" = collapsed Dashboard tile; "expanded" = modal big render. */
  variant?: "feature" | "expanded";

  /** Locale + instrument currency for ALL Intl formatting. The component NEVER
   *  invents a symbol: if currency is omitted it falls back to the account's
   *  instrument currency, never to "$"/en-US. */
  locale?: string;                           // default navigator.language
  currency: string;                          // REQUIRED, e.g. "GBP" (or instrument default)

  /** Y-domain is ALWAYS data-derived from value[] ∪ netDeposits[] with labelled
   *  padding — there is no fixed-domain escape hatch; the axis is never truncated
   *  to exaggerate a trend. */

  /** Scrubbing. */
  scrubbable?: boolean;                       // default true
  defaultScrubIndex?: number;                 // default last point (NOW)
  onScrub?: (index: number, point: ValuePoint) => void;

  /** Expand wiring (registers EXP.value; honours ?expand=value + Esc). */
  expandKey?: string;                         // default "value"
  onExpand?: (key: string) => void;

  /** Worded key-insight aria-label; auto-derived from stats via Intl if omitted,
   *  and MUST describe the drawn (down-sampled) series. */
  ariaSummary?: string;

  /** Down-sample >maxPoints for the default view via an EXTREMA-PRESERVING method
   *  (LTTB / min-max bucketing) so peak/trough callouts match the drawn line;
   *  drill-down on zoom. */
  maxPoints?: number;                         // default 400
  className?: string;
}

declare function ValueChart(props: ValueChartProps): JSX.Element;

// Internal (kept identical to the shipped idiom):
//   drawValue(c: HTMLCanvasElement, big: boolean): void   // 3-pass ink/accent-dk/accent line,
//        purple dashed deposits + faint purple area, accent-gradient area, ink+accent node squares,
//        .12-alpha gridlines + dashed-ink baseline + halftone tick stubs (house-texture beat),
//        Space-Mono axis labels, DATA-DERIVED y-domain (no fixed 7.5–15).
//   fitCanvas(c), line(ctx, pts, col, w)                  // shared helpers
//   useScrub(ref): { index, tooltip, onPointerMove, onKeyDown }  // crosshair + tooltip, no geom recompute
//   formatMoney(v, locale, currency) / formatPct(...)     // Intl wrappers; never string-concat a symbol
//   sampleExtrema(data, maxPoints)                        // LTTB/min-max, preserves high/low
//   EXP.value = { head:"Value Over Time", sub, draw: drawValue, rows }  // boxed-tag modal, 1 hero row
```

### True-growth gauge — adversarial verification

## True-Growth Gauge — Craft Spec

The canonical **gauge tile**: a 180° semicircle dial reading the period **true-growth %** (portfolio return with deposit inflows stripped out — your money's *real* work, not money you merely paid in). It is the signed-KPI-vs-range widget of the system. It already exists as `drawGauge(c, big)` on `#cv-gauge` in the shipped Dashboard (`prototypes/dashboard-final.html` L695–736, ported in `src/screens/dashboard/Dashboard.tsx`). **This spec hardens and componentizes that exact viz — it does not redesign it.** Every *visual* value below is the shipped value; the *data-honesty* upgrades (value-from-props, Intl formatting, derived aria) are the explicit hardening delta over the shipped canvas, which currently hard-codes `+9.5%` and a literal `frac` (L719, L729–730).

### Why it's a gauge (and stays one)
A gauge is correct *only* for a single bounded value against a signed range — never a trend. True-growth-over-time belongs in the `drawValue` line chart; the gauge shows the *one number now* against its `min … max` band (shipped `-10 … +20`). Do not repurpose this component for a series.

---

### 1. Visual anatomy (hand-built `<canvas>`, never SVG/Recharts)

Drawn on a raw 2D `<canvas>` via `fitCanvas(c)` (backing store = CSS box × `min(dpr,2)`, ctx pre-scaled, returns `{ctx,w,h}` in CSS px). SVG is reserved exclusively for the `#ntMarble` liquid-marble texture. Layered back-to-front, all geometry hand-authored anchor-by-anchor:

1. **Track** — the unfilled remainder arc. `strokeStyle 'rgba(20,17,13,.14)'` (ink-tinted, never `#eee`/zero-chroma), `lineWidth = trackW`, `lineCap 'butt'`. `arc(cx,cy,r, π, 0)`.
2. **Tick ladder** — 11 radial ink ticks (`t=0..10`), `'rgba(20,17,13,.4)'`, `lineWidth 2` (collapsed) / `3` (big), drawn from `r+13 → r+7` (collapsed) / `r+24 → r+12` (big). *Craft upgrade — a deliberate hand-authored deviation from the shipped uniform tick loop (which reads instrument-generic, Lens-4):* give the ticks a **stamped rhythm** — the three anchor ticks at frac 0 (the `min` bound), the zero-growth mark, and frac 1 (the `max` bound) draw at `lineWidth +1` and extend `+4px` longer, so the scale reads hand-made, not a default dial. The **zero-growth tick** (the 0% boundary, `frac = (0 − min)/(max − min)`) carries a 1px-longer stub — the honest reference for "broke even." These anchors are computed from the `min`/`max` props, never pinned to literal −10/+20.
3. **Value arc — the ink-offset idiom (mandatory house signature).** Drawn twice: first the **ink shadow arc** (`INK`, `lineWidth = trackW + 3` collapsed / `+4` big), then the **accent arc on top** (`lineWidth = trackW − 1` / `−2`). Arc length is `arc(cx,cy,r, a0, av)` where `av = a0 + (a1−a0)·frac` and **`frac = (value − min) / (max − min)`** — proportional by construction (honest geometry; a +9.5% on −10…+20 → `frac 0.65`).
4. **Needle** — ink line from hub center to `r + 4/6`, `lineWidth 5/9`; **ink hub** disc (`r 8/14`) with an **accent hub cap** disc (`r 4/7`) on top — the radial echo of the ink-square node markers used elsewhere.
5. **Big-mode on-canvas labels only:** Anton `900 64px` hero figure (the locale-formatted `value`, e.g. `+9.5%`) centered at `cy − r·0.22`; Space Mono `700 20px` `TRUE GROWTH` caption beneath; Space Mono `13px` end labels at the arc tips showing the **locale-formatted `min` / `max` bounds** (shipped `-10%` / `+20%`), not hard-coded strings. **Collapsed mode draws NO text** — the headline number lives in the adjacent DOM `.greadout` column (shipped convention; canvas big-numbers appear only when `big=true`).

**DOM containment (shipped, do not re-nest):** the `.span2` tile is a `.tl-body` flex row of `.gwrap` (the canvas, `position:absolute; inset:0`) beside `.greadout` (the DOM readout). One containment layer: `border: 6px solid ink`, `box-shadow: 10px 10px 0 ink`, `clip-path` parallelogram (`--slant 16`), `border-radius: 0`. **No card-in-card, no fake instrument bezel** — the only curve in the system is the global CRT bezel.

### 2. Colour & encoding

One pigment accent per screen, keyed by the per-screen map; **on the Dashboard that accent is `--teal #19E5E5`**, and that is the colour the positive value arc draws in. **The accent is NOT the gain semantic colour** — they are two distinct tokens that merely happen to both sit in the teal family on this one screen. `--teal #19E5E5` = the bright primary accent (arc + hub cap). `--gain #2FB5A8` (a.k.a. `TEAL2`, also a marble vein) = the gain *semantic*, used only on the readout sign/figure. Conflating them is a token-drift bug (canon DESIGN_PRINCIPLE.md L40; shipped consts L600–601). Accent footprint stays the value arc + hub cap only (≈3% of tile area). All chrome is ink-tinted neutral.

| Element | Token / value | Role |
|---|---|---|
| Track, ticks | `'rgba(20,17,13,.14)'` / `'.4'` (from `--ink`) | neutral chrome, ≥0.005 chroma |
| Value arc shadow, needle, hub, frame | `--ink` `#14110D` | outlines/axes/shadows |
| Value arc, hub cap (Dashboard accent) | `--teal` `#19E5E5` | the per-screen pigment accent (NOT the gain token) |
| Value arc, hub cap (negative reading) | `--loss` `#C8402F` | semantic loss hue |
| Gain semantic (readout sign + figure, positive) | `--gain` `#2FB5A8` | the only gain semantic colour, ≠ `--teal` |
| Panel fill | `--cream` `#EDE6D2` | data substrate |

**Gain/loss is never colour-only (hard rule).** The sign is the second channel: the `.greadout` and hero figure always carry an explicit `+`/`−` and a `▲`/`▼` triangle glyph; when the reading is negative the arc flips to `--loss` *and* the needle crosses to the left of the zero-growth mark *and* the readout shows `▼ −X.X%`. Distinguishable in a CVD emulator with hue removed. **Never invent the number** — `value`, `min`, `max`, `period` come only from props; with no real value the gauge renders the em-dash empty state (§7), never a placeholder reading.

### 3. Type

Canvas and DOM share one face stack — numbers feel stamped from the same press. **Anton** `900` for the hero figure (64px big / DOM `.greadout` figure collapsed); **Space Mono** `700` for the `TRUE GROWTH` caption, the end labels and any monetary sub-readout; **Oswald** `600/700` uppercase wide-tracked for the tiny `TRUE GROWTH` / range labels. Set `ctx.font` with the family quoted (`"900 64px 'Anton'"`). The hero figure and end labels are **formatted from props via `Intl.NumberFormat`** (§6), not the shipped hard-coded `'+9.5%'` / `'-10%'` strings — that is this spec's data-honesty hardening over the prototype canvas. **All numeric DOM readouts get `font-variant-numeric: tabular-nums`** and fixed decimals so a live tick never reflows. **Roman only** — `font-style: normal` on every figure, caption, and label; emphasis via weight/accent, never italic. Banned: system-ui / Inter / Roboto / any thin weight. Draw only after `document.fonts.ready` with the shipped re-draw passes (rAF + 240ms + 380ms).

### 4. Motion (≤ 2 primitives, transform/opacity only)

**Entrance (one orchestrated stamp on first load, then static):** the value arc **fills in** by animating a `@property`-typed angle that the `requestAnimationFrame` redraw reads to advance `av` from `a0` to its final fraction over `--dur-long 420ms`, `--ease-out cubic-bezier(0.16,1,0.3,1)`. This is arc-length growth via the draw loop's interpolated value — **never** animating canvas geometry width/height attributes, never recomputing on scroll. The needle and hub fade up (`opacity`) in the same window. Staggered by tile DOM index (`--i × 60ms`, total cap ~500ms). **No bounce/elastic, no spinning needle, no sweep — no perpetual motion.**

**Hover / select (the comic-collage kick, transform only):** the tile lifts `translate(-3px,-3px)` and the hard ink offset shadow deepens `10px → 9–11px` (toward `--tealdk`) over ~120ms, `cubic-bezier(0.2,1.4,0.3,1)` snap. Exactly **one** hover signal at the tile level; the canvas content does not re-tween on hover.

**Reduced-motion (mandatory fallback):** `@media (prefers-reduced-motion: reduce)` paints the **final arc fraction immediately** (no fill-in), final figure shown at frame one, `animation: none`, marble SMIL paused (`svg.pauseAnimations()`), drift slowed to ~180s. Data is fully legible before any animation — values are never gated behind motion completing.

### 5. Click-to-expand (shipped `EXP['truth']` modal)

The tile is one click target opening `#expand` (fixed overlay `z-index:100`, **above** the CRT `z90`, outside the clipped stage), with `?expand=truth` deep-link and Esc-to-close. Two-column **"big viz left, clear numbers right"** (explicitly *not* a spreadsheet): LEFT redraws `drawGauge(#cv-exp, true)` (radius `0.42·min`, Anton hero, end labels from `min`/`max`); RIGHT is the alternating-band `rows[]` of **boxed value tags** (Space Mono, `2.5px` ink border + `3px` ink offset, gain→`--gain` / loss→`--loss` fill) with one full-ink **hero** row. The shipped `rows` are honest and unchanged: `hero True growth +9.5% gain`, `True P/L +£1,240`, `Net deposits £13,000`, `Money-weighted (XIRR) 13.4%`, `Time-weighted 11.8%`, `Day change +£84 gain`, `Range -10 … +20`. These are caller-supplied (`expandRows`), never invented by the component. The React modal redraws on `rAF` after layout settles and on a `ResizeObserver`.

### 6. Data → numbers relationship (honest by construction)

- `frac = (value − min) / (max − min)`, `av = π + (0 − π)·frac` → **arc length is a direct linear function of the value** against the *signed* range. The shipped `-10 … +20` band is asymmetric on purpose (downside is shorter), and that asymmetry is drawn truthfully — no re-centering, no truncation. (The componentized version reads `value`/`min`/`max` from props; the shipped canvas hard-codes them — replacing those literals is part of this hardening.)
- The hero figure is `value` formatted via `Intl.NumberFormat(locale, {style:'percent', minimumFractionDigits:d, maximumFractionDigits:d})` with an explicit `+`; money sub-readouts via `Intl.NumberFormat(locale,{style:'currency',currency})` — never hard-coded `$`/en-US, never string concatenation. The end labels format `min`/`max` the same way.
- The needle points at the *same* `av` the arc ends at — figure, arc, and needle are one source of truth; they can never disagree.

### 7. Empty / loading / error / a11y

- **Empty** (`value == null`): track + ticks drawn, **no arc/needle**, `.greadout` shows an em-dash on a labelled grey block — `— · TRUE GROWTH PENDING` — plus a short guide line ("Add a position to compute true growth"). Honest number-shaped hole, never a fake reading.
- **Loading:** shape-matched skeleton — the track arc at low opacity with a quiet shimmer, **not** a spinner over a bare dial.
- **Error:** in-frame message + a Retry affordance that re-runs the fetch.
- **a11y:** the `<canvas>` gets `role="img"` + an `aria-label` **derived from the live props** (value/min/max/period/sign), not a frozen string — e.g. "True growth +9.5%, within a −10% to +20% range; up on the period" — so it can never lie when `value` changes. The number is also exposed as real DOM text in `.greadout`, not only as arc length. A visually-hidden mirror exposes value / min / max / period. The tile is keyboard-focusable with an **instant** (non-animating) `:focus-visible` ink ring; Enter/Space opens the expand modal (the same affordance touch users tap), hit area ≥ 44×44px. Decorative halftone/marble around it is `aria-hidden`.

### 8. House texture (mandatory, never over the dial)

Ben-day halftone (`radial-gradient`, ~6% ink dots) sits **under** the cream tile, clipped to cream, well below the arc contrast — texture is finish, never foreground. The animated liquid marble appears only on the tile/modal **frame ring**, never behind the gauge or its numbers. The tile sits under the same global `#crt` overlay and shared halftone grit as every screen.

### Anti-slop checklist (must all pass as a still)
Hand-built canvas (no Recharts/SVG chart) ✓ · ink-offset arc idiom ✓ · one accent (`--teal`, kept distinct from the `--gain` semantic) over ink-tinted neutrals, ≤3% ✓ · no zero-chroma chrome, no pure #000/#fff ✓ · square corners + hard zero-blur offset shadow ✓ · tabular-nums, roman, fixed decimals ✓ · proportional/honest arc on a true signed range, value+bounds from props ✓ · stamped non-uniform tick rhythm (anchors + zero mark), not a default dial ✓ · gain/loss carries sign+triangle, not hue alone ✓ · transform/opacity-only motion, one entrance, reduced-motion snap ✓ · `role=img` + prop-derived worded aria insight + DOM number + 44px focusable target ✓ · Intl-formatted figure/labels, no hard-coded `$`/`%`/range strings ✓ · all colours/fonts via named tokens, no inline drift, accent≠gain ✓ · marble/halftone on frame only ✓.

**Component API**

```ts
// Reusable React wrapper over the shipped drawGauge(c, big) canvas idiom.
// Renders the .span2 tile (canvas + DOM .greadout) and registers the EXP['truth'] modal.
// Hardening delta over the shipped prototype: value/min/max come from props (the shipped
// canvas hard-codes +9.5% and a literal frac), the hero figure + end labels are Intl-formatted,
// and the aria-label is DERIVED from the live reading, never a frozen string.

type GaugeReading = {
  value: number;          // REQUIRED true-growth %, caller-supplied. null => empty state (never invent)
  min: number;            // signed range floor (shipped: -10)
  max: number;            // signed range ceiling (shipped: +20)
  period?: string;        // e.g. "30D" — labels the reading, not the number
};

type GaugeExpandRow =
  | [label: string, value: string, kind: 'plain' | 'gain' | 'loss']
  | ['hero', label: string, value: string, kind: 'plain' | 'gain' | 'loss'];

interface TrueGrowthGaugeProps {
  reading: GaugeReading | null;            // null/undefined -> empty ("metric to confirm")
  state?: 'populated' | 'loading' | 'error';   // drives skeleton / retry; default inferred from reading
  onRetry?: () => void;                    // error-state retry affordance

  // Identity / consistency
  // NOTE: the per-screen ACCENT and the GAIN semantic are deliberately separate tokens.
  // On Dashboard accentToken resolves to --teal #19E5E5 (arc + hub cap); the gain semantic is
  // always --gain #2FB5A8 (readout sign/figure). Do not pass the gain token as the accent.
  accentToken?: `--${string}`;             // per-screen pigment for the arc; Dashboard => '--teal' (default)
  gainToken?: `--${string}`;               // semantic gain hue for the readout; default '--gain' (#2FB5A8)
  lossToken?: `--${string}`;               // semantic loss hue (arc + readout when negative); default '--loss'
  chartKind?: 'gauge';                     // locked; documents data-shape match (single bounded value)

  // Formatting (locale-aware, never hard-coded en-US/$). Drives the canvas hero figure,
  // the min/max end labels, the .greadout figure, and the derived aria-label.
  locale?: string;                         // default navigator.language
  currency?: string;                       // for money sub-readouts in the modal (e.g. 'GBP')
  percentDecimals?: number;                // fixed decimals, tabular-nums (default 1)

  // Expand modal (shipped EXP['truth'] contract: big viz left, boxed-tag numbers right)
  expandKey?: string;                      // deep-link key, default 'truth'
  expandHead?: string;                     // default 'True Growth'
  expandSub?: string;                      // default 'Growth excluding deposit inflows'
  expandRows: GaugeExpandRow[];            // honest, caller-supplied; exactly one 'hero' row
  onExpand?: (key: string) => void;        // opens #expand overlay (z-100, ?expand=, Esc-close)

  // Accessibility (required). Optional override; if omitted, the component DERIVES the worded
  // key insight from value/min/max/period/sign so it can never disagree with the rendered number.
  ariaLabel?: string;                      // e.g. "True growth +9.5%, range -10% to +20%, up on period"

  className?: string;
}

// Internal canvas contract (visuals unchanged from shipped Dashboard; data now prop-driven):
//   function drawGauge(c: HTMLCanvasElement, big: boolean): void
//   - fitCanvas(c) -> { ctx, w, h } (backing store = CSS box * min(dpr,2))
//   - frac = (value - min) / (max - min); av = PI + (0 - PI) * frac  (proportional, honest)
//   - ink-shadow arc (lineWidth trackW + 3/4) UNDER accent arc (trackW - 1/2);
//     accent = --teal #19E5E5 when value >= 0, --loss #C8402F when value < 0 (accent token, NOT --gain)
//   - 11 ticks + stamped anchor ticks at frac 0 / zero-growth / frac 1 (anchors computed from min/max)
//   - ink needle + ink hub + accent hub cap; needle crosses left of the zero mark when negative
//   - big=true only: Anton hero % (Intl-formatted value), Space Mono caption + end labels
//     (Intl-formatted min/max); collapsed draws NO text
//   - draw after document.fonts.ready (rAF + 240ms + 380ms re-draws)
//   - prefers-reduced-motion: paint final arc fraction immediately, no fill-in tween
declare function TrueGrowthGauge(props: TrueGrowthGaugeProps): JSX.Element;
```

### Allocation Donut — adversarial viz-craft verification

## Archetype: Allocation Donut

Part-to-whole proportion ring for portfolio composition — holdings or sectors as cut-paper wedges summing to 100%, with legible tickers and exact weights. This is Actuality's canonical composition viz, already shipped in the Dashboard as `drawDonut(c, big)` (`src/screens/dashboard/Dashboard.tsx`). The spec below promotes that shipped function into a reusable, fully-accessible `<AllocationDonut/>` component **without changing its look on the Dashboard** — every visual decision here matches the signed-off Dashboard, then closes the gaps the shipped version leaves (states, a11y, touch/keyboard, tooltips, slice-cap discipline, accent-collision).

**Hard rule (governs all of the below):** distinctive treatment must never cost legibility or truthful numbers. The donut renders only the weights the caller supplies; it never invents a percentage, never normalises a number into existence, and never draws a wedge whose arc is not exactly `weight/total × 2π`.

**Signed-off-parity rule:** the shipped Dashboard donut shows **7 wedges**. To reproduce it pixel-for-pixel the Dashboard instance MUST pass `maxSlices={7}` (7 is the stated ceiling and the shipped donut reads at 7). The component default is `6` for *new* callers; the Dashboard override is mandatory so the signed-off render never silently regresses into `5 wedges + OTHER`.

### Visual anatomy
One shallow DOM: a clip-path parallelogram tile (the shared tile system — `border: 6px solid var(--ink)`, `box-shadow: 10px 10px 0 var(--ink)`, `clip-path` via `--slant`, **never** `skewX`, **never** `border-radius`) containing exactly one absolutely-positioned `<canvas>` (`inset: 0; width/height: 100%`), the DOM head bar, and **one absolutely-positioned transparent DOM hit-layer** of `<button>`s (one per wedge + one per legend row) that owns all interaction, focus and tooltips (see Accessibility). **Raw 2D `<canvas>` only — no SVG `<path>` wedges, no Recharts/D3/Chart.js.** SVG is reserved for the `<NtMarble/>` texture and never touches the data plane.

The canvas sits **flat** inside the clip-path tile — **no skew is applied to the canvas** (the shipped system neutralises `--skew/--unskew` to `0deg` and gets all lean from `clip-path`, never `skewX`). Because nothing skews the canvas, the ring is already a true circle and all canvas type sits level; the tile's diagonal lean comes from `clip-path` alone. Composition is left-biased (`cx = W*0.36` collapsed, `W*0.40` big) so the ring sits off-center with negative space to its right — never centered in dead space. The tile cascades on the screen's single diagonal spine.

Render order on canvas (the cut-paper idiom):
1. **Wedges**, clockwise from `-90°` (top). Each wedge is drawn as a filled `moveTo(cx,cy) → arc(cx,cy,R,a,a+ang) → closePath`, then the *same path re-stroked* in `INK` at `lineWidth` 3 (collapsed) / 4 (big). The ink outline on every wedge **is** the donut's version of the hard offset-shadow — it is what stops this reading as a generic Chart.js pie. Do not skip it.
2. **Center hole**, `r = R*0.55`, filled `CREAM2` and ink-stroked at the same weight — a punched paper hole, square-edged everywhere else on screen but necessarily circular here.
3. **Center stamp** (collapsed and big): Anton holding-count + Oswald `HOLDINGS` caption, centered, framed by a thin square ink rule so it reads as a *printed stamp* rather than a default pie-center label. Per the shipped convention the hero number lives here on canvas (the donut is the one collapsed viz that carries its center number, unlike the gauge/feature chart which defer to the DOM overlay). The count is **static and centered** (no live tween), so non-tabular Anton glyphs never jitter; any DOM mirror of the count uses `tabular-nums`.
4. **Legend** (big mode only): right-side stack at `lx = W*0.74`. Ink-stroked color swatch square (18×18, `lineWidth 2.5`) + Oswald ticker (left) + right-aligned Space Mono percent **drawn as a small boxed tag** (square, `2.5px` ink stroke + `3px` hard ink offset, no radius) so the legend speaks the same tag language as the modal `.val` chips and never reads as plain SaaS data text. Collapsed mode draws **no legend** — labels live in the expand modal.

Texture: ben-day halftone (`radial-gradient`, 1.35px dot / 15px grid / .07 opacity, `mix-blend-mode: multiply`) sits **under** the cream tile, never over wedges or numbers. Marble appears only if this tile borrows a marble rail/border — never behind the ring.

### Colour & encoding
Cream substrate, ink marks. Wedge colours come **from the data** — each `Holding` carries its own hex, exactly as shipped (`ALLOC` tuples `["NVDA",24,"#19E5E5"]…`). The shipped palette grades teal→purple→semantic and is the locked vocabulary; reference these as named tokens, do not invent new hues:
- Primary/largest wedges step through the teal family: `--teal #19E5E5` → `--gain/--teal2 #2FB5A8` → `--teal-dk #0E8A86`.
- Mid wedges step through the marble purples: `--purple #5D5A86` → `#7370A0`.
- The smallest tail wedges carry the only saturated non-teal marks: `--loss #C8402F`, then `--orange #FF5A1F`.

This is one tinted scale plus the gain/loss/warning semantics — **not a rainbow**.

**Accent / teal-collision discipline (mandatory).** The canonical signature accent is orange (`--orange`); the per-screen map (a binding constraint layered on top of the canon) sets Dashboard's accent to teal. Because the *largest wedge is already filled `--teal #19E5E5`*, the active/focus signal MUST NOT be "invert the wedge to `--accent` fill" when `--accent` is in the teal family — that would paint teal on teal and make the signal vanish. Resolution: the active/selected wedge signal is colour-aware:
- If the active wedge's own fill is **not** within the accent's hue family → invert that wedge to the screen `--accent` fill with cream ink-stroke (one signal).
- If the active wedge's fill **is** within the accent family (e.g. the largest teal wedge on the teal Dashboard) → the signal instead becomes a **cream fill + thickened ink stroke** redraw, so the accent is always perceptible and never accent-on-itself.

Exactly **one** signal at a time. On non-teal screens that reuse this component (e.g. Positions=magenta), the active accent swaps to that screen's mapped pigment via a single `--accent` token; the wedge fills themselves stay the supplied per-datum palette.

Wedge separation is carried by the **ink outline + ordering**, never by hue alone, so a colour-blind user reads the boundaries and the legend/labels regardless. Gridline/chrome rule: nothing here is pure `#000`/`#fff` — ink is `#14110D`, hole is `CREAM2`, all anchor-tinted.

### Slice discipline (≤5–6 ideal; Dashboard pinned to 7)
The archetype targets ≤5–6 wedges for legibility; the shipped donut shows 7 and reads, so 7 is the ceiling. The component enforces this with a `maxSlices` prop: holdings beyond the cap collapse into a single ink-outlined `OTHER` wedge whose weight is the **exact sum** of the remainder (an honest aggregation, never a padded one). The center count still reflects true total holdings (`N HOLDINGS`), and the expand modal lists every underlying holding so nothing is hidden — only the visual ring is simplified. `OTHER` always sorts last and uses a neutral anchor-tinted step, never the accent. **The Dashboard instance passes `maxSlices={7}` to preserve the signed-off render.**

### Type
- Center number: `900 30px 'Anton'` (big) / `900 17px 'Anton'` (collapsed), uppercase, roman.
- Center caption + legend tickers: `700 17px 'Oswald'` (big) / `8–10px 'Oswald'`, uppercase, wide tracking.
- Legend percents + all money: Space Mono, with `font-variant-numeric: tabular-nums` on every DOM numeric readout (tooltip, expand rows, head-bar count, count mirror) so weights never jitter. Canvas Space Mono is inherently tabular; the canvas Anton count is static/centered so it never reflows.
- **Banned:** system-ui / Inter / Roboto / any thin weight; no italic on any number, caption, or title. Draw only after `document.fonts.ready` with the established re-draw passes (rAF + 240ms + 380ms) so Anton/Space Mono are loaded before first paint.

### Data → numbers relationship
`weight` per holding is the supplied figure; the wedge angle is `weight/total × 2π` and the center count is `centerCount ?? holdings.length` — both derived, never invented. (The shipped donut hard-codes `"7"`; the component derives the count, which is the correct fix, not a divergence.) The component computes `total = Σ weights`. If `total` is not within tolerance of 100 (e.g. 99.7), it does **not** silently rescale the displayed numbers — it renders the true supplied weights and exposes the residual in the modal (`Unallocated` row) rather than faking a clean 100%. Largest-position hero = `max(weight)` holding, computed, matching the shipped `["hero","Largest position","NVDA 24%"]` row.

### States (all four mandatory, in-frame, never a broken ring)
- **Empty** (new/empty account): ink-outlined empty ring stamp + Oswald message `NO HOLDINGS YET` + a real focusable cream-tile CTA `ADD A POSITION` (DOM button, not canvas chip) — never blank axes. Live region `aria-label="No holdings yet"`.
- **Loading:** shape-matched skeleton — a single ink-stroked ring outline + a shimmering hole, **not** a spinner. Shimmer is opacity-only. Live region `aria-label="Loading allocation"`.
- **Error:** ink message `COULDN'T LOAD ALLOCATION` + a real focusable square ink-outlined `RETRY` DOM button that re-runs the fetch. Live region `aria-label="Could not load allocation"`.
- **Populated:** the ring.

### Motion (snappy stamp/kick — ≤2 primitives, transform/opacity OR canvas redraw only)
One orchestrated entrance on first mount: each wedge **sweeps in** by interpolating a `--sweep` arc fraction via rAF over `--dur-long` 420ms with `--ease-out cubic-bezier(0.16,1,0.3,1)`, staggered by wedge index (`--i * 60ms`, capped ~500ms total). Geometry is never recomputed via width/height; the sweep is a single interpolated angle re-arced on the canvas. After entrance the ring is static — no perpetual rotation, no sweep loop.

Interaction kick (the house stamp): on hover/focus/active of a wedge's hit-button or a legend row, the active wedge **pops via a canvas redraw** — the active wedge is re-drawn at a slightly larger radius and/or a deepened ink offset over ~120ms with `cubic-bezier(0.2,1.4,0.3,1)` (the one sanctioned overshoot, on the data card not on bars). **A wedge is canvas pixels, not a DOM node — there is no CSS `transform` on a wedge; the pop is always a redraw.** The DOM tile itself may additionally deepen its ink offset 10→11px if the whole tile is the affordance. The active-wedge colour signal follows the accent/teal-collision rule above. Exactly **one** signal at a time — pop OR colour-change leads; do not stack scale+offset+colour+glow.

`@media (prefers-reduced-motion: reduce)`: entrance paints the final full ring instantly (`--sweep` at final, no rAF tween), hover drops to an instant 1px ink-outline thickening with no scale, `<NtMarble/>` SMIL pauses (`svg.pauseAnimations()`) and drift slows to 180s. Values are fully readable at frame one regardless of motion.

### Click-to-expand (mandatory EXP contract)
The tile is clickable/tappable/Enter-Space-activatable and opens `#expand` (fixed, `z-index 100`, above the CRT at z90, outside the clipped stage), deep-linkable via `?expand=alloc`, Esc-to-close. Two-column modal: **left** redraws `drawDonut(cv-exp, true)` (bigger ring + right-side legend); **right** `.exp-data` is the alternating-band boxed-tag list — every holding as a `['NVDA','24%','plain']` row, a full-ink **hero** band `['hero','Largest position','NVDA 24%','plain']`, plus an `Unallocated` row when total ≠ 100 and the full `OTHER` breakdown when slices were capped. Numbers are boxed Space Mono value tags (2.5px ink border + 3px ink offset-shadow, no radius), **not** a spreadsheet. The modal canvas redraws via `ResizeObserver` on `.evbody`.

### Accessibility & functional contract
- The `<canvas>` itself is **`aria-hidden="true"`** (it is a pure raster). The component's accessible name is a **visually-hidden live text node** stating the **key insight in words**, e.g. `"Allocation across 7 holdings; largest NVDA at 24%, smallest AMD at 6%."` — never just decorative. (Putting `role="img"` on a container that also holds focusable interactive children is an ARIA conflict — the img subtree is pruned — so the canvas is hidden and the semantics live on real DOM instead.)
- A visually-hidden `<table>` mirrors every holding + weight (ticker, weight%), so the data is not opaque to screen readers; in the modal this table is the real numbers list. Numeric cells use `tabular-nums`.
- **Interaction lives on a transparent DOM hit-layer**, not on the canvas: one absolutely-positioned `<button>` per wedge (positioned over the wedge centroid) and per legend row. Each is keyboard-focusable, reachable on touch, with a **≥44×44px hit area** (transparent padding even where the visible swatch is small) and an **instant** ink focus ring (no transition on outline). This DOM layer is the only way canvas wedges can be tabbable, tappable and focus-ringed.
- Tooltip shows ticker + exact weight on hover **and** tap **and** focus — the value is never hover-only; hover-delay 800ms, focus-delay 0ms. The tooltip container obeys the visual language: square (`border-radius: 0`), `border: 2.5px solid var(--ink)`, `box-shadow: 3px 3px 0 var(--ink)` (zero blur), Oswald ticker + Space Mono `tabular-nums` weight — never a rounded soft-shadow default tooltip.
- Weights are not a gain/loss signal, so no red/green channel is needed on the ring itself; but anywhere a holding's P/L appears alongside (modal, tooltip secondary line) it carries a `+`/`-` sign + ▲/▼ **derived from the sign of the value** (never a separately-stored sign that could disagree), in addition to teal/loss colour — never colour-only.
- Locale formatting: weights via `Intl.NumberFormat(locale,{style:'percent'})` — including the strings passed to canvas `fillText` (no hard-coded `'%'` concatenation) — and any money via `Intl.NumberFormat(locale,{style:'currency',currency})`. Never hard-coded `%`/`£`.
- All colours/fonts reference named `:root`/`.screen` tokens (`--ink`, `--cream/2`, `--teal/2/dk`, `--gain`, `--loss`, `--purple`, `--orange`, `--accent`, `--slant`, `--dur-*`, `--ease-out`) — no inline hex in fills/strokes beyond the per-datum supplied wedge colour, no mid-render token drift.

### Anti-slop checklist (must pass as a still)
No rounded wedge caps, tile corners, or tooltip corners; no soft/blurred shadow anywhere; ink outline on every wedge; one accent + tinted scale, no rainbow; accent signal never painted teal-on-teal; legend percents boxed as ink tags, not plain text; center stamp framed as printed, not a default pie-center; no marble/gradient over the ring; halftone present under the cream; Anton/Oswald/Space Mono only, roman, tabular; ≤6 wedges for new callers (Dashboard pinned to 7), rest → honest `OTHER`; arc length exactly proportional to weight; locale-formatted percents (no string concat); entrance once, then static; wedge pop is a canvas redraw (never a CSS transform on a non-existent node); reduced-motion snaps to full ring.

**Component API**

```ts
```tsx
// Reusable allocation-donut. Wraps the shipped drawDonut(c, big) idiom in a
// tile + states + a11y + expand. Canvas-only data plane; no chart lib; no SVG
// wedges. Interaction lives on a transparent DOM <button> hit-layer over the
// canvas (canvas pixels can't be tabbed/focus-ringed/CSS-transformed); the
// active-wedge "pop" is a canvas REDRAW, not a CSS transform.

type Holding = {
  ticker: string;          // e.g. "NVDA" — Oswald uppercase label
  weight: number;          // exact supplied % (NOT invented/rescaled)
  color: string;           // per-datum wedge hex from the locked palette
  pnl?: number;            // optional signed P/L for tooltip/modal secondary line.
                           // sign + ▲/▼ are DERIVED from Math.sign(pnl) — never a
                           // separately-stored sign that could disagree; never colour-only.
};

type DonutDatum = Holding;

interface AllocationDonutProps {
  data: DonutDatum[];                       // ordered largest→smallest by convention
  state?: 'populated' | 'loading' | 'empty' | 'error'; // default inferred from data
  maxSlices?: number;                       // default 6 for new callers; remainder → honest OTHER
                                            // wedge. Dashboard MUST pass 7 to match the
                                            // signed-off render (else it regresses to 5+OTHER).
  centerCount?: number;                     // holdings count for "N HOLDINGS"; default data.length
                                            // (shipped donut hard-codes "7"; this derives it)
  accent?: string;                          // screen pigment token name; default --teal (Dashboard).
                                            // When accent is in the teal family, the active-wedge
                                            // signal auto-switches to cream-fill + thick ink stroke
                                            // so the largest (teal) wedge is never accent-on-itself.
  locale?: string;                          // Intl locale; default user locale (formats canvas % too)
  currency?: string;                        // ISO code for any money in tooltip/modal

  // expand contract (EXP map entry rendered as big viz + boxed-tag numbers)
  expandKey?: string;                       // default 'alloc'; enables ?expand= deep-link + Esc
  expandHead?: string;                      // default 'Allocation'
  expandSub?: string;                       // default `Weight by position · ${n} holdings`
  onExpand?: (key: string) => void;

  // a11y — worded insight on a visually-hidden live node + data-table fallback.
  // The <canvas> itself is aria-hidden; this string is the accessible name.
  ariaSummary?: string;                     // default auto: "Allocation across N holdings; largest X at P%, smallest Y at Q%."

  // interaction (owned by the transparent DOM hit-layer, not the canvas)
  onSelect?: (ticker: string) => void;      // wedge/legend button click·tap·Enter·Space
  selectedTicker?: string;                  // controlled active wedge (canvas-redraw pop + accent-aware signal)
  onRetry?: () => void;                     // error-state RETRY button

  className?: string;
}

declare function AllocationDonut(props: AllocationDonutProps): JSX.Element;

// Internal — the shipped draw fn this component hosts, with the count now derived:
//   drawDonut(c: HTMLCanvasElement, big: boolean): void
//   collapsed (big=false): ring + framed center stamp, no legend
//   big=true: larger ring + right-side ink-swatch legend (Oswald ticker + boxed Space Mono % tag)
//   active wedge: redrawn larger / deepened ink offset; accent-aware fill (see `accent`)
// Helpers reused as-is: fitCanvas(c) → {ctx,w,h}; tokens INK/CREAM2/TEAL/GAIN/LOSS/PURPLE/ORANGE.
// Interaction layer: <button> per wedge (positioned at arc centroid, ≥44×44px, instant ink
//   focus ring) + per legend row; owns tooltip trigger (hover 800ms / tap / focus 0ms).
```
```

### Per-Stock P/L Bars

## Archetype — Per-Stock P/L Bars (diverging horizontal P/L by holding)

Realised/unrealised profit & loss per position, drawn as diverging horizontal bars around a true-zero ink axis: gains push right, losses push left, one row per holding, sortable. This is the canonical **signed-per-category** viz and MUST match the shipped Dashboard `drawPL` (src/screens/dashboard/Dashboard.tsx) bar-for-bar — it is a re-skinnable, sortable generalisation of that function, not a new chart.

### Non-negotiable house rules (carry over verbatim)
- **Canvas only.** Drawn on a raw 2D `<canvas>` via `draw(c, big)` using the shipped `fitCanvas(c)` (backing store = CSS box × `min(dpr,2)`, pre-scaled ctx). **No SVG chart, no Recharts/D3/Chart.js.** SVG is reserved exclusively for the `#ntMarble` liquid-marble texture.
- **`border-radius: 0`** on the tile, modal, value tags, axis chips, tooltip — everything. Only the CRT bezel curves.
- **Hard zero-blur ink offset shadows only.** Tile `box-shadow: 10px 10px 0 var(--ink)`; hover `15px 15px 0 var(--tealdk)`. No blur radius > 0 anywhere, including the tooltip and focus ring.
- **Marble never touches data.** Marble lives only on the modal border ring (`.frmarble`) and the optional rail; the bar plane is flat cream, static and crisp.
- **One unified shear** via the shared `clip-path` parallelogram tokens (`--slant 16`, `--slant-sm 9`) — never `transform: skewX`. Bar geometry inside the canvas stays orthogonal (counter-sheared by the tile clip); axis labels read level.

### Visual anatomy (collapsed tile → expanded modal)
Wrapper is ONE shipped `tile()`: `clip-path` parallelogram, `border: 6px solid var(--ink)`, hard ink offset shadow, an ink `.tl-head` ("PER-STOCK P/L" in Anton + an `.ex` teal expand chip), and a `.tl-body` holding the single `<canvas id="cv-pl">`. No card-in-card, no redrawn window chrome. Under the cream tile body sits the global ben-day halftone (`radial-gradient` 1.35px dot / 15px grid / ~.07, `mix-blend-mode: multiply`) — texture is mandatory but stays well below the bars.

**The diverging bar field (the load-bearing draw idiom):**
1. A vertical **ink zero axis** at the horizontal centre (`zero = x0 + (x1−x0)·max/(2·max)`, i.e. mid-span), stroked `rgba(20,17,13,.5)`, width 3 (big) / 2 (collapsed), overshooting the rows by a few px — this is the spine, drawn heavier than any other rule so it reads as a stamped rule, not SaaS chrome.
2. Each holding is one row, top→bottom, sorted (see Encoding). `Xv(v) = x0 + (x1−x0)·(v+max)/(2·max)`; `bh = (y1−y0)/n − gap`. For each bar: **draw a SOLID INK copy first** (`fillStyle = INK`, not alpha), offset `+4px` (big) / `+2px` (collapsed) down-right, then the coloured bar on top — the signature offset-shadow "printed sticker" idiom that separates this from a flat library bar. `left = min(zero, xv)`, `w = |xv−zero|`. Square ends, no rounding, no gradient fill.
3. **Domain is symmetric and honest:** `±max` derived from the real data (`max = niceCeil(max(|values|))`, default ±£600 to match shipped), so a +£540 bar and a −£540 bar are mirror-equal lengths. Never truncate, pad with an invented figure, or offset the zero — the diverging layout's whole point is truthful signed magnitude.
4. **No horizontal gridlines.** A diverging field already has its one heavy ink spine plus per-row geometry; uniform thin `.12` gridlines would only add SaaS chrome. The only axis chrome is the stamped tick rhythm in §craft-beats (heavier ink notches at ±max).
5. **Collapsed:** right-aligned Oswald 700 9px tickers only; the big net figure stays in the DOM overlay, never on the canvas (shipped convention). Per-row signed values are still exposed to AT and on focus via the row `aria-label` + hidden table (see Accessibility) — never hidden behind a hover-only tooltip. **Big/modal:** Oswald 700 16px tickers on the left margin + the signed value drawn **outward from the tip** in Space Mono 700 16px — **gains (`tealdk`) drawn to the RIGHT of the rightward tip (`xv + 8`, `textAlign:left`), losses (`loss`) drawn to the LEFT of the leftward tip (`xv − 8`, `textAlign:right`)** so labels read away from zero and never overlap the bar (matches shipped `drawPL`), plus a faint zero label.

### Colour & encoding (locked grammar — Dashboard accent = TEAL)
- Substrate is **cream** (`--cream #EDE6D2`); all chrome/axis/labels/shadows are **ink** (`--ink #14110D`). The zero axis is the one heavier ink rule; there are no quieter gridlines.
- **Gain = `--gain` `#2FB5A8`, Loss = `--loss` `#C8402F`** (the exact shipped tokens) — these are the only semantic colours, and here they ARE the bar fills. This is the lens-sanctioned exception to DESIGN_PRINCIPLE's "gain/loss tiny / at most once": the entire purpose of this chart is signed P/L, so the gain/loss pair is the encoding, not a field-wide rainbow. No per-ticker hues — every gain bar is the same teal, every loss bar the same red; that single-pair discipline is what keeps it off the rainbow-categorical slop list.
- **Dashboard's single pigment accent is TEAL** — spend it only on the focal/active bar and on the `.ex` chip and the sort-direction caret. The focal signal is a **2px ink-stroke overlay + value-tag swap (non-colour)**, NOT an accent fill: gain-teal and accent-teal are near-identical hues, so an accent fill on a gain bar would be invisible and would collide with the gain encoding. No second competing bright hue inside the chart.
- **Gain/loss never colour-only (HARD rule).** Every signed figure carries a non-colour channel: a **`+` / `−` sign prefix** on every value tag, **and** the bar's geometric side (right = gain, left = loss) is itself a redundant non-colour cue. Add a small ink **▲/▼ caret** on the modal value tags (matching the roster `.badge` ▲/▼) so the sign survives greyscale and CVD. Verify ≥3:1 bar-vs-cream and ≥4.5:1 for every label.

### Type
- Tickers/labels: **Oswald 600/700 UPPERCASE**, wide tracking (`ctx.font = "700 16px 'Oswald'"`). Money values: **Space Mono 700** for tabular alignment. Any hero figure (modal `.hero` row, net P/L): **Anton 900**. Never system-ui/Inter/Roboto, never italic on any figure or title.
- **`font-variant-numeric: tabular-nums`** on every DOM number (value tags, net figure, axis chips, the data-table fallback) so live re-quotes cause zero layout shift; canvas money uses Space Mono for the same column discipline. Right-align numeric columns in the table fallback. Draw only after `document.fonts.ready` (shipped 240/380ms re-draw passes) so Anton/Space Mono are loaded before first paint.
- **All money strings route through the bound `fmt(v, ccy)` `Intl.NumberFormat` formatter** — both DOM tags and canvas `fillText`. No `"+£" + Math.abs(v)` concatenation in the reusable path (the shipped literal is demo-only). Fixed decimals so widths stay constant.

### Sorting
Default sort: **value descending** (biggest gain at top → biggest loss at bottom), matching the shipped `EXP.pl` row order. Sort is a pure data transform on the `positions` array; the canvas re-runs `draw(c,big)` on the reordered array (no per-frame geometry animation — just redraw). Sort affordances (collapsed segmented control or modal `<th>` headers: P/L, |P/L|, ticker, weight) MUST be **keyboard-activatable (Enter/Space)** and expose **`aria-sort="ascending|descending|none"`**, updated on every sort. The accent caret marks the active column/direction.

### Motion (snappy stamp/kick; ≤ a couple primitives; transform/opacity only)
Two primitives, both GPU-only:
1. **Entrance (once, on first load):** bars stamp in via `transform: scaleX()` from `transform-origin` at the **zero axis** (gains grow rightward, losses leftward from true zero — never animate `width`/`x`/rect geometry), staggered by row index `--i * 60ms`, total stagger capped ~500ms. Easing `cubic-bezier(0.16,1,0.3,1)`, `--dur-long` ~420ms. (Implementation note: because bars are canvas-drawn, the cheapest faithful version is a single `transform: scaleX()` on the `.tl-body` canvas wrapper anchored at the zero column, OR draw progressive `w` only inside `requestAnimationFrame` for the one entrance — never recompute on scroll. No bounce/elastic; no `cubic-bezier(0.34,1.56,…)`.)
2. **Hover/focus/select kick:** the tile kicks per the shipped tile rule — `transform: translate(-3px,-3px)` + shadow deepens to `15px 15px 0 var(--tealdk)` over 140ms `cubic-bezier(0.2,1.3,0.3,1)`; the focal bar gets the ink-stroke + teal value-tag swap. One signal, not translate+scale+shadow stacked on every bar.

**Data is readable at frame one** — values/labels paint immediately; only the bar fill animates. **`prefers-reduced-motion: reduce`** snaps bars to full `scaleX(1)` with `animation: none`, kills the kick transition, and pauses marble SMIL (`svg.pauseAnimations()`) + slows `.marble-drift` to ~180s.

### Click-to-expand (mandatory EXP entry)
The tile is one clickable target opening `#expand` (fixed overlay, **z-index 100, above the CRT z90**, outside the clipped stage), with `?expand=pl` deep-link and Esc-to-close. Modal is the shipped **2-column "big viz left → clear numbers right"**: left `.exp-viz` redraws `drawPL(c, true)` on `#cv-exp` (a `ResizeObserver` on `.evbody` keeps it crisp); right `.exp-data` is the alternating-band `.edrow` list of **boxed value tags** (`.val`: `border: 3px solid ink`, `box-shadow: 5px 5px 0 ink`, `clip-path` parallelogram, gain→teal / loss→loss fill, tabular Space Mono) — **NOT a spreadsheet**. Exactly one full-ink **`.hero` row** carries the net figure ("Net open P/L", formatted via `fmt`) in an Anton teal tag. The modal also exposes a realised-vs-unrealised toggle (the archetype's two P/L flavours) and the sortable header set. Register: `EXP.pl = { head:'Per-Stock P/L', sub:'Open profit & loss by holding', draw: drawPL, rows:[…signed gain/loss rows…, ['hero','Net open P/L','+£1,240','gain']] }` — note the literal figures in this registration are **placeholder demo strings**; the live component overwrites every row value through `fmt(v, ccy)` so nothing en-US/£-hardcoded ships.

### Functional / accessibility (the hard contract)
- **Four states, never a bare/broken chart:** *empty* — in-frame message + CTA ("No positions yet — add a holding to see per-stock P/L"); *loading* — a **shape-matched skeleton** of stacked ink-hairline bar slots around a zero rule (NOT a spinner over empty axes); *error* — cause + Retry button; *populated*.
- **`role="img"` + `aria-label` stating the key insight** on the canvas. The `ariaSummary` is **derived from the same `positions` array** (count up/down, top mover, net) — never hand-authored with literal figures — so the worded summary can never disagree with the drawn bars (honest-data extension). Pair it with a **visually-hidden `<table>` data alternative** (ticker / P/L / direction columns) as the SR source of truth.
- **Live-update policy:** the hidden table and `aria-label` are recomputed on data change but the live region is **`aria-live="off"`** by default (per-tick P/L re-quotes are not announce-worthy and would spam SR); the summary is re-announced only on sort, expand, or explicit refresh. tabular-nums guarantees zero layout shift regardless.
- **Tooltips on hover AND tap AND keyboard focus**, hover-delay ~800ms but focus-delay 0ms; each bar/row is **focusable (`tabindex`)** with an **instantly-appearing focus ring** (no transition on outline) and a **≥44×44px hit area** (transparent padding on thin bars). Never hide the value behind a hover-only tooltip — each focusable row's `aria-label`, the modal value tags, and the table fallback already expose every number (including on the collapsed tile, where per-bar values are not drawn on canvas).
- **Locale-aware formatting** via `Intl.NumberFormat(locale, { style:'currency', currency })` per instrument — never hard-coded `£`/en-US string concatenation; fixed decimals so widths are constant.
- **Virtualise** the position list if it exceeds ~50 rows (collapsed tile shows top-N by |P/L| with a "+N more" tail; full list lives in the modal/table).
- All colours/fonts reference the named tokens (`--ink`, `--cream`, `--gain`, `--loss`, `--teal`, `--slant`); zero inline hex, zero one-off fonts, zero mid-render drift.

### Craft beats that lift it above the shipped baseline (anti-slop)
- Box the modal axis/value labels as small ink-outlined tags (reuse `.val` language) instead of flat left/right text, unifying them with the tag vocabulary and avoiding a plain-data-table read.
- Give the zero axis a **stamped tick rhythm** (a couple of heavier ink notches at ±max) rather than uniform thin SaaS gridlines — and since horizontal gridlines are dropped, this stamped spine is the chart's only axis chrome, so it carries the house texture alone.
- Mark the single largest gainer and largest loser with an ink end-cap node (`fillRect` ink square then teal square) **in both collapsed and big modes** — the focal accent earns its ≤3–5% footprint instead of every bar shouting, and even the small tile gets one house-texture beat.

**Component API**

```ts
// Reusable, sortable per-stock P/L diverging bar viz.
// Canvas-only (matches shipped drawPL); SVG reserved for marble.
// Drop-in for the Dashboard tile + EXP modal; re-skinnable per-screen accent.

type Currency = string; // ISO 4217, e.g. "GBP" — drives Intl currency formatting

interface PLPosition {
  ticker: string;          // e.g. "NVDA"
  pl: number;              // signed P/L in major units; >=0 gain, <0 loss
  flavour?: "realised" | "unrealised"; // banked vs open; toggled in modal
  currency?: Currency;     // per-instrument; falls back to defaultCurrency
  weight?: number;         // optional % portfolio weight, for the |P/L|/weight sort keys
}

type PLSortKey = "pl" | "absPl" | "ticker" | "weight";
type SortDir = "asc" | "desc";
type VizState = "empty" | "loading" | "error" | "populated";

interface PerStockPLBarsProps {
  /** REQUIRED real data — never invent values. Empty array => empty state. */
  positions: PLPosition[];

  /** explicit state override; otherwise inferred (empty if positions.length===0). */
  state?: VizState;
  onRetry?: () => void;                 // wired to the error-state Retry button

  /** false = collapsed dashboard tile (no canvas big number); true = modal render. */
  big?: boolean;

  /** sorting (controlled or uncontrolled). Default sortKey="pl", sortDir="desc". */
  sortKey?: PLSortKey;
  sortDir?: SortDir;
  onSortChange?: (key: PLSortKey, dir: SortDir) => void;

  /** symmetric domain; defaults to niceCeil(max(|pl|)) of the REAL data. Forces mirror-equal bars. Never an invented filler max. */
  maxAbs?: number;

  /** per-screen single pigment accent token name. Dashboard = "--teal". Applied as ink-stroke focal signal, NOT a bar fill. */
  accentVar?: `--${string}`;            // default "--teal"

  /** locale + currency for Intl.NumberFormat. */
  locale?: string;                      // default navigator-derived
  defaultCurrency?: Currency;           // default "GBP"

  /** click-to-expand wiring (registers/reuses EXP["pl"]). */
  expandKey?: string;                   // default "pl"
  onExpand?: (key: string) => void;

  /** interaction: fires on hover/tap/keyboard-focus of a row. */
  onActivePosition?: (p: PLPosition | null) => void;

  /** OPTIONAL override for the role=img aria-label. If omitted, the component
   *  DERIVES it from `positions` (up/down counts, top mover, net) so the worded
   *  summary can never disagree with the bars. Do NOT pass hand-authored literal figures. */
  ariaSummary?: string;

  /** top-N cap for the collapsed tile; full list virtualised in modal. */
  maxRows?: number;                     // default 7

  className?: string;
}

declare function PerStockPLBars(props: PerStockPLBarsProps): JSX.Element;

/* ---- the pure canvas painter, shared by tile + modal (matches drawPL signature) ---- */
declare function drawPL(
  c: HTMLCanvasElement,
  big: boolean,
  opts?: {
    data: PLPosition[];
    maxAbs: number;                     // niceCeil(max(|pl|)) of real data; default 600
    accent: string;                     // resolved accent; used for ink-stroke focal, not fill
    fmt: (v: number, ccy: Currency) => string; // Intl-bound formatter — ALL money strings route through this
    activeTicker?: string | null;       // focal bar gets 2px ink-stroke + tag swap (non-colour)
    enterProgress?: number;             // 0..1 scaleX entrance; 1 under reduced-motion
  },
): void;
// Label placement (matches shipped drawPL): gain value drawn to the RIGHT of the
// rightward tip (xv+8, textAlign:left); loss value drawn to the LEFT of the
// leftward tip (xv-8, textAlign:right) — labels read outward from zero.

/* EXP registration (modal): 2-col "big viz left, boxed-tag numbers right",
   one full-ink hero row = Net open P/L. rows are [label, value, "plain"|"gain"|"loss"]
   or ["hero", label, value, kind]. Literal figures in the static registration are
   PLACEHOLDER demo strings; live values are re-rendered via fmt(v, ccy). */
```

### Drawdown Chart

## Drawdown Chart — Craft Spec (verified)

**Archetype.** An "underwater" area chart: a negative-only series of the running peak-to-trough decline (%), held flat against a `0%` waterline at the top, the area beneath it flooded in loss-tint, with the single worst point (max drawdown) explicitly stamped and called out. This is Actuality's canonical *risk / downside-over-time* viz. It already ships in the Dashboard as `drawDD` / EXP key `dd`; this spec promotes that exact idiom into a reusable, hardened component (`<DrawdownChart/>`) without changing its house look.

Drawdown is a *trend over time* → it is a line/area, never a gauge or bar (functional rule: chart type matches data shape). Drawn on raw `<canvas>` 2D — **no SVG chart, no Recharts/D3** (SVG is reserved exclusively for the `#ntMarble` texture).

> **Honesty banner (read first):** every figure shown — the call-out, the modal rows, the axis labels — is **derived from `series` / `stats` and locale-formatted at render**, never a baked-in string. The literal "−8.2%", "£1,170", "£820" used below are *illustrative outputs of the formatter for the sample data*, not values to hardcode. The shipped prototype hardcodes `'-8.2%'`; this component must replace that with `maxDD = Math.min(...series.map(p=>p.dd))` → `pctFmt.format(maxDD)`.

---

### 1. Visual anatomy (shallow DOM, one canvas)

One clip-path parallelogram tile, one canvas inside — nothing nested deeper. Reuse the shipped tile shell verbatim; do **not** wrap a card-in-card or draw fake chrome.

```
.tile (clip-path parallelogram, border:6px solid --ink, box-shadow:10px 10px 0 --ink, border-radius:0)
 ├─ .head      ink bar · "DRAWDOWN" Anton uppercase · .ex "EXPAND" Oswald teal chip (≥44px hit area)
 └─ .tl-body   (position:relative; halftone underlay clipped here)
     └─ <canvas role="img" aria-label="…">  inset:0, 100%×100%  ← drawDD(canvas, big)
```

The `.ex` chip reads **"EXPAND"** in Oswald uppercase (optionally with a drawn-in-stroke SVG arrow in the chip's own ink weight) — **never** a stray unicode arrow glyph (`⤢`), which is a button-prompt tell banned by the canon and renders as tofu on many platforms.

Inside the canvas, painted in strict z-order (this *is* the drawDD idiom — match it):

1. **Halftone underlay** — the `.tl-body` carries the shared ben-day field (radial-gradient, 1.35px dot / 15px grid / `.07` multiply), clipped to the tile, sitting *under* the canvas and `aria-hidden`. Never over the line or numbers.
2. **Waterline + gridlines** — horizontal ink hairlines at `rgba(20,17,13,.12)` (a deliberate quiet sub-layer, matched to the shipped Dashboard — not an oversight). The `0%` line is the **waterline**: draw it one notch heavier (`rgba(20,17,13,.22)`, ~1.5px) so the "surface" reads as the structural top. Steps: every 5% collapsed, every 2% in `big` (matches shipped `big?2:5`).
3. **Underwater fill** — the flooded area between the curve and the waterline, `rgba(200,64,47,.16)` (LOSS at low alpha). This is the only place loss-red spreads as a field, intrinsic to the archetype's meaning, so it is sanctioned here (not a per-row splash).
4. **Drawdown curve** — the LOSS line. To carry the stamped/printed identity, apply the offset-shadow idiom: an **ink-shadow copy offset +2px** under a **LOSS overline** (`line(… +2,+2, 'rgba(20,17,13,.25)', big?4:2.5)` then `line(… LOSS, big?4:2.5)`). The shipped single-pass line is the floor; the ink-shadow pass is the craft beat that lifts it off generic.
5. **Max-drawdown marker** — at `maxIndex = DD.indexOf(Math.min(...DD))`: an **ink square** (`fillRect(X-5,Y-5,10,10)` big / `6×6` collapsed) then a smaller **LOSS square on top** (`fillRect(X-3,Y-3,6,6)`) — the node idiom used across the dashboard, square corners, no circle.
6. **Recovery hint (big only)** — from the trough to the right edge, where the series climbs back toward 0, the fill lightens to `rgba(200,64,47,.08)`; this distinguishes "still underwater / recovering" from "deepest" without a second hue. The **worded "RECOVERING" Oswald tag is the load-bearing signal**; the alpha shift is reinforcement only, never the sole cue.
7. **Call-out number** — the *derived* max-drawdown figure (`pctFmt.format(maxDD)`), **with a drawn ink-shadow under the LOSS fill so the glyph clears 4.5:1** (LOSS-on-cream text alone is only 3.98:1). A small **drawn** down-triangle (canvas path, not a `▼` font glyph) precedes it as the non-colour channel. **Collapsed:** Anton `900 14px` LOSS over a +1px ink shadow, tucked top-right, and **mirrored in a DOM `.rt-num` overlay (ink or ink-outlined, tabular-nums) so it is real selectable text**, not canvas-only. **Big:** Anton `900 22px` LOSS (ink-shadowed) centered under the trough + Space-Mono `%` axis labels down the left gutter.

Padding: collapsed `padL36 / padR12 / padT14 / padB22`; big `padL60 / padR30 / padT30 / padB40` (matches shipped). The asymmetric wide-plot / narrow-label-gutter bias is intentional (no centred dead space).

---

### 2. Colour & encoding (named tokens only — no inline drift)

All draw colours come from the locked JS consts mirrored from `:root` (`--ink`, `--loss`, `--cream/2`, `--purple`, `--teal*`). No new hex.

| Element | Token | Notes |
|---|---|---|
| Curve, fill, marker top, call-out fill | `LOSS #C8402F` | downside is *always* loss-red, area-filled — the established risk convention; 3.98:1 vs cream → mark floor only, so any LOSS **text** gets an ink shadow/outline to reach the 4.5:1 text floor |
| Ink shadow / waterline / marker base / axes / call-out backing / text | `INK #14110D` | all chrome, outlines, and the shadow that lifts LOSS text over 4.5:1 |
| Plot ground | `CREAM #EDE6D2` | tile fill; never a coloured/gradient chart background |
| Gridlines | `rgba(20,17,13,.12)` | quiet sub-layer, low contrast by design (matches shipped) |
| Waterline (0%) | `rgba(20,17,13,.22)` | the one heavier rule |
| Axis tick text | `rgba(20,17,13,.66)` | **darkened from .5** → ~4.6:1 vs cream (the old `.5` = 3.36:1 and FAILED the 4.5:1 text floor) |

**Pigment accent — screen-keyed, NOT loss-red.** Per the per-screen map, the *one* signature pigment is the host screen's accent (Dashboard = **teal**; Performance = **lime**, etc.). Loss-red is the semantic downside colour and is exempt from the "one accent" count (it is the sanctioned gain/loss pair). The screen pigment appears only as: the **.ex expand chip**, the **active/hover tile shadow shift**, and — in `big` mode — a thin accent tick at the *current* drawdown x-position ("you are here"). Never a second bright hue inside the plot; never teal *and* another loud colour competing.

**Gain/loss never colour-only (hard rule).** Every signed figure carries a non-colour channel: the max-drawdown call-out is prefixed by a **drawn** down-triangle and an explicit locale minus (`−8.2%`, U+2212), current drawdown `−0.4%` keeps its explicit sign, and the recovery zone is labelled "RECOVERING" in text. Verified to survive greyscale and a CVD emulator.

---

### 3. Typography (fixed roles, roman only)

Canvas text matches the DOM press — drawn only after `document.fonts.ready` (with the 240/380ms re-draw passes) so Anton/Space-Mono are loaded before first paint.

- **Anton `900`** — the hero call-out: 14px collapsed top-right, 22px big under the trough, always over an ink shadow. UPPERCASE feel, roman, **never italic**.
- **Space Mono `12–13px`** — axis `%` ticks and any monetary recovery figure. `font-variant-numeric: tabular-nums` on every DOM mirror of these numbers; canvas digits are already monospaced via Space Mono so axis labels and the live call-out never reflow.
- **Oswald `600/700` UPPERCASE, wide tracking** — the "DRAWDOWN" head, the **"EXPAND"** chip, "MAX DD" / "CURRENT" / "RECOVERING" micro-labels, legend captions.
- **Banned:** system-ui / Inter / Roboto / any thin weight / any italic on a figure, title, axis label or legend.

---

### 4. Geometry & honesty

- **True scale, no truncation.** Domain `min = Math.floor(Math.min(seriesMin, domainMin ?? -10))` rounded *outward*, `max = 0` (waterline at top, `Y(v)=y0+(y1-y0)*(0-v)/(0-min)`). Drawdown is *by definition* ≤ 0, so the `0%` ceiling is honest, not a truncation. If the real worst value exceeds −10%, the domain **extends to the data min** — never clamp the curve to fake a −10% floor. (Resolves the §4-vs-API ambiguity: −10 is a *default minimum extent*, not a hard clamp.)
- **Proportional everything.** Fill height, curve position and marker are all direct functions of value; no exaggeration.
- **Tile sheared via `clip-path` (tokens `--slant 16`), content counter-skewed** so the canvas plot and numbers read level. Never `transform: skewX` (neutralised), never `border-radius`, never a soft shadow.

---

### 5. Honest data — never invent a number

The component renders **only** values passed in `series` / `stats`. It computes `maxDrawdown` and `maxIndex` from the data (those are derivations, not inventions) and **locale-formats them at render** — the call-out is `pctFmt.format(maxDD)`, never a hardcoded `'-8.2%'` string. Everything else — *days to recover, recovered £, volatility band, worst week* — must be **supplied**; the component does not fabricate them.

If a stat is missing, its modal row renders as an **em-dash on a labelled grey block** ("metric to confirm") — never a placeholder figure. If `series` is empty/absent, the chart shows its **empty state**, it does not draw bare axes. The hero call-out is always paired with the worded label "MAX DRAWDOWN" — never a bare giant number.

---

### 6. The four states (mandatory)

1. **Loading** — a shape-matched skeleton: a flat ink-hairline waterline + a faint LOSS-tint shimmer block in the underwater region (no spinner, never bare axes). The tile chrome and head render immediately.
2. **Empty** — in-frame Oswald message + guidance: *"No drawdown yet — your peak hasn't been beaten."* (a healthy state for a young/winning account), CTA optional. Never a blank plot.
3. **Error** — Oswald cause line + a square ink-outlined **Retry** chip that re-runs `onRetry`.
4. **Populated** — the chart above.

---

### 7. Motion (≤2 primitives, transform/opacity only, snappy)

- **Entrance (first load only, once).** The curve draws on via a single `requestAnimationFrame` progress `0→1` that advances how far along `DD` the curve+fill are painted (transform-of-progress, not per-frame layout thrash), and the call-out **opacity 0→1** (second primitive). Easing `--ease-out cubic-bezier(0.16,1,0.3,1)`, `--dur-long 420ms`, staggered by DOM index (`--i*60ms`, total cap ~500ms). **No bounce/elastic; no `0.34,1.56`.** After it settles the chart is static — no looping, no re-animate-on-scroll. The final values are legible at frame one regardless of progress (the number is painted immediately; only the curve sweep animates).
- **Hover / select (tile-level kick).** The tile kicks: `translate(-3px,-3px)` + shadow deepens `10px→` screen-accent offset, `~120ms`, the comic-collage stamp. One signal, not translate+scale+shadow stacked on the data marks. Active tile inverts to the accent fill with cream type.
- **Interactive marks.** On hover/focus of the **max-DD marker** or any series node, one signal only: a 1px ink outline grows to a thin square ring (no scale). Tooltip on **hover AND tap AND focus** (focus-delay 0ms, hover-delay ~800ms); value never hidden behind hover-only.
- **Reduced motion.** `@media (prefers-reduced-motion: reduce)`: paint the **final state instantly** — curve full, fill at full opacity, call-out at final value, marble SMIL paused (`pauseAnimations()`), tile drift off. Data is fully readable at frame one regardless.

---

### 8. Click-to-expand (the house IA — viz left, numbers right)

The tile registers an `EXP['dd']` entry and is fully clickable/`Enter`-activatable. The **outer tile** carries `role="button"`, `tabindex=0`, an aria-label ("Expand drawdown chart"), and an instant focus ring; the **inner canvas** carries `role="img"` + the worded data summary (the two roles live on separate nodes — a single element can never be both). Clicking opens `#expand` (fixed, **z-index 100**, above the CRT at z90, outside the clipped stage), with `?expand=dd` deep-link and **Esc to close**. Layout = 2-column grid:

- **LEFT `.exp-viz`** — re-runs `drawDD(cv-exp, true)` (big mode: denser 2% gridlines, all `%` axis labels, ink-shadowed Anton call-out under the trough, recovery tag). Modal canvas re-draws via `ResizeObserver` on `.evbody` after layout settles (rAF).
- **RIGHT `.exp-data`** — "DRAWDOWN · NUMBERS", an alternating-band list of **boxed value tags** (Space-Mono value, 2.5px ink border, 3px ink offset-shadow, `border-radius:0`), gain→teal / loss→loss fill — **not a spreadsheet**. Every value is a *formatted derivation of `stats`*, not a literal:
  - `hero` — **Max drawdown · ▼ −8.2%** (full ink band, Anton loss tag over ink — the `▼` here is a drawn caret/triangle, and `−8.2%` is `pctFmt.format(maxDD)`)
  - Current drawdown `−0.4%` (loss) · Days to recover `11` · Recovered `£1,170` (gain, `currFmt.format`) · Worst week `W6` · Volatility `medium`
  - Each value passes through `stats`; any unsupplied one renders as the grey "metric to confirm" tag.

---

### 9. Accessibility & functional contract

- **`role="img"` + `aria-label`** (on the canvas) stating the *key insight in words*, locale-formatted: e.g. *"Drawdown chart: worst decline −8.2% at week 6; currently −0.4%, recovered £1,170."* (composed from data via `Intl`, with U+2212 minus). Decorative passes (halftone) are `aria-hidden`. The outer expander is `role="button"` with its own label.
- **Text/table equivalent** — a visually-hidden `<table>` mirroring `series` + the stat rows, so the canvas is not opaque to screen readers.
- **Tabular figures** on every DOM number (call-out mirror, modal tags, axis mirrors); fixed decimals so live ticks cause zero reflow.
- **Touch + keyboard parity** — marker/legend focusable, ≥44×44px hit areas, tooltip on hover+tap+focus, focus ring appears instantly (no transition).
- **Locale formatting** via `Intl.NumberFormat` — `pctFmt` for drawdown `%`, `currFmt` for the instrument currency on £ recovered — **never hard-coded en-US/`$` or baked-in `£`/`%` strings**. The minus sign is the locale minus the formatter emits, not an ASCII hyphen.
- **Contrast floors (verified, not asserted)** — curve/marker ≥3:1 vs cream (LOSS = 3.98:1 ✓); **axis/tick/label text ≥4.5:1** (achieved at `rgba(20,17,13,.66)` = ~4.6:1; the prior `.5` = 3.36:1 ✗); LOSS call-out **text** lifted over 4.5:1 by its ink shadow/outline; gridlines deliberately low-contrast sub-layer.
- **Density** — drawdown series are coarse (weekly/daily buckets); if a caller passes >~1000 points, downsample (LTTB / time-bucket) for the default view with drill-down on zoom.

---

### 10. Consistency checklist (must match shipped Dashboard)
`drawDD(c,big)` signature · `fitCanvas` backing-store scaling · shared `line()` helper · the `min` (= min(data,−10) rounded out) `/ max=0` domain, padding `padL/R/T/B` exactly as shipped, `DD.indexOf(Math.min(...DD))` marker · LOSS/INK/CREAM consts · Anton/Space-Mono/Oswald faces · `EXP['dd']` 2-column modal with boxed-tag rows + one hero row · clip-path tile (tokens `--slant`, border 6px ink, shadow `10px 10px 0` ink) · global CRT + halftone · marble *only* on frame/border, **never** over the plot. The new craft beats added on top — ink-shadow pass on the curve **and on the call-out text**, heavier waterline, recovery-zone lightening + worded "RECOVERING" tag, drawn `▼` on the call-out, **derived+locale-formatted** call-out (replacing the shipped hardcoded `'-8.2%'`), darkened axis ticks (`.66`), DOM-mirrored selectable ink number, draw-on progress entrance, the four states, the `role="img"`/`role="button"` split, and the full a11y/locale contract — harden the shipped idiom without altering its house look.

**Component API**

```ts
// Reusable drawdown ("underwater") chart — canvas-drawn, comic-collage house style.
// Promotes the shipped Dashboard drawDD/EXP['dd'] idiom into a hardened component.
// EVERY displayed figure is DERIVED from `series`/`stats` and locale-formatted at render —
// never a hardcoded string. (The shipped prototype hardcodes '-8.2%'; this component must not.)

type DrawdownPoint = {
  t: string | number | Date;   // period label / timestamp (e.g. 'W6')
  dd: number;                  // drawdown % at t, ALWAYS <= 0 (0 = at peak)
};

type StatRow = {
  label: string;
  value: string | number | null; // null -> renders "metric to confirm" grey block (never invented)
  kind?: 'plain' | 'gain' | 'loss';
  hero?: boolean;                // full-ink band, Anton tag (one per modal)
};

type DrawdownChartProps = {
  /** Honest series. Component derives maxDrawdown + maxIndex; everything else must be supplied. */
  series: DrawdownPoint[];

  state?: 'loading' | 'empty' | 'error' | 'ready'; // default inferred from series
  onRetry?: () => void;                            // required affordance for 'error'

  /** Per-screen signature pigment (Dashboard='teal', Performance='lime', ...). Loss-red is fixed + exempt. */
  accent?: 'teal' | 'magenta' | 'sky' | 'lime' | 'violet' | 'amber' | 'gold';

  title?: string;            // default 'DRAWDOWN'
  subtitle?: string;         // default 'Peak-to-trough decline over range'

  /**
   * Default-minimum extent, NOT a clamp. Effective floor =
   *   Math.floor(Math.min(Math.min(...series.dd), domainMin ?? -10))   // rounded OUTWARD
   * so a real -14% drawdown extends the axis to -14 and is never truncated to a fake -10.
   */
  domainMin?: number;        // default -10

  /** Modal "NUMBERS" rows. Unsupplied values pass null -> grey "metric to confirm". */
  stats?: StatRow[];         // e.g. Current DD, Days to recover, Recovered £, Worst week, Volatility

  /** Locale-aware formatting (Intl.*) — never hard-coded en-US/$ or baked-in £/% strings. */
  locale?: string;           // default navigator locale; drives pctFmt (with U+2212 minus) + currFmt
  currency?: string;         // e.g. 'GBP' for £ recovered figures

  /** Expand wiring (z100 modal, ?expand=dd deep-link, Esc-close). */
  expandKey?: string;        // default 'dd'
  expandable?: boolean;      // default true
  onExpand?: (key: string) => void;

  /** Worded key-insight summary for the CANVAS aria-label (role="img") + visually-hidden table.
   *  Auto-composed from data via Intl if omitted. Distinct from the expander button's own label. */
  ariaSummary?: string;

  className?: string;
};

declare function DrawdownChart(props: DrawdownChartProps): JSX.Element;

// Accessibility node split (a single element can't be both):
//   outer .tile  -> role="button", tabindex=0, aria-label="Expand drawdown chart", instant focus ring
//   inner <canvas> -> role="img",  aria-label={ariaSummary}, plus a visually-hidden <table> data mirror
//   decorative halftone underlay -> aria-hidden="true"

// Internal canvas renderer kept consistent with the shipped Dashboard:
//   function drawDD(c: HTMLCanvasElement, big: boolean): void
//     fitCanvas(c) -> {ctx,w,h}; padL/R/T/B as shipped (60/30/30/40 big · 36/12/14/22 collapsed);
//     min = floor(min(seriesMin, domainMin ?? -10)) outward, max = 0; X(i), Y(v) as shipped (honest, proportional);
//     gridlines rgba(20,17,13,.12) + heavier waterline rgba(20,17,13,.22);
//       axis TICK TEXT at rgba(20,17,13,.66)  // >=4.5:1 vs cream — NOT .5 (which is 3.36:1, fails)
//     underwater LOSS-tint fill (.16, lightening to .08 past the trough = recovery, paired w/ worded RECOVERING tag);
//     ink-shadow pass (+2px) UNDER the LOSS overline via line();
//     ink->LOSS square marker at maxIndex = DD.indexOf(Math.min(...DD));
//     call-out = a DRAWN down-triangle + pctFmt.format(maxDD) in Anton LOSS painted OVER a +1px ink shadow
//       (LOSS-on-cream text = 3.98:1; the ink shadow/outline lifts the glyph edge over the 4.5:1 text floor);
//       collapsed: top-right + a selectable ink/ink-outlined DOM .rt-num mirror (tabular-nums);
//       big: centered under trough + Space-Mono % axis labels.
//     NO hardcoded '-8.2%' / '£1,170' anywhere — all derived + Intl-formatted; minus = U+2212.
// Registers EXP['dd'] = { head, sub, draw: drawDD, rows: StatRow[] } for the modal (boxed tags, one hero row).
```

### NtRadar — Multi-Axis Pentagon Stat

## NtRadar — Multi-Axis Pentagon Stat (Dispatch-style)

A hand-built **canvas** radar/pentagon for 3–8 allocation/performance dimensions, each scored on a **shared 0–`scaleMax`** scale against a target, plus a `% on-target` strip beneath. It lives as one more collapsed tile in the Dashboard rail and expands into the same "big viz left / boxed-tag numbers right" modal. It is NOT a Recharts/Chart.js radar — it inherits the shipped `draw<Name>(c, big)` canvas idiom, the ink-offset-shadow draw vocabulary, the `clip-path` parallelogram tile, and the EXP modal exactly. SVG stays reserved for the marble texture only.

**When to use (lens 4 chart-type rule):** a multi-variable profile on a **shared, comparable** scale — e.g. a portfolio "shape" across Diversification / Momentum / Quality / Value / Yield, or a per-position health profile. Never use it for a trend (that's `drawValue`), a single bounded KPI (that's `drawGauge`), or part-to-whole (that's `drawDonut`).

### 0. Honest data (HARD rule — lens 1 + lens 4)
- Every axis value, its `target`, and the `% on-target` figure must come from real supplied data. **Never invent an axis max, a score, or a percentage to fill the pentagon.** Radars are uniquely tempting to fudge because a "fuller" shape looks better — resist it.
- **Shared-scale honesty (HARD):** all axes and their targets must already be expressed on the **same `0..scaleMax`** scale — normalise upstream. Plotting a raw-monetary axis and a 0–100 score axis on one ring is dishonest geometry; the component **rejects mixed raw units** (dev warning) and falls back to bars. `unit` is for the modal row / aria wording only — it never licenses mixing raw magnitudes on the plot.
- A missing axis (`value: null`) renders as a **labelled em-dash spoke**: drawn to the grid but its vertex sits on **true center (0)** with a small ink-outlined `—` tag at the rim and the label dimmed to `rgba(20,17,13,.4)`; it is **excluded from the `% on-target` denominator** and shown as `— / target` in the hidden table — never silently pulled to a plausible mid value.
- The headline figure (`% on-target`) is **paired with a worded label** ("ON TARGET") — never a bare giant number. If `onTargetPct` is null, render the "metric to confirm" block, not a fabricated %.
- Geometry is honest: the value radius is a **direct linear function** of `value/scaleMax` from a true center-zero. No truncated inner radius that exaggerates a weak profile. The target ring is drawn at its true `target/scaleMax` radius.

### 1. Visual anatomy (collapsed tile, `big=false`)
One `<canvas id="cv-radar">` inside the standard `.tile` → `.tlHead` ("Portfolio Shape" + "⤢") → `.tlBody`. Drawn on flat **`--cream`**; the ben-day `.halftone` and `.dotcluster` already sit under it at the stage level (~.06) — **never draw marble or texture inside the plot, gauge, or strip.**

Layers, back to front (all the ink-shadow idiom):
1. **Pentagon grid web** — concentric rings at 25/50/75/100% of `scaleMax`, drawn as straight-edged N-gons (NOT circles), `strokeStyle "rgba(20,17,13,.12)"`, `lineWidth 1`. The 100% outer ring is heavier: `rgba(20,17,13,.5)`, `lineWidth big?3:2` so the frame reads as a stamped boundary, not a faint chart web.
2. **Spokes** — one ink hairline from center to each vertex, `rgba(20,17,13,.18)`. At each rim, a short **stamped tick drawn as a filled ink square** (a 6/10px `fillRect`, lens-3 "heavier tick rhythm" note) instead of a thin radial line — this is the bespoke move that kills the instrument-panel-generic tell.
3. **Target ring** — the threshold polygon at each axis's `target/scaleMax` radius. Drawn as a **dashed ink polygon** `setLineDash([7,5])`, color `--purple` (the shipped benchmark/reference role), `lineWidth big?3:2.5`, with a faint `rgba(93,90,134,.16)` fill — mirroring exactly how `drawValue` renders the net-deposits reference. This is the radar's "your shape vs the target you set" thesis, the same true-growth framing as the hero chart.
4. **Value polygon** — the data shape, drawn with the **3-pass line idiom**: ink-shadow polygon offset `+2,+2` at `rgba(20,17,13,.25)` (`lineWidth big?7:5`), then a **`--tealdk` underline** (`big?7:5`), then a **`--teal` overline** (`big?4:3`). Fill the polygon with the **exact vertical teal gradient `drawValue` uses** (`rgba(25,229,229,.42)` → `rgba(25,229,229,.03)`) at **full `ctx.globalAlpha` (1)** — the baked falloff already keeps the grid readable; do **not** stack an extra global-alpha multiply on top.
5. **Vertex nodes** — ink square then teal square on top (`fillRect(x-5,y-5,10,10)` INK, `fillRect(x-3,y-3,6,6)` TEAL), the established node marker. An axis **below its target** gets its node drawn in `--loss` instead of teal AND a small **hand-built filled ink down-triangle** (a 3-point `fill()` path, never a font/`▾` glyph) stamped just outside the rim; **above/at target** stays teal with no caret. (This is the non-colour channel — see §3.)
6. **% target strip** — a thin horizontal bar under the plot (collapsed) / above the legend (big): a 100%-wide ink-outlined track, filled left-to-right to `onTargetPct`, `--teal` if ≥ `passThreshold` else `--loss`, with the pass-threshold divider marked by a **heavy ink tick** (the non-colour divider). Square ends, no radius. **Painted at its final fill on frame one** — readable instantly.

**Collapsed headline stays in the DOM**, not on canvas (shipped convention): a `.featTag`-style `% ON TARGET` figure and a worded sub ("4 / 5 axes at or above target") sit in the upright `.feat-figure`-style overlay over **reserved blank canvas top-padding** (`padT = min(120, H*0.30)`, exactly how `drawValue` reserves space for `.feat-figure`). The overlay is absolutely positioned and upright — it carries **no skew** (so there is nothing to counter-skew).

### 2. Expanded modal (`big=true`)
Reuses the `.expand` overlay verbatim (z-index 100 above the CRT, `?expand=radar` deep-link, Esc-to-close, marble `.frmarble` **border ring only**, `PERFORMANCE TRUTH` tag). No marble or texture inside the plot. Left `.expViz` redraws `drawRadar(c, true)`; right `.expData` is the boxed-tag list. In `big` mode the canvas adds:
- **Direct axis labels** at each rim in `Oswald 700` uppercase (per lens-4: ≤8 series → direct-label, drop the legend), each with its score as a `Space Mono` boxed value drawn as a small ink-outlined tag (lens-3 "box the labels" note), gain-teal / loss-red fill matching the vertex state.
- A centered **`Anton` `% ON TARGET`** number with the worded label beneath (canvas font `"900 64px 'Anton'"` / sub `"900 22px 'Anton'"` — big-mode only).
- `.expData` rows: one `hero` row (the headline `% on target`), then one row per axis `['Diversification','82 / 70 target','gain']` etc. (value vs its target, kind = gain if ≥ target else loss; a null axis → `['Yield','— / 70 target','plain']`), then summary rows (axes passing, weakest axis, strongest axis). Values are the boxed `.val` tags; the hero is the full-ink band with an `Anton` tag — never a plain table.

### 3. Colour & encoding (locked tokens — no new palette)
- Substrate **`--cream`**; all chrome (grid, spokes, ticks, outer ring, labels, the strip track) in **`--ink`** at the shipped alphas (`.12` grid, `.18` spokes, `.5` outer ring/axis text). No pure black/white, no zero-chroma grey — these tinted-ink alphas already satisfy that floor.
- **One pigment accent per screen via the per-screen map.** On the Dashboard this is **teal** (`--teal` value line, `--tealdk` underline) — already the shipped positive accent, so the radar needs no new token. On a re-skinned screen (e.g. Performance=lime, Compare=violet) the value polygon's teal pair swaps to that screen's mapped accent token; everything else stays cream/ink. **No rainbow** — every axis spoke is the same ink; only the one value shape carries the accent. Accent footprint stays the focal shape only (~3–5%).
- **Target reference = `--purple`** (benchmark role, dashed). **Below-target = `--loss`** node + ink-triangle caret. These plus the screen accent are the only saturated colours — within the locked grammar. All hexes/fonts reference named tokens; no inline hex/oklch mid-render drift.
- **Gain/loss never colour-only (HARD):** below-target axes carry the hand-built ink down-triangle + a `BELOW` text label in the modal row; at/above carry an up-triangle / no caret. The `% target` strip pairs its colour with a **signed delta from threshold** (hand-built `+`/`−` + ink triangle), the worded `ON TARGET` label, and the heavy ink threshold tick. Verify in a CVD emulator that pass vs fail axes are distinguishable with hue removed.

### 4. Type (locked roles)
- Canvas big numbers / headline % (big mode only): **`Anton` 900** uppercase (`"900 64px 'Anton'"` headline, `"900 22px 'Anton'"` sub-figures) — matching the gauge. Collapsed headline stays in the DOM `.feat-figure`, not on canvas.
- Axis labels, legend, strip caption, modal `.lbl`: **`Oswald` 600/700** uppercase, wide tracking.
- All numeric readouts (axis scores, target values, %, the strip): **`Space Mono`** with **`font-variant-numeric: tabular-nums`** on every DOM numeric node. Values are produced by `Intl.NumberFormat` with **fixed `minimum/maximumFractionDigits`** (scores as integers, % via `style:'percent'`) so digit width is constant and live updates cause zero reflow — **never a hard-coded `00.0%` mask**. Set `ctx.font` with the family quoted; draw only after `document.fonts.ready` with the shipped re-draw passes (rAF + 240ms + 380ms).
- **Roman only** — no italic on the title, axis labels, scores, or the headline figure. Emphasis on the weakest axis via weight / the loss colour / the caret, never an italic flip. Banned: system-ui / Inter / Roboto / any thin weight.

### 5. Geometry & containment
- One `<canvas>`, shallow DOM: `.tile > .tlHead + .tlBody > canvas` (+ the upright `.feat-figure` overlay). No card-in-card, no hand-drawn window chrome.
- `fitCanvas(c)` (backing store = CSS box × min(dpr,2), pre-scaled ctx); shared `line(ctx,pts,col,w)` helper; viewBox = the canvas box (no oversized coordinate space).
- Vertex math: `angle(i) = -π/2 + i*(2π/N)` (first axis at top, clockwise — matching the donut's `-90°` start). Collapsed reserves the top band (`padT = min(120, H*0.30)`) for the DOM headline, then `R = min(W, H-padT)*~0.40` centered **below** that band; big mode `R = min(W,H)*~0.40`. `vertex = center + R*(value/scaleMax)*[cos,sin]`. Center is true zero.
- **Skew handling (lens-3 hard rule):** the tile shears via the shipped `clip-path` parallelogram (`--slant 16`) on the **shell only** — `--skew/--unskew` are neutralised to `0deg`. The canvas (`inset:0` in `.tlBody`) and the `.feat-figure` overlay carry **NO transform** and read level for free. **Never** add a `transform: skewX` to the canvas or its content (the shipped system removed exactly this).
- Square corners everywhere (`border-radius:0` global on `.screen`). The tile carries `border:6px solid var(--ink)` + `box-shadow:10px 10px 0 var(--ink)`; **no soft/blur shadows** anywhere, including the strip and any focus state. The CRT bezel is the only curve.

### 6. Motion (≤ 2 primitives, transform/opacity only)
- **Entrance (once, on first load):** the value polygon scales up from the center — `transform: scale()` on a wrapper from `0.6→1` + `opacity 0→1`, `--ease-out cubic-bezier(0.16,1,0.3,1)`, `--dur-long ~420ms`, staggered after the other rail tiles by `--i*60ms` (cap ~500ms total). **No sweeping radar line, no spinning, no perpetual motion** (explicitly banned). Implemented as a CSS transform on the canvas wrapper, NOT by animating geometry per frame and NOT by re-running `drawRadar` each tick — values (and the % strip) are painted at final state on frame one so the data is readable instantly.
- **Hover/selection (the house stamp/kick):** the whole `.tile` does the shipped kick — `transform: translate(-3px,-3px)` + `box-shadow:15px 15px 0 var(--tealdk)`, `~140ms cubic-bezier(0.2,1.3,0.3,1)`. Exactly one signal at the tile level. No per-vertex hover scale.
- **Reduced motion (HARD):** `@media (prefers-reduced-motion: reduce)` → entrance `animation:none`, polygon at full scale/opacity immediately; the strip at its final fill with no transition; tile kick reduced to an instant 1px ink-shift, no transition; loading shimmer paused; marble SMIL paused via the shipped `svg.pauseAnimations()`. Data fully legible the instant it renders, never gated on animation.

### 7. Interaction, a11y & functional contract (lens 4)
- **Click-to-expand:** the tile is the click target → `openExpand("radar")`; register an `EXP.radar = {head:"Portfolio Shape", sub:"Profile vs target · N axes", draw: drawRadar, rows:[…]}`. Deep-link `?expand=radar`, Esc closes.
- **Per-axis values on touch + keyboard, not hover-only:** in the modal each axis label/score is direct-drawn (always visible) AND each axis is a focusable hit region (an absolutely-positioned, ≥44×44px transparent button per vertex over the canvas, `tabindex`, `:focus-visible` instant ink outline — no transition) that reveals the same `axis: value vs target` readout; the collapsed tile is itself focusable and opens the modal on Enter/Space. Any tooltip triggers on hover **and** focus **and** tap, hover-delay ~800ms / focus-delay 0ms.
- **aria:** `role="img"` on the canvas with an `aria-label` stating the **key insight** ("Portfolio shape: 4 of 5 axes at or above target; weakest is Yield at 48 vs 70 target") plus a visually-hidden `<table>` mirroring axis / value / target — **consistent with the plot**: a null axis shows `—` (not 0) and is excluded from the % denominator. Decorative `.dotcluster`/marble stay `aria-hidden`. (Note: this a11y/locale/tabular contract is net-new — the shipped Dashboard tiles lack it — so the component must be self-contained, not assume a shared helper.)
- **Four states:** `empty` → in-frame ink message "No profile yet — add positions to score your shape" + CTA, never bare spokes; `loading` → a shape-matched skeleton: the **tinted-ink** pentagon grid (`rgba(20,17,13,.12)`, never a grey fill) + a low-alpha ink placeholder polygon with an **opacity-pulse** shimmer gated behind reduced-motion, NOT a spinner; `error` → message + Retry; `populated`. Branch on state, not just presence.
- **Locale:** all numbers/percentages via `Intl.NumberFormat` (and currency via the instrument currency if an axis's modal row is monetary) — never hard-coded en-US.
- **Scale:** N capped at 8 axes for legibility (more becomes an unreadable star); **≤3 axes does NOT render a degenerate triangle** — it routes to the shipped diverging/bar idiom (`drawPL`-style) or a labelled bar list, with a dev warning.

### 8. Anti-slop checklist (must pass as a still)
Hand-built canvas (no chart lib) ✓ · straight-edged stamped grid not a faint circular web ✓ · one accent over ink, purple target ring, no rainbow ✓ · ink-offset 3-pass value polygon + ink/teal nodes, full-alpha baked-falloff fill ✓ · tabular-nums + Intl everywhere, no hard-coded mask ✓ · roman, Anton/Oswald/Space Mono only ✓ · below-target carries a hand-built ink-triangle caret + label, not a font glyph and not colour-only ✓ · square corners, hard zero-blur shadows, tile shears via clip-path with NO canvas skew ✓ · single scale-in entrance, strip painted final on frame one, reduced-motion snap ✓ · `role=img` + insight aria-label + hidden table consistent with the plot ✓ · honest shared-scale center-zero proportional radii, missing axis = labelled em-dash on true center ✓ · marble/halftone never inside the plot ✓.

**Component API**

```ts
// Reusable across screens. Drawn on raw <canvas> via a draw<Name>(c, big) fn,
// matching the shipped Dashboard idiom (fitCanvas + line + ink-offset 3-pass).
// Colour/accent come from the per-screen pigment via CSS vars; no inline palette.
// All numbers via Intl; tabular-nums on every DOM numeric node.

type RadarState = "loading" | "error" | "empty" | "ready";

interface RadarAxis {
  key: string;            // stable id
  label: string;          // Oswald uppercase, drawn at the rim
  value: number | null;   // REAL score on the SHARED 0..scaleMax scale; null => labelled em-dash spoke on true center (excluded from %)
  target: number;         // threshold vertex for this axis, on the SAME 0..scaleMax scale (real, supplied)
  unit?: string;          // modal-row + aria wording ONLY; never licenses mixing raw units on the plot
}

interface NtRadarProps {
  axes: RadarAxis[];            // 3–8; <=3 routes to a bar fallback (guarded), >8 rejected
  scaleMax?: number;           // shared axis max (default 100); true center = 0; ALL axes+targets must be on this scale
  passThreshold?: number;      // % of axes-at/above-target counted "on target" pass line (e.g. 60)
  onTargetPct: number | null;  // REAL headline % (0–100); null => "metric to confirm" block, never fabricated
  title?: string;              // tile + modal head (default "Portfolio Shape")
  subtitle?: string;           // modal sub
  accentVar?: string;          // CSS var name for the per-screen pigment, default "--teal"
  state?: RadarState;          // empty/loading/error/ready — never a bare/broken plot
  expandKey?: string;          // EXP registry key + ?expand= deep-link (default "radar")
  expandable?: boolean;        // default true; registers the click-to-expand modal
  ariaInsight?: string;        // worded key-insight; auto-derived (must match the hidden table) if omitted
  locale?: string;             // Intl.* formatting (default user locale)
  currency?: string;           // instrument currency for any monetary modal row (Intl); never hard-coded en-US/$
  onRetry?: () => void;        // error-state Retry handler
  onExpand?: (key: string) => void;
}

// Imperative draw fn registered in COLLAPSED_VIZ + EXP, same signature as the rest:
//   function drawRadar(c: HTMLCanvasElement, big: boolean): void
// big=false: tile render; reserves padT = min(120, H*0.30) for the upright DOM
//            .feat-figure headline % overlay (NOT on canvas; canvas carries no transform).
// big=true:  adds direct rim labels + boxed score tags + centered Anton % + worded label.
// Below-target nodes draw --loss + a hand-built FILLED ink down-triangle (path, not a font glyph).
// Value fill uses the exact drawValue gradient rgba(25,229,229,.42)->.03 at full globalAlpha.

declare function NtRadar(props: NtRadarProps): JSX.Element;
```

### Sparkline craft-spec adversarial verification

## Actuality Craft Spec — `Sparkline` (holdings-roster micro-trend)

### 0. What this is and where it lives
A tiny inline trend line living **inside each `.card` of the HOLDINGS ROSTER** (`prototypes/dashboard-final.html` lines 859–882 build+draw / `src/screens/dashboard/Dashboard.tsx` port). Each roster card carries: ticker (`.tkr`, Anton), allocation (`.alloc`, Space Mono), the **sparkline canvas** (counter-skewed `.spark`), and an up/dn **`.badge`** (teal/loss parallelogram with ▲/▼ + signed £ P/L). The sparkline must read direction (up/down) **at a glance**, with no axes, no gridlines, no numbers on the canvas itself — the badge carries the truthful figure.

This is the single riskiest viz in the system: as shipped (lines 870–882) it is a bare `2.4px` `TEALDK`/`LOSS` polyline (no nodes, no shadow, no fill) that reads close to a default Chart.js sparkline. This spec keeps the shipped draw idiom **but adds exactly enough house identity** (ink baseline rule + ink/colour end-cap node + whisper area fill) to stamp it as ours — without ever crowding a 34px-tall canvas or hurting the glance read.

### 1. Visual anatomy (collapsed, in-card — the only mode that exists)
Drawn on the existing **raw `<canvas>`** (`#sp-<TKR>`, 160×34 CSS px per line 865), via the canvas-only convention — never SVG, never a chart lib. Five hand-built strokes, back to front. **Hard ceiling on a 34px canvas: the two non-data ink layers (baseline + line-shadow) must stay visually subordinate to the colour line and node — if any element starts competing with the up/down glance read, thin or drop it, identity never beats legibility here.**

1. **Ink baseline rule** — a single `1px` ink hairline at the series min, `rgba(20,17,13,.18)` (matches the established axis-tick alpha). Anchors the line to a true floor so up/down has a reference; replaces the \"floating line in space\" look. One piece of chart chrome, deliberately quiet (sub-layer, never competes).
2. **Whisper area fill** — under the trend line only, a flat low-alpha wash of the direction colour: `rgba(14,138,134,.12)` for up (TEALDK), `rgba(200,64,47,.12)` for down (LOSS). No gradient, no halftone over the line (texture stays in the cream field beneath, never on the data). Capped at ~12% alpha so it adds body without muddying the glance read.
3. **Ink offset-shadow line** — the house stamp idiom, scaled down: the polyline drawn once in `rgba(20,17,13,.25)` offset `+1.5px, +1.5px`, `2.4px` wide. (Lighter than the feature chart's 3-pass; a 34px sparkline can't carry a full underline pass.)
4. **Trend line** — the polyline in `TEALDK` (#0E8A86) if up, else `LOSS` (#C8402F), **`2.4px` minimum (never thinner)**, `lineJoin:'round'`. Direction colour is **never the sole signal** — see §3. (Contrast note: TEALDK on cream2 measures ~3:1 — right on the floor — so the read must never depend on this hairline alone; the node + baseline carry it.)
5. **End-cap node** (the \"NOW\" point) — the donut/value-chart node idiom miniaturised: an **ink square** then a smaller direction-colour square on top, e.g. `fillRect(lastX-3.5, lastY-3.5, 7, 7)` INK then `fillRect(lastX-2.5, lastY-2.5, 5, 5)` in TEALDK/LOSS. Square corners (no caps), so it reads as a stamped marker, not a Recharts dot.

No axis labels, no value text, no legend, no gridlines beyond the single baseline. `border-radius: 0` everywhere. The canvas sits counter-skewed (`transform: skewX(var(--unskew))`, currently the neutralised `0deg`) so the trend stays geometrically true inside the sheared `.card` parallelogram (`clip-path` slant, per the shared tile system).

### 2. Colour / encoding (one accent + the locked gain/loss pair)
- **Substrate:** the card is `var(--cream2)`; baseline + ink-shadow + node-frame are `var(--ink)`. No coloured chart background, no marble behind the data.
- **Direction colour:** `up → TEALDK (#0E8A86)` (`var(--tealdk)` token), `down → LOSS (#C8402F)` (`var(--loss)` token) — exactly the shipped sparkline grammar (line 879). These reference named tokens; **no inline hex** in the component beyond the documented draw consts that already mirror CSS vars (lines 599–601). The line uses TEALDK (the darker teal) rather than bright `--teal` so the thin stroke clears contrast on cream2; bright `--teal` is used elsewhere for the value-line top pass and the up-badge fill, so keeping the line on TEALDK avoids a second bright-teal element competing inside one card.
- **Accent footprint:** the direction colour occupies the thin line + the ~7px node + a ≈12%-alpha wash — comfortably inside the \"accent is a highlighter, not a colour block\" budget. No second saturated hue ever enters this canvas.
- **Per-screen pigment note:** the roster is a Dashboard feature, so its accent is **teal** (Dashboard=teal in the binding map). A sparkline embedded on another screen swaps the direction-up colour to that screen's mapped pigment **only if** that screen's spec re-keys it; gain/loss semantics (teal-up / red-down) stay locked on the Dashboard roster.

### 3. Gain/loss is NEVER colour-only (hard rule)
The trend colour is the *third* channel, never the only one:
- The **`.badge`** already carries `▲`/`▼` (a real shape) **and** a signed `+£`/`−£` figure — the primary, always-visible, non-colour cue; it must stay.
- The **end-cap node** is additionally given a shape tell: **up → a `2px` ink tick extending up from the node / down → down**. Distinguishable in a greyscale / CVD emulator with zero hue.
- Verify in a vision-deficiency emulator: a row must be readable as up or down via badge glyph + sign + node tick alone.

### 4. Type (no type *on* the canvas; figures around it)
Nothing is drawn on the sparkline canvas — keeping the shipped convention that collapsed micro-trends carry no canvas text. The figures live in the DOM card:
- `.tkr` — **Anton** uppercase (display face).
- **Signed £ P/L in the badge** — render the **numeric figure in Space Mono** (the house money face, monospaced by construction so width is constant), with `font-variant-numeric: tabular-nums` as belt-and-braces. The shipped badge is Oswald 700 (line 222); keep Oswald only for the ▲/▼ glyph and any non-numeric label, but the money digits move to Space Mono so live P/L updates (`+£540 → +£1,240`) cause **zero** horizontal jitter / no card reflow — this does not depend on Oswald's unreliable `tnum`.
- `.alloc` — already Space Mono (line 216); keep, add `tabular-nums`.
- **No system-ui / Inter / Roboto, no italics, no thin weights** anywhere near the figure. Emphasis is via weight + the badge fill, never an italic flip.
- Format the `£` figure via `Intl.NumberFormat(locale, {style:'currency', currency})` — never hard-coded `£`/en-US; fixed decimals so width is constant.

### 5. Motion (snappy, ≤ a couple primitives, transform/opacity only)
> Note: Actuality ships **no** `--dur-*` duration token and **one** easing curve only — `cubic-bezier(.2,1.3,.3,1)` (a snappy overshoot kick, line 125), used for the tile hover. Values below are stated as literals, not as pre-existing tokens, to avoid inventing house canon.

- **First load only:** the card fades+kicks in via the shipped tile entrance (the roster's existing stagger); the sparkline canvas simply fades `opacity 0→.9` over **`220ms`** with a plain non-overshoot ease-out (`ease-out` / `cubic-bezier(.2,.8,.2,1)`) — a fade cannot overshoot, so this stays off the data-mark overshoot ban. Stagger by card DOM index (`--i * 60ms`, cap ~500ms total). After that the line is **just there** — static, crisp, no loop.
- **Hover / focus / tap on the card:** the **card** kicks via the established shipped tile signal — `transform: translate(-3px,-3px)` + the shadow deepening to `15px 15px 0 var(--tealdk)` over `.14s cubic-bezier(.2,1.3,.3,1)` (lines 125–126). This is the one sanctioned coloured (tealdk) hover shadow — hover-only, zero-blur, the existing tile kick — not a soft glow. Exactly **one** signal; the sparkline itself does not re-animate. No `scale`+`translate`+`shadow` stacked; no bounce on any data mark; no animating width/height/x/y.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` → canvas paints at final `opacity:.9` immediately (no fade, no stagger); the tile kick is disabled (matches shipped line 398, `.tile,.tile:hover{transition:none}`). Values readable at frame one regardless. Marble drift on the rail head pauses (`svg.pauseAnimations()`) and the CSS drift slows to 180s, per shipped lines 396–402.

Two animated primitives total: card-entrance fade and the shipped card-hover kick. Nothing else moves.

### 6. Interaction — hover/tap/keyboard + click-to-expand
Sparklines are glance objects, but values must reach **touch and keyboard**, not hover-only:
- The **whole roster card is the interactive target** (≥44×44px — it already is); add `tabindex={0}`, `role=\"button\"` (the shipped card has neither), with a `:focus-visible` **instant** hard ink focus ring (`outline: 3px solid var(--ink); outline-offset: 2px;` — no `transition` on outline, appears at frame 0). One hover signal = the tile kick (§5).
- **Tooltip / value on hover AND tap AND focus:** the exact min/max/now figures surface in a square ink-outlined tag (the house `.val` tag treatment — `2.5px` ink border, `3px` ink offset shadow, no radius) anchored to the card, shown on `pointerenter`, `click`/`tap`, and `focus`. Hover-open delay 800–1000ms; focus-open delay 0ms. Critical numbers are **also** always present in the badge, so no value is hidden behind hover.
- **Click-to-expand** (the system-wide pattern): clicking a card opens `#expand` (z-index 100, above the CRT at z90, outside the clipped stage) with the established **\"big viz left, boxed-tag numbers right\"** modal. The expand redraws a **`big=true`** sparkline (promoted to the feature-line treatment: gridlines, the 3-pass ink→TEALDK→TEAL line, axis £/period labels, Anton headline figure) on `#cv-exp`, with the right column an `EXP` entry: `{head:'<TKR> · Trend', sub:'Price trend · N periods', draw: drawSpark, rows:[['hero','P/L','+£540','gain'],['Now','£…','plain'],['Period high','£…','plain'],['Period low','£…','plain'],['Allocation','24%','plain']]}`. Numbers are **boxed value tags, not a spreadsheet**, one full-ink hero row. `?expand=<tkr>` deep-link + Esc-to-close. Modal canvas redraws via `ResizeObserver` on `.evbody`.

### 7. Data → numbers relationship (truthful, never invented)
- The component renders **only supplied values**. `data` is the real per-holding price/value series; `plRaw` is the supplied signed P/L; `dir` is **derived** (`data.at(-1) >= data[0] ? 'up' : 'dn'`) — computed from the user's own series, not invented.
- **Sign agreement is enforced in production, not just dev:** if derived `dir` disagrees with `sign(plRaw)`, the **supplied `plRaw` sign wins** — the badge sign and the line colour both follow `sign(plRaw)`, so the colour can never contradict the real money figure even if the series and P/L momentarily disagree. (A dev assert still fires to surface the mismatch upstream.)
- Geometry is honest: `Y` maps to the series' **own min/max** (`(mx-mn)||1` guard, exactly as shipped line 878) with `8px` horizontal pad (line 876); the **baseline sits at the true series min**, so up/down is read against a real floor (no truncated/exaggerated axis). The end-cap node is the true latest point.
- If `data` is missing/short (<2 points): **do not fake a line.** Render an em-dash state — a quiet `var(--ink)` `—` glyph centred on the cream canvas + the badge shows `—` — the honest \"metric to confirm\" hole, never a placeholder squiggle.

### 8. Four required states
- **populated:** as above.
- **loading:** a shape-matched skeleton — a single flat `rgba(20,17,13,.10)` baseline bar across the canvas footprint (not a spinner, not bare axes), card chrome intact.
- **empty** (new account / no series): canvas shows the `—` em-dash; card subtext \"No trend yet\" in Oswald; badge hidden.
- **error** (price fetch failed): canvas shows `—`; a tiny ink-outlined \"Retry\" chip (square, house tag) that re-runs `onRetry`. Never a broken/blank canvas.

### 9. Accessibility summary
- Canvas gets `role=\"img\"` + an `aria-label` stating the **key insight in words**, locale-formatted, branched by state so it never reads a stale or fabricated figure:
  - populated: `\"NVDA trend: up, +£540 over 8 periods, now £14,240\"`
  - empty: `\"NVDA: no trend data yet\"`
  - error: `\"NVDA: trend unavailable, price fetch failed\"`
- A visually-hidden text/table alternative mirrors the series for screen readers.
- The card is keyboard-reachable with the instant focus ring; the same tooltip values surface on focus.
- Contrast floors cleared: trend line ≥3:1 vs cream2 (TEALDK on cream2 ≈ 3:1 — kept at ≥2.4px and backed by node+baseline so it never relies on a borderline hairline alone); badge/figure text ≥4.5:1; baseline kept deliberately low-contrast as a sub-layer.

### 10. House-consistency checklist (must pass as a still)
`border-radius:0` (square node, square card, square tooltip) ✓ · hard zero-blur ink offsets only; the one coloured shadow is the shipped tile-hover tealdk kick (hover-only, zero-blur) ✓ · marble nowhere near the data (rail head only) ✓ · cream substrate + ink chrome ✓ · one teal accent + the locked teal/loss pair only, no rainbow ✓ · Anton/Oswald/Space Mono, Space-Mono tabular money figure, no Inter/thin/italic ✓ · single unified shear via the card's `clip-path`, content counter-skewed level ✓ · ben-day halftone in the cream field beneath, never over the line ✓ · sits under the same global CRT + halftone ✓ · motion uses only the shipped overshoot kick (on the card, not the data) + a plain opacity fade; no fabricated `--dur`/ease tokens ✓.

**Component API**

```ts
// Reusable canvas-drawn sparkline for the Actuality holdings roster.
// Consistent with the shipped Dashboard: raw <canvas> (no chart lib / no SVG),
// the ink-shadow + tealdk/loss draw idiom (dashboard-final.html lines 870-882),
// the clip-path parallelogram card, and the click-to-expand EXP modal pattern.

type SparkDir = "up" | "dn";
type SparkState = "populated" | "loading" | "empty" | "error";

interface SparklineProps {
  /** Stable id seed; canvas id becomes `sp-${ticker.replace(/\W/g,'')}` (matches shipped sparkId, line 861). */
  ticker: string;

  /** Real per-holding value/price series (user-supplied). >=2 points to render a line; else em-dash state. */
  data: number[];

  /** Direction; if omitted, derived: data.at(-1) >= data[0] ? 'up' : 'dn'.
   *  HARD RULE: if derived dir disagrees with sign(plRaw), sign(plRaw) wins for BOTH
   *  badge sign and line colour (truthful supplied number governs) — enforced in prod, not dev-only. */
  dir?: SparkDir;

  /** Truthful signed P/L for the badge + aria summary. Raw number; formatted via Intl in-component.
   *  Rendered in Space Mono (house money face, monospaced) so live updates never reflow the card. */
  plRaw: number;

  /** ISO currency + locale for Intl.NumberFormat (badge £, tooltip, aria). Never hard-coded en-US/£. */
  currency?: string;            // default "GBP"
  locale?: string;              // default navigator.language

  /** Optional period labels (used only in the big=true expand draw; collapsed canvas has no labels). */
  periods?: string[];

  /** Lifecycle state -> drives skeleton / em-dash / retry rendering. Default "populated". */
  state?: SparkState;
  onRetry?: () => void;         // error-state retry affordance

  /** Per-screen accent override for `up`. Defaults to TEALDK (Dashboard line colour). Down is always LOSS.
   *  Note: the line uses TEALDK not bright --teal so the 2.4px stroke clears contrast on cream2. */
  upColorToken?: "--tealdk" | "--teal" | string;  // references a named CSS token, never inline hex

  /** Click-to-expand: opens the shared EXP modal (big viz left, boxed-tag numbers right). */
  onExpand?: (ticker: string) => void;

  /** Collapsed canvas CSS size (defaults 160x34, the shipped roster footprint, line 865). */
  width?: number;               // default 160
  height?: number;              // default 34

  /** Honored automatically via matchMedia; also exposed for testing the reduced-motion branch. */
  reducedMotion?: boolean;

  className?: string;
}

// Draw fn signature matches the shipped house convention exactly:
//   drawSpark(c: HTMLCanvasElement, big: boolean): void
// big=false -> collapsed (baseline rule + whisper area + ink-shadow line + colour line + ink/colour end-cap node + up/down tick).
// big=true  -> expand-modal render: gridlines, 3-pass ink->TEALDK->TEAL line, axis £/period labels, Anton headline.
// Uses shared fitCanvas(c) (backing store = CSS box * min(dpr,2), pre-scaled ctx, line 874)
// and line(ctx,pts,col,w) (line 623). Draw after document.fonts.ready (+ the shipped rAF/240/380 redraw passes).
declare function drawSpark(c: HTMLCanvasElement, big: boolean): void;

// Motion: NO --dur-* token and only ONE easing exist in the shipped file.
//   card hover  -> transform: translate(-3px,-3px); box-shadow: 15px 15px 0 var(--tealdk);
//                  transition: .14s cubic-bezier(.2,1.3,.3,1) (the shipped tile kick, lines 125-126)
//   canvas fade -> opacity 0->.9 over 220ms, plain ease-out (a fade can't overshoot)
//   reduced-motion -> final opacity:.9 instantly; tile transition:none (matches shipped line 398)

declare const Sparkline: React.FC<SparklineProps>;

/* EXP registry entry contributed by this component (consumed by the shared expand modal):
   EXP[ticker] = {
     head: `${ticker} · Trend`,
     sub: `Price trend · ${periods?.length ?? data.length} periods`,
     draw: (c, big) => drawSpark(c, big),   // big=true => feature-line treatment
     rows: [
       ['hero', 'P/L', fmtCurrency(plRaw), plRaw >= 0 ? 'gain' : 'loss'],
       ['Now',         fmtCurrency(data.at(-1)),       'plain'],
       ['Period high', fmtCurrency(Math.max(...data)), 'plain'],
       ['Period low',  fmtCurrency(Math.min(...data)), 'plain'],
       ['Allocation',  `${allocPct}%`,                 'plain'],
     ],
   }  // values are boxed ink-outlined tags, one full-ink hero row — never a spreadsheet table.
      // fmtCurrency = Intl.NumberFormat(locale,{style:'currency',currency}); never hard-coded £/en-US.
*/
```

### Expand pattern + numbers readout

## Archetype — Expand pattern + numbers readout

**The law.** Tap a viz tile and it doesn't just enlarge — it *splits*. The chart grows on the **left**, and a **column of clear, precise, boxed numbers** appears on the **right**. Decoration (marble, halftone, hatch) is shoved to the **frame/border**; the data plane stays flat, crisp, square. This is Actuality's single information-architecture move, already shipped in the Dashboard `.expand` modal — this spec hardens it into one reusable component (`ExpandableViz` + `StatReadout`) so every screen builds it identically and the per-screen pigment is the *only* thing that changes.

Two things must coexist and never trade off: it is **hand-stamped and distinctive**, and it is **dead-legible and numerically honest**. Distinctive never costs a readable number.

---

### 1. Visual anatomy (the locked layout)

The expanded overlay is a **fixed, viewport-level layer at `z-index: 100`** — above the CRT (`z90`), outside the clipped stage. It reuses the shipped structure exactly:

```
.expand (fixed, z100, scrim rgba(10,9,7,.66), click-scrim closes)
 └─ .expFrame  ── DECORATION LIVES HERE, on the border only:
     · <NtMarble class=frmarble> drifting marble (z1)
     · .frhalf  radial-dot halftone @ .20, .frhatch t/b  ink dashes @ .50
     · .frtag  "<SCREEN> TRUTH" marble tag, top-left, ink-veil + text-shadow
     · .expClose  "✕ CLOSE" ink tag, top-right (hover→loss); ✕ is U+2715 +
       U+FE0E text-presentation (a typographic glyph, NOT an emoji / controller prompt)
     · frame fill = var(--accent-deep)/--tealdk, padding 16px,
       box-shadow: 0 0 0 6px var(--ink), 26px 26px 0 rgba(20,17,13,.5)
     └─ .expInner  (the DATA PLANE — flat cream2, 5px ink border)
         display: grid; grid-template-columns: 1fr minmax(360px, 470px);
         ├─ .expViz   VIZ LEFT  — 5px ink border-right divider
         │    .evh  Anton title · .evs Oswald sub · .evbody<canvas big=true>
         │    ::before halftone @ .05 multiply UNDER the canvas only
         └─ .expData  NUMBERS RIGHT
              .edh   "<HEAD> · NUMBERS"  Anton on accent tag
              .edlist  bordered, box-shadow 6px 6px 0 ink, overflow hidden
                ├─ .edrow         label ↔ boxed .val tag   (alternating bands)
                ├─ .edrow.hero    full-ink band, Anton accent .val
                └─ …
              .edFoot  "Trading 212 · delayed · synced HH:MM"
```

**The numbers readout (`.edrow`) is the tabular stat/informatics block** the archetype is named for, and it is deliberately **NOT a spreadsheet**:
- Each row = a left **label** (`Oswald 700, uppercase, ink @ .82`) and a right **boxed value tag** (`.val`): `Space Mono 700`, `var(--cream)` fill, `2.5px solid var(--ink)`, **`box-shadow: 3px 3px 0 var(--ink)`**, `min-width: 100px`, right-aligned. The hard ink offset on every value tag is what makes the number read as *stamped*, not typed into a cell. Space Mono is inherently tabular; that fixed box + tabular figures = **zero layout shift** on update.
- Exactly **one `.hero` row** per readout: full **ink** band, label in cream, value in **Anton on the gain/loss tag** (`box-shadow: 4px 4px 0 rgba(242,236,224,.25)`). This is the "big number + sign + sublabel" hero — the lead figure, always paired with its worded label (never a bare giant number). **Anton has no true tabular figures**, so a hero value that **updates live must be set in Space Mono** (or kept static); reserve the Anton hero for non-ticking summary figures, and always inside the width-locked tag so the box never re-flows.
- Alternating bands: `:nth-child(odd)` cream2, `:nth-child(even)` `rgba(20,17,13,.085)`. To stay **kinetic, not a striped data-grid**, the band carries a non-table beat — a faint multiply halftone on the even bands and the `.val` tag pivoted upright via the same counter-skew used everywhere (so tags read as stamped chips, not cells). Past ~6 rows the boxed-tag + halftone treatment is what keeps it off the zebra-table read.
- **Delta / sign / sublabel** convention: signed figures carry `+`/`−` *in the string* and a `kind` of `gain|loss|plain`; **gain tag → fixed semantic gain teal (`--gain` `#2FB5A8`), loss tag → `--loss` (`#C8402F`) with cream text** — these are the ONLY semantic colours and they **stay teal/red on every screen** (they are never swapped to the per-screen accent). Sign + fill + (in collapsed overlays) a `▲/▼` glyph (U+25B2/U+25BC + U+FE0E text-presentation, never emoji) = the mandatory non-colour channel.

**Collapsed tile (the trigger).** Stays a clip-path parallelogram tile (`--slant 16`, `6px ink border`, `box-shadow: 10px 10px 0 ink`, hover lifts to `15px 15px 0 var(--accent-deep)`). Per the shipped convention, **the headline number lives in the DOM overlay, not on the canvas**, for hero/gauge viz: `.featFigure` (Anton `clamp(32–52px)`, counter-skewed, right-aligned over reserved blank canvas top), `.featTag` (accent Oswald tag, left), or the gauge's side-by-side `.greadout` (`.rtNum` Anton + `.rtSub` Oswald). The canvas draws big numbers **only in `big=true`** mode. The tile is a real control — see §5 (`role="button"`, keyboard, focus ring).

---

### 2. Colour & encoding (tokens only — no invention)

Reference these **named tokens** (mirrored `:root` → `.screen`): `--cream #EDE6D2`, `--cream2 #F2ECE0`, `--ink #14110D`, gain `--gain/--teal2 #2FB5A8`, loss `--loss #C8402F`, plus the canvas consts `INK / TEAL #19E5E5 / TEALDK #0E8A86 / PURPLE #5D5A86` (benchmark) / `ORANGE #FF5A1F` (warning only).

- **One pigment accent per screen**, injected as **`--accent` / `--accent-deep` / the six `--mrb-*` marble vars** — the *only* thing a new screen overrides. Map (binding): Dashboard=teal, Positions=magenta, Watchlist=sky, Performance=lime, Compare=violet, Journal=amber, Settings=gold. The accent appears **only** on: the active tile head, the `.frtag`/`.edh` tags, the marble border, and the focal series/point. **Gain/loss tags are NOT accent-coloured** — they hold the fixed semantic teal/red on every screen, so a `.val.gain` on Positions is still teal, not magenta. No second bright hue inside one chart; everything else is ink on cream.
- **Gain/loss are the only semantic colours beyond the accent**, used **tiny** — on the decisive figure (`.val.gain/.loss`, the hero, the one delta), never as a fill across every row or bar.
- **Chart chrome stays anchor-tinted ink, never zero-chroma:** gridlines `rgba(20,17,13,.12)`, axis text `rgba(20,17,13,.5)`, gauge track `rgba(20,17,13,.14)`. Carry the house texture into the grid where it reads (e.g. dashed ink rules or a halftone tick rhythm) so the grid isn't bare SaaS chrome. Cream paper substrate — **never a white or grey chart background, never marble or gradient behind data.**
- **Red/green never colour-only:** every signed value ships a `+`/`−` and (in tiles) a `▲/▼` (text-presentation glyph); loss tags also differ in fill+text-colour. **Contrast must be verified after each per-screen accent swap:** `.val` label/value text ≥4.5:1, data marks ≥3:1; confirm the `--gain`/`--loss` tags and the safe/danger gauge zones survive a CVD emulator (the accent changes per screen, gain/loss do not — re-check both).

---

### 3. Type

Fixed roles, no neutral faces (`system-ui/Inter/Roboto` banned, on canvas *and* DOM):
- **Display / hero numbers / titles:** `Anton` 900 (alt `Unbounded` 700–900) — `.evh`, `.hero .val` (static/summary only), `.featFigure .big`, `.rtNum`, canvas big-mode figures. Roman, never italic.
- **Labels / axis ticks / legends / status:** `Oswald` 600/700 UPPERCASE, wide tracking — `.lbl`, `.evs`, `.edFoot`, `.featTag`, axis tick labels.
- **Money & numeric readouts:** `Space Mono` 700 — `.val`, **any live-updating hero figure**, canvas axis/money labels. Space Mono is inherently tabular. For any Anton/Unbounded figure that updates live there is no tabular fallback, so such figures must be re-set in Space Mono; add **`font-variant-numeric: tabular-nums`** on Space Mono runs and keep the fixed-width box (`.val` `min-width:100px`) so updating values cause **zero layout shift**. Fixed decimals per instrument; format at the call site with `Intl.NumberFormat`/`Intl.DateTimeFormat` and the instrument's currency — **never hard-coded `$`/en-US, never `'£'+n` string concat** (the `value` string a caller passes MUST already be Intl-formatted).

---

### 4. Motion (snappy stamp/kick, ≤2 primitives, transform/opacity only)

- **Tile → expand:** the overlay enters with **opacity 0→1 + `transform: scale(.96)→1`** on `.expFrame`, `--dur-long ~220ms`, `cubic-bezier(0.16,1,0.3,1)` (exp ease-out). One stamp, two properties. No width/height/top/left animation.
- **Canvas viz** is drawn at **final state on first paint** (data readable instantly — never gated behind a draw-on). If a one-time entrance is wanted, it is the shipped pattern: a single orchestrated reveal on first mount only (bars `scaleY` from baseline / line `stroke-dasharray`) — but here the canvas simply paints final. No re-animate-on-scroll, no perpetual needle/sweep.
- **Tile hover/active (the kick):** `translate(-3px,-3px)` + shadow deepens `10→15px` to accent-deep, ~120ms snappy. Active tile head **inverts to accent fill** with ink type. Exactly one signal pair, no scale+rotate+shadow pileup.
- **`.val` / `.expClose` hover:** instant ≤120ms colour/fill shift only.
- **Marble** drifts ~26s (the shipped canon duration) on the **frame only** — never behind data.
- **`prefers-reduced-motion: reduce`:** the modal **overlay entrance is snapped to final state** (`opacity:1; scale(1)`, `transition:none`), `.val`/`.expClose`/tile transitions set to `none`, `svg.pauseAnimations()` on all marble, `.marbleDrift` slowed to ~180s. (The shipped block only covers `.tile`/`.tb-live`/`.marble-drift`; this component MUST add the overlay-entrance and tag transitions to that set.) Functional progress only may still run. The static still must already pass the verify checklist.

---

### 5. Click-to-expand behaviour & data→numbers relationship

- **Trigger:** the whole collapsed tile is `role="button"`, focusable (`tabindex="0"`), with **Enter/Space + click/tap** all opening it (the shipped prototype wires click-only on a `<div data-viz>` — this component MUST add the role, tabindex, and key handlers). `≥44×44px` hit area. `.ex` "Expand ⤢" chip is the affordance.
- **Open/close:** `open: string | null` keyed by viz id; `?expand=<key>` deep-link (for share/screenshot); **Esc** and scrim-click close. Focus is trapped in the modal while open and **returned to the triggering tile on close**. On open, modal canvas redraws on `requestAnimationFrame` after layout settles, plus a `ResizeObserver` on `.evbody`.
- **One source of truth:** the **same `draw(canvas, big)` fn** renders the collapsed tile (`big=false`) and the modal viz (`big=true`) — the picture can never disagree with itself. The **right-hand numbers and the left-hand viz read from the identical `series`/`rows` data**; a `.val` is never a figure the chart can't justify.
- **Honesty (hard):** never render a value the user didn't supply. A missing figure → `.val` shows an **em-dash on an ink-on-cream (anchor-tinted, NOT zero-chroma grey) "—" tag** with label "metric to confirm", or the row is dropped — never a placeholder like `+47%`/`99.9%`. Draw honestly: true-zero baselines, gauge arc length `= value/range`, un-truncated axes.

---

### 6. Hand-crafted vs default-slop, and the four required states

**What makes it bespoke (not Recharts/Chart.js):** every viz is **raw `<canvas>` 2D** (no chart lib; SVG reserved only for `#ntMarble`), drawn with the signature **ink offset-shadow idiom** — every primary mark stamped twice: an ink copy offset (+2px lines / +4–6px bars) under the bright mark; line charts go 3-pass (ink-shadow → `TEALDK` underline → `TEAL`/accent overline); nodes are ink square then accent square; donut wedges each ink-stroked like cut paper. Square corners everywhere (`border-radius:0`), hard zero-blur ink offsets, halftone under cream only, per-screen pigment, CRT-aware, marble on frame only. **Geometry is via `clip-path`; the legacy `--skew/--unskew` tokens stay pinned to `0deg` (never re-enable a non-zero `skewX` — it overhangs and gets clipped).** The numbers readout's **boxed `.val` tags with `3px 3px 0` ink shadow** are the table's version of the same stamp — which is what keeps the right column from drifting into a generic striped data-grid.

**Identity hardening for the inherited-risk viz** (don't ship the shipped near-misses unchanged): in-card **sparklines** get one extra beat (faint area fill, an ink baseline, or an end-cap node) so they don't read as a Chart.js line; the **donut centre label** and **big-mode legends** adopt the boxed-tag language (ink-outlined swatch + Oswald ticker + Space Mono percent tag) rather than flat ink text; gridlines carry a dashed-ink/halftone treatment as above.

**Four mandatory states** (every viz + readout, never a blank/broken chart — the shipped prototype has none of these and MUST gain them):
- **empty** — in-frame worded message + CTA ("No positions yet — add one to see your equity curve"); readout rows collapse to a single guidance row.
- **loading** — shape-matched **skeleton** (ink-outlined ghost bars/ring/line + greyed `.val` blocks rendered as ink-tinted, not zero-chroma), **never a spinner over bare axes**.
- **error** — cause text + a **Retry** affordance (ink tag).
- **populated** — the real canvas + boxed numbers.

**Accessibility contract** (additive — the shipped Dashboard ships none of this; see §7): the modal canvas gets `role="img"` + an `aria-label` stating the **key insight in words** ("True growth +9.5%, +£1,240 vs deposits over 8 periods"); the `.edlist` *is* the visually-present text/table alternative (decorative marble/halftone are `aria-hidden`). Tiles and `.val`-bearing rows are keyboard-reachable with an **instant `:focus-visible` ink ring** (no animated focus). Tooltips/value reveals work on hover **and** tap **and** focus. A readout exceeding ~50 rows virtualizes; sortable variants set/update `aria-sort`. Contrast floors: data marks ≥3:1, all labels/values ≥4.5:1, gridlines kept low-contrast as a sub-layer.

---

### 7. Consistency contract (do not deviate)

Match the shipped Dashboard's **structure and visual grammar 1:1**: same `.expand` z-stack, same `1fr minmax(360px,470px)` grid, same `.edrow/.val/.hero` tag language, same `draw(c,big)` signature + `fitCanvas`/`line` helpers, same `EXP[key] = { head, sub, draw, rows }` registry, same `<NtMarble>`/`<MarbleDefs>` reuse, same clip-path tile tokens (`--slant 16 / --slant-sm 9 / --vslant 14`; the `--skew/--unskew` tokens stay neutralised to `0deg`). A new screen changes **only** the accent/marble tokens and the data — nothing structural.

**What this component ADDS on top of the shipped prototype** (the prototype/`Dashboard.tsx` ship none of these, so "match 1:1" applies to structure, NOT to the missing safeguards): `role="button"`+keyboard on tiles, `role="img"`+`aria-label` on the modal canvas, `:focus-visible` rings + focus return, the four data states, `Intl.*` locale/currency formatting (replacing the prototype's hardcoded `£14,240` strings), `tabular-nums` on Space Mono runs, the reduced-motion coverage of the overlay entrance, and the CVD/contrast re-check per accent swap. These are mandatory and non-negotiable even though the current shipped file lacks them.

Fonts loaded before first paint (`document.fonts.ready` + 240/380ms redraws).

**Component API**

```ts
// === Reusable expand-pattern + numbers-readout components ===
// Drop-in for any Actuality screen. The only per-screen change is the `accent`
// token set; structure, motion, and number-tag styling stay locked.
// NOTE: this component ADDS the accessibility + honesty layer the shipped
// Dashboard prototype lacks (role/aria/keyboard/focus/four-states/Intl/tabular);
// it matches the shipped STRUCTURE 1:1, not the prototype's missing safeguards.

type Kind = "plain" | "gain" | "loss";
type VizState = "loading" | "error" | "empty" | "ready";

/** Pure canvas renderer — collapsed (big=false) AND modal (big=true) share ONE fn.
 *  No chart lib; raw 2D ctx with the ink offset-shadow idiom. */
type DrawFn = (c: HTMLCanvasElement, big: boolean) => void;

/** One row of the tabular stat/informatics readout (the "numbers" column). */
interface StatRow {
  label: string;
  /** Pre-formatted at the call site via Intl.NumberFormat / Intl.DateTimeFormat
   *  with the instrument's currency. NEVER raw, NEVER string-concatenated ("£"+n). */
  value: string;
  /** gain -> fixed semantic teal (--gain #2FB5A8); loss -> --loss #C8402F.
   *  These are SEMANTIC and stay teal/red on EVERY screen — they are never the
   *  per-screen accent. Sign (+/-) is carried IN `value` as the non-colour channel. */
  kind?: Kind;
  /** exactly one per readout: full-ink band, big tag. If this hero value updates
   *  live it MUST render in Space Mono (Anton has no tabular figures); a static
   *  summary hero may use Anton. */
  hero?: boolean;
  /** true -> em-dash on an ink-on-cream "metric to confirm" tag (honest hole).
   *  The tag is anchor-tinted ink, never a zero-chroma grey. */
  confirm?: boolean;
}

/** Single expandable viz tile (collapsed) that opens the viz-left/numbers-right modal.
 *  The tile renders as role="button" tabindex=0 with Enter/Space/click/tap all opening. */
interface ExpandableVizProps {
  id: string;                       // EXP key; also drives ?expand=<id> deep-link
  head: string;                     // modal title (.evh / .edh)
  sub: string;                      // modal subtitle (.evs)
  chartKind: "trend" | "comparison" | "proportion" | "profile" | "gauge";
  draw: DrawFn;                     // the shared renderer
  rows: StatRow[];                  // numbers readout (>=50 rows -> auto-virtualized)
  state?: VizState;                 // default "ready"; gates empty/loading/error UI
  ariaSummary: string;              // key-insight sentence -> canvas role=img aria-label (REQUIRED)
  emptyCta?: string;                // worded empty-state guidance + CTA label
  collapsedFigure?: {               // DOM overlay number on the tile (NOT on canvas)
    big: string; sub?: string; kind?: Kind; tag?: string;
  };
  onRetry?: () => void;             // error-state Retry handler
  span?: 1 | 2;                     // grid span for the collapsed tile (asymmetry)
}

/** The modal itself — usually rendered once at app/screen root and driven by state.
 *  z100 (above CRT z90); Esc + scrim-click + close-tag dismiss; focus is trapped
 *  while open and RETURNED to the triggering tile on close. */
interface ExpandModalProps {
  openId: string | null;           // null = closed
  registry: Record<string, Omit<ExpandableVizProps, "state" | "span">>;
  onClose: () => void;
  screenLabel: string;             // e.g. "PERFORMANCE TRUTH" for the .frtag
}

/** Standalone numbers block (reused inside the modal AND any tile .greadout). */
interface StatReadoutProps {
  heading?: string;                // ".. · NUMBERS" tag
  rows: StatRow[];
  footnote?: string;               // source/sync line (.edFoot)
  virtualizeAfter?: number;        // default 50
}

/** Per-screen accent — the ONLY thing a new screen overrides (CSS custom props).
 *  Does NOT include gain/loss: those are fixed global semantic tokens
 *  (--gain #2FB5A8 / --loss #C8402F) and never change per screen. */
interface AccentTokens {
  "--accent": string;              // pigment per map (teal|magenta|sky|lime|violet|amber|gold)
  "--accent-deep": string;
  "--mrb-base": string; "--mrb-deep": string; "--mrb-veil": string;
  "--mrb-mid": string; "--mrb-core": string; "--mrb-bright": string;
}

declare function ExpandableViz(p: ExpandableVizProps): JSX.Element;
declare function ExpandModal(p: ExpandModalProps): JSX.Element;     // z100, above CRT
declare function StatReadout(p: StatReadoutProps): JSX.Element;
// Shared, unchanged from shipped Dashboard:
declare function NtMarble(p: { className?: string }): JSX.Element;
declare function MarbleDefs(): JSX.Element;
declare function fitCanvas(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number };
declare function line(ctx: CanvasRenderingContext2D, pts: number[][], col: string, w: number): void;
```

### Chart states

# Actuality Craft Spec — `<VizState>` (empty / loading-skeleton / error-with-retry / stale-data)

Every Actuality viz already draws on a raw `<canvas>` inside a clip-path parallelogram tile (see `src/screens/dashboard/Dashboard.tsx`, `src/screens/dashboard/Dashboard.module.css`). This archetype is the **non-populated lifecycle** of that exact tile. The rule: a tile in any state is still a *stamped comic-collage data panel*, never a bare spinner, never a blank axis, never a default skeleton-shimmer rectangle. The shipped Dashboard has **no** empty/loading/error handling yet, so this is the canonical implementation all seven screens import.

The state shape is drawn on the **same `#cv-*` canvas** as the populated chart (not a different DOM node), so swapping `state` never reflows the tile. The tile chrome (border 6px ink, `box-shadow: 10px 10px 0 var(--ink)`, `clip-path` parallelogram), the head bar, and the expand chip are identical across all four states.

> **Token honesty note (binding):** the shipped `Dashboard.module.css` does **not** define `--dur-*` motion tokens. The tile transition is the literal `transform 0.14s cubic-bezier(0.2,1.3,0.3,1), box-shadow 0.14s`; chip background transitions are `0.12s`. This spec uses those exact shipped values. If named duration tokens are wanted, they must be **added to `:root`/`.screen` first** (e.g. `--dur-sweep: 420ms; --dur-enter: 220ms; --dur-kick: 140ms`) — they may not be referenced as if already locked. Every colour below references the existing `:root`/`.screen` tokens (`--ink`, `--cream/2`, `--teal/2/dk`, `--gain`, `--loss`, `--purple`, `--orange`); never inline hex.

---

## 1. Visual anatomy (shared across states)

The wrapper is the existing tile — **do not add a card-in-card**. One containment layer only:
- `.tl` tile: `border: 6px solid var(--ink)`, `box-shadow: 10px 10px 0 var(--ink)`, `clip-path: polygon(var(--slant) 0, 100% 0, calc(100% - var(--slant)) 100%, 0 100%)`, `border-radius: 0`.
- `.tl-head`: ink bar, viz name in **Anton** uppercase, expand chip (teal, ink-outlined parallelogram, `--slant-sm`).
- `.tl-body`: the `<canvas>` (`position: absolute; inset: 0; width/height: 100%`), under it a `.halftone` radial-gradient at ~6% multiply, clipped to the cream body.
- **Hover/selection kick (shipped):** the tile transitions `transform 0.14s cubic-bezier(0.2,1.3,0.3,1)` to `translate(-3px,-3px)` and the shadow deepens to **`15px 15px 0 var(--tealdk)`** (teal-tinted, zero blur) — this is the exact shipped `.tl:hover` behaviour, not the doc's generic "9–11px ink." Match it.

What changes per state is **only what the canvas draws** plus one small DOM status chip; the silhouette stays put so the four states are visually a family. Every per-state DOM chip is `border-radius: 0`, hard ink offset shadow only.

**Skeleton silhouette rule:** the loading state must be drawn in the *literal shape of that viz* — a line tile skeletons a line, the gauge skeletons a semicircle arc, the donut skeletons a ring, the P/L skeletons diverging bars. Never a generic shimmer block, never a centred spinner (anti-slop tell). Reuse each viz's own geometry helpers (`X(i)`, `Y(v)`, the gauge `a0=π/a1=0`, the donut `-π/2` start) so the skeleton lands exactly where the real marks will.

---

## 2. The four states — concrete canvas treatment

All four draw with `fitCanvas(c)` + the shared `line(ctx, pts, col, w)` helper, in **ink-on-cream only** (no pigment accent except where noted), so an unpopulated tile reads calm-but-crafted, not broken. Token names below reference the locked `:root`/`.screen` tokens — never inline hex.

### (a) LOADING — skeleton in the viz's silhouette
- Draw the chart's **gridlines and axis frame for real** (the populated `'rgba(20,17,13,.12)'` rules + `'rgba(20,17,13,.5)'` Space Mono tick labels) so layout is already truthful — the skeleton is the *data layer* only. To keep the empty frame from reading as default chart chrome, the cream body still carries its `.halftone` under-layer (house texture, not a bare plot).
- Over the frame, stamp **ghost marks** in the ink-offset idiom but hollow: a dashed ink polyline (`setLineDash([7,6])`, `'rgba(20,17,13,.22)'`, width 4) following the viz's path region for line/area; **hatched ghost bars** (ink stroke, no fill) for P/L/split; a **dashed ink arc** for gauge/donut track. No teal, no gain/loss — the accent is reserved for real data.
- Motion = **one** perpetual primitive only: a `transform: translateX` sweep of a single narrow **hard-edged ink-tint band** (`opacity` 0→.14→0, `border-radius: 0`, no soft gradient feather that could read as a default shimmer), masked to the body, looping at the shipped `0.14s`-family snappy feel but slowed for a loader (~420ms loop; if a token is wanted, add `--dur-sweep: 420ms` to `:root` first), `cubic-bezier(0.16,1,0.3,1)`. This is the *one* sanctioned perpetual loop. Animate transform/opacity only — never redraw geometry per frame; the dashed skeleton is painted once and the sweep is a CSS overlay `<div>`, not a canvas repaint.
- DOM status chip (top-right of body, boxed ink-outlined parallelogram, `--slant-sm`, `border-radius: 0`, hard ink offset): Oswald 700 uppercase **"LOADING"** + 3 **static** ink dots. The dots do **not** animate — the sweep is the single loop; a second stepping-opacity loop would break the one-perpetual-loop rule. Never the word over empty axes alone.

### (b) EMPTY — "no data yet" + guidance, in-frame
- Draw the **axis frame + gridlines faintly** (same chrome, ~0.6× alpha) so the user sees the chart's home, then a single **stamped ink message block** centred-low in the plot area: a small ink-outlined parallelogram tag (`--slant-sm`, `border: 2.5px solid var(--ink)`, `box-shadow: 3px 3px 0 var(--ink)`, `border-radius: 0`) holding Oswald 700 uppercase copy + a CTA.
- Copy is **viz-specific and worded** (never a bare icon): e.g. value tile → `"NO EQUITY CURVE YET"` / sub `"Add a position to plot your value"` + CTA chip `"+ ADD POSITION"`. The CTA is the **only** place the per-screen pigment accent appears in an empty state (Dashboard=teal fill, cream type, ink outline) — `<= 3–5%` of the tile.
- A faint **halftone dot-cluster** (`drawDotCluster`) drifts once from a corner so empty cream still carries texture (anti-slop: never bare flat cream).
- No motion beyond the static still; the CTA gets the standard hover kick (§4).

### (c) ERROR — cause + retry, never a dead chart
- Draw the axis frame in **loss-tint** chrome: gridlines `'rgba(200,64,47,.16)'` (the established drawdown-area alpha), so the tile reads "this one's wrong" without shouting.
- Centre a stamped ink block: Oswald 700 uppercase cause line (e.g. `"PRICE FEED UNAVAILABLE"`) + a smaller plain sub (`"Couldn't reach the market data service"`). Pair the error with a **non-colour cue** — a drawn ink warning glyph (a stamped `!` in an ink-outlined square, our own SVG-in-canvas stroke, **not** an emoji and **not** a Lucide-mismatched icon) — so the error state isn't colour-only.
- **Retry** is a real, focusable boxed chip: ink-outlined parallelogram, `border-radius: 0`, **ORANGE** fill (`--orange` is the sanctioned *warning-only* role from the shipped color grammar — this is the one place orange is correct, not the screen accent), cream Oswald 700 `"RETRY"`. It re-runs the fetch (`onRetry`). `>= 44×44px` hit area, `:focus-visible` **instant** ink ring (no transition on outline/box-shadow).
- No loading sweep here; if `onRetry` fires, the tile transitions to state `loading`.

### (d) STALE — real data, but flagged not-fresh
- This is the only non-populated state that **still renders the populated chart** (real numbers, real teal line / gain-loss bars) — staleness must never hide truthful data. The chart draws exactly as populated via `draw(c, big)`.
- Over it: flag staleness **without dropping the coloured data below the contrast floor.** Dim only the **area-fill and node-fill** layers, and keep the value **line/bars at full strength** (or, if a uniform dim is used, no lower than ~0.7 on the coloured strokes) so the teal overline and loss marks still clear **>= 3:1** against cream + halftone. The **axis frame stays full strength.** Stamp a **"STALE · {age}"** chip top-right (ink-outlined parallelogram, `border-radius: 0`, Oswald 700, e.g. `"STALE · 14:32"` or `"STALE · 6 MIN"`). The age string — both the clock form and the relative form — is **locale-formatted via `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat`** (never hard-coded) and carries `font-variant-numeric: tabular-nums` so a tick from `"6 MIN" → "7 MIN"` (or `"14:32" → "14:33"`) never reflows.
- A thin **dashed ink hatch band** runs along the top edge of the plot (the "do not trust as live" marker) — a second non-colour channel beyond the dimming.
- Optional tiny **"REFRESH"** chip (screen-accent, like empty's CTA) calling `onRefresh`. Numbers shown are still the real supplied numbers — **never invent a placeholder figure**; if a value is genuinely missing within a stale render, that single slot is an **em-dash on a labelled ink-tint block** (`"—"` / "stat pending"), per the honesty rule.
- The state must remain legible as a **still screenshot** at the chosen dim level (the shipped verify gate).

---

## 3. Colour / encoding (locked grammar)

- **Substrate:** `--cream` body, `--ink` for every frame/axis/tick/skeleton/message stroke. No pure `#000/#fff`, no zero-chroma grey — chrome uses the established `rgba(20,17,13,.12)` grid / `.5` ticks.
- **Per-screen pigment accent** (Dashboard=teal, Positions=magenta, Watchlist=sky, Performance=lime, Compare=violet, Journal=amber, Settings=gold) appears in non-populated states **only** on the empty-CTA and stale-REFRESH chips — driven by a `--accent` var on the tile, so one component serves all seven screens by swapping that token. (`--accent` must be added to `.screen`/the tile; it is not yet in the shipped CSS.) Footprint `<= 3–5%`.
- **Error RETRY uses `--orange`** (warning role), *not* the screen accent — this is the one deliberate exception and matches the shipped "orange = warnings only" rule.
- **Gain/loss never colour-only:** the error warning glyph, the stale hatch band, and any signed figure carry a sign/shape/pattern in addition to hue. Loss-tint error chrome is paired with the drawn `!` glyph.
- Marble is **never** rendered behind any state's canvas — empty/loading/error/stale all sit on flat cream + halftone. Marble stays on the tile's border ring / modal frame only.

---

## 4. Type

- Messages, CTAs, status chips, retry: **Oswald 600/700 UPPERCASE**, wide tracking — the shipped label face. Never system-ui/Inter, never thin, never italic.
- Any number that does appear (stale chip age, em-dash placeholder label, axis ticks drawn in skeleton): **Space Mono** for figures/ticks, `font-variant-numeric: tabular-nums` on any DOM-level numeric chip so a refreshing "STALE · 6 MIN → 7 MIN" never reflows. (`tabular-nums` is not yet used in the shipped CSS — add it on these chips.)
- No Anton hero number in any non-populated state (Anton heroes are populated-`big`-mode only).

---

## 5. Motion (snappy stamp/kick, `<=` 2 primitives, transform/opacity only)

- **Loading sweep:** one `translateX` + `opacity` hard-edged band, ~420ms loop, `cubic-bezier(0.16,1,0.3,1)`. Transform/opacity only; canvas painted once. This is the **only** perpetual loop — the "LOADING" dots are static.
- **State entrance:** when a tile resolves into empty/error/stale, the message block does one `opacity` 0→1 + tiny `translateY(4px)→0` over ~220ms — once, not on scroll.
- **CTA / RETRY / REFRESH hover & focus:** the shipped tile kick — `translate(-3px,-3px)` + shadow deepen (the shipped tile deepens to `15px 15px 0 var(--tealdk)`; chips may instead deepen their own ink offset and, on `:active`, invert to the accent/orange fill with cream type), `cubic-bezier(0.2,1.3,0.3,1)`, ~140ms (`0.14s`, the shipped value). **Exactly one** hover signal. `:focus-visible` ink ring appears **instantly** (no transition on outline/box-shadow).
- No bounce/elastic on the skeleton band; no spinner; no perpetual motion except the single loader sweep. Easing control points stay `<= 1.3` (the shipped overshoot) — never the banned `>1.5` bounce range.
- **`@media (prefers-reduced-motion: reduce)`:** loading sweep `animation: none` (skeleton shows as a static dashed silhouette + still "LOADING" chip + static dots — still legible, still clearly a loader); entrance snaps to final; marble drift handled the shipped way — `svg.pauseAnimations()` **and** the `.marble-drift` CSS animation slowed to `180s`. Data/copy is fully readable before/without any animation.

---

## 6. Click-to-expand behaviour

- A **loading** or **error** tile is **not expandable** (the expand chip is disabled, `aria-disabled`, no `?expand=` deep-link) — there's nothing truthful to enlarge.
- A **populated** or **stale** tile **is** expandable into the existing `EXP` modal (big viz left, boxed-tag numbers right, one ink hero row). For a stale tile, the modal carries the **same "STALE · {age}" chip** in its header and the numbers render real values; missing slots become labelled em-dash tags, never invented figures.
- **Empty** tile: expand chip routes to the CTA action instead (e.g. "+ ADD POSITION"), not an empty modal.

---

## 7. Data → numbers relationship (honesty)

- The component **never fabricates a number.** Empty/loading/error draw **zero data values** (only chrome + worded copy). Stale draws **only the real `data` supplied**. Any absent value within an otherwise-populated render is an em-dash on a labelled ink block ("metric to confirm"), or the tile drops to `empty` — never a placeholder like "+47%" or "99.9%".
- Skeleton ghost marks are **non-quantitative** (dashed, hollow, no tick values attached to them) so a loading chart can't be misread as real numbers.
- The `ariaInsight` summary for populated/stale must be **derived from the real `data`** the chart draws — never a hand-typed figure that could drift from what's plotted.
- True-zero baselines and proportional arcs from the populated draw functions are inherited unchanged in stale mode — geometry stays honest.

---

## 8. Accessibility / functional contract

- Each tile's canvas: `role="img"` + state-specific `aria-label` stating the *situation in words*: loading → `"Equity curve, loading"`; empty → `"Equity curve: no data yet. Add a position to begin."`; error → `"Equity curve failed to load: price feed unavailable. Retry available."`; stale → `"Equity curve, data as of 14:32 — may be out of date. Up 9.5% over 8 weeks."` (key insight + freshness; the figure comes from the real `data`, never invented). Decorative halftone/cluster canvases stay `aria-hidden`. (Shipped collapsed canvases currently have no `role`/`aria-label` — this component adds them.)
- RETRY / CTA / REFRESH: real `<button>`, keyboard-activatable (Enter/Space), `:focus-visible` ring (instant), `>= 44×44` hit area, tooltip/label on hover **and** focus **and** tap — never hover-only.
- Empty/error provide a **text equivalent** (the worded copy is real DOM text, not painted-only), satisfying the screen-reader fallback even though the silhouette is canvas.
- Contrast floors: message/label text `>= 4.5:1` on cream; ghost skeleton marks are a quiet sub-layer (intentionally low-contrast, allowed since they carry no values); RETRY/CTA chips clear `4.5:1`; **stale coloured data marks clear `>= 3:1`** at the chosen dim level (verify after dimming).
- All four states reachable and legible **as a still screenshot** (the shipped verify gate) — motion is bonus.

---

## 9. Anti-slop checklist (must pass)

- [ ] No centred spinner and no generic shimmer rectangle — skeleton is the viz's own silhouette; the sweep band is hard-edged ink-tint, `border-radius: 0`.
- [ ] No blank axes, no JS-broken empty plot — every state is a deliberate stamped panel on cream + halftone.
- [ ] Border-radius 0 on every chip/overlay/tag; hard zero-blur ink offset shadow; no soft/glow shadow anywhere.
- [ ] Ink-on-cream + halftone; accent only on CTA/REFRESH (`<=5%`); orange only on RETRY (warning role).
- [ ] No invented number anywhere; `ariaInsight` derived from real data; stale shows only real data; gaps are labelled em-dashes.
- [ ] Error/stale carry a non-colour cue (drawn `!` glyph / dashed hatch band); stale coloured marks still clear 3:1 after dimming.
- [ ] One loader primitive (the sweep) — LOADING dots are static; transform/opacity only; reduced-motion fallback present (sweep off, SMIL paused + drift→180s).
- [ ] Motion values match the shipped tile: `translate(-3px,-3px)`, shadow → `15px 15px 0 var(--tealdk)`, `cubic-bezier(0.2,1.3,0.3,1)`, `0.14s`. No invented `--dur-*` tokens unless first added to `:root`.
- [ ] Oswald/Space Mono only, roman, `tabular-nums` on numeric chips; both clock and relative stale-age `Intl`-formatted.
- [ ] `role="img"` + worded `aria-label` per state; RETRY/CTA keyboard + touch + `>=44px`, instant focus ring.
- [ ] No card-in-card; reuses the shipped tile, `EXP` modal, marble component, CRT/halftone layers.

**Component API**

```ts
// Reusable across all 7 screens. Wraps the SAME canvas tile as the populated viz;
// `state` only changes what the canvas + status chip render — never the tile silhouette.
// Drop-in replacement for the bare <canvas> currently inside .tl-body in Dashboard.tsx.

type VizKind = 'trend' | 'comparison' | 'proportion' | 'profile' | 'gauge'; // picks skeleton silhouette
type VizStateKind = 'populated' | 'loading' | 'empty' | 'error' | 'stale';

// Same signature as the shipped draw functions: drawValue/drawGauge/... (c, big)
type DrawFn = (c: HTMLCanvasElement, big: boolean) => void;

interface VizStateProps {
  /** Canvas id, e.g. "cv-value" — matches COLLAPSED_VIZ registration. */
  id: string;
  /** Human label for the tile head + aria base, e.g. "Value Over Time". */
  name: string;
  /** Drives skeleton shape + aria phrasing. */
  kind: VizKind;
  /** Current lifecycle state. */
  state: VizStateKind;
  /** The populated/stale renderer — the existing drawValue, drawGauge, etc. */
  draw: DrawFn;
  /** false = collapsed tile, true = expanded modal canvas (#cv-exp). */
  big?: boolean;

  /** Per-screen pigment accent token name, e.g. 'teal' | 'magenta' | 'sky' |
   *  'lime' | 'violet' | 'amber' | 'gold'. Maps to a --accent var on the tile
   *  (must be ADDED to .screen/the tile CSS — not yet shipped).
   *  Used ONLY on empty-CTA + stale-REFRESH chips. */
  accent: string;

  /** EMPTY copy + CTA (worded, viz-specific). */
  empty?: { headline: string; sub?: string; ctaLabel?: string; onCta?: () => void };
  /** ERROR cause + retry. RETRY chip is --orange (warning role), not the accent. */
  error?: { cause: string; detail?: string; onRetry: () => void };
  /** STALE freshness — `asOf` is formatted via Intl.DateTimeFormat AND/OR
   *  Intl.RelativeTimeFormat (clock + relative forms), never hard-coded; the chip
   *  carries tabular-nums. STALE keeps real data; coloured marks must still
   *  clear >=3:1 after the staleness dim (dim fills/nodes, keep line/bars strong). */
  stale?: { asOf: Date; onRefresh?: () => void };

  /** Key-insight summary for aria-label when populated/stale, e.g.
   *  "Up 9.5% over 8 weeks". MUST be derived from the real `data` the chart
   *  draws — never a hand-typed figure that could drift. Required so the canvas
   *  isn't opaque to AT. */
  ariaInsight?: string;

  /** Optional EXP modal key; the expand chip is disabled (aria-disabled, no
   *  ?expand= deep-link) in loading & error states; routes to onCta in empty. */
  expandKey?: string;
  onExpand?: (key: string) => void;

  /** Locale for all Intl.* formatting of the stale-age chip. Defaults to user locale. */
  locale?: string;
}

declare function VizState(props: VizStateProps): JSX.Element;

// Notes:
// - Internally calls fitCanvas(c) + the shared line() helper; reuses each viz's
//   own X/Y/arc geometry (gauge a0=PI/a1=0, donut -PI/2 start) to draw the
//   skeleton in-silhouette. Frame uses the shipped 'rgba(20,17,13,.12)' grid /
//   '.5' ticks; cream body keeps its .halftone under-layer.
// - loading/empty/error draw ZERO data values; stale calls draw(c, big) then
//   overlays the staleness dim (fills/nodes only) + dashed-ink hatch band +
//   "STALE · {Intl-formatted asOf}" chip.
// - Motion matches the shipped tile exactly: hover kick translate(-3px,-3px),
//   shadow -> 15px 15px 0 var(--tealdk), cubic-bezier(0.2,1.3,0.3,1), 0.14s.
//   The loading sweep (~420ms, cubic-bezier(0.16,1,0.3,1)) is the ONLY perpetual
//   loop; "LOADING" dots are static. No --dur-* tokens are assumed — add them to
//   :root first if named tokens are desired.
// - prefers-reduced-motion: loader sweep -> static dashed skeleton + still chip;
//   svg.pauseAnimations() AND .marble-drift slowed to 180s (shipped convention).
// - Every per-state chip/overlay/tag: border-radius 0, hard ink offset shadow only.
// - Renders <canvas role="img" aria-label={stateAwareLabel}> + real-DOM worded copy
//   for empty/error (text equivalent); decorative halftone canvases stay aria-hidden.
```

## Chart slop-test (run on every chart before shipping)

- [ ] No charting library / SVG-path chart shipped untouched? (raw canvas only; SVG reserved for #ntMarble + the one drawn expand-arrow)
- [ ] No primary mark missing its ink-offset stamp? (lines +2px ink shadow / 3-pass; bars & blocks +4-6px ink; nodes ink-square-then-accent; donut wedges ink-stroked)
- [ ] No marble, gradient, or texture over the data plane? (marble = frame/rail/tag ring only; halftone stays under cream below contrast)
- [ ] No rounded corner on any tile/bar/wedge-cap/tag/chip/tooltip? (border-radius:0 everywhere; CRT bezel is the only curve)
- [ ] No soft/blurred/glow shadow anywhere? (hard zero-blur ink offsets only, including tooltip + focus ring)
- [ ] No second bright hue or rainbow categorical palette in one chart? (one accent ≤3-5% + tiny purple benchmark + tiny gain/loss; everything else ink-on-cream)
- [ ] No accent painted on itself? (teal-on-teal active wedge / accent-fill on a gain bar resolves to cream-fill + thick ink stroke, not an invisible accent)
- [ ] No gain/loss signalled by colour alone? (always sign + drawn ▲/▼ triangle + worded label / positional side; survives a CVD emulator)
- [ ] No emoji or font-glyph arrow used as a marker or expand affordance? (drawn canvas path or the Oswald word + one drawn SVG arrow only)
- [ ] No proportional / non-tabular digits on any number? (tabular-nums + fixed decimals; live heroes in Space Mono, Anton heroes static; zero layout shift)
- [ ] No italic on any stat figure, gauge value, title, axis label, or legend? (roman only; emphasis via weight/accent/the boxed tag)
- [ ] No invented number anywhere? (only caller-supplied or honest derivations; missing → em-dash 'metric to confirm' tag, never +47%/99.9%; a bare giant number always carries its worded label)
- [ ] No dishonest geometry? (true-zero/true-baseline, un-truncated axis unless labelled, arc length = value/range, wedge = weight/total*2pi, symmetric +/-max, extrema-preserving down-sample so peak/trough/aria match the drawn line)
- [ ] No loud gridline competing with data? (.12 quiet sub-layer; structural rule .18-.22; grid carries the dashed-ink + halftone-tick beat yet stays subordinate; tick TEXT >=.66 / >=4.5:1, marks >=3:1)
- [ ] No skewX or non-zero --skew? (clip-path parallelogram via --slant tokens; canvas + figure overlay carry NO transform and read level)
- [ ] No motion beyond one transform/opacity entrance? (no per-frame geometry/width/height anim, no animate-on-scroll, no perpetual needle/radar sweep except the single loader sweep; shipped cubic-bezier(0.2,1.3,0.3,1) on the tile kick; no bounce/elastic)
- [ ] No animation without a reduced-motion fallback? (snaps to final state, pauses marble SMIL, drift->180s, full scrub/keyboard still works, still passes as a frozen screenshot)
- [ ] No missing canvas a11y? (role=img + data-derived worded key-insight aria-label on the canvas, role=button on a SEPARATE expander node, visually-hidden <table> mirror, decorative layers aria-hidden)
- [ ] No value hidden behind hover-only? (tooltip on hover AND tap AND focus, focus-delay 0ms / hover ~800ms; every interactive mark >=44x44px with an instant ink focus ring; sortable tables set/update aria-sort; >50 rows virtualized)
- [ ] No hard-coded $/en-US/£/% or string-concat symbol? (all numbers/dates via Intl.* with caller locale + instrument currency)
- [ ] No inline hex/oklch or mid-render token drift? (every colour/font/alpha references a named token; canvas consts mirrored once from the tokens)
- [ ] No card-in-card, fake window/app chrome, or deep nesting around the viz? (one shallow tile, the EXP modal is the only enlargement)
- [ ] No expand modal that breaks the law? (z100 above CRT, viz left / boxed-tag numbers right, decoration on the .frmarble border only, one full-ink hero row, never a striped spreadsheet, ?expand= + Esc/scrim close + focus return)
- [ ] No non-populated state shown as a spinner/broken/blank plot? (skeleton in the viz's own silhouette; empty CTA; error + orange Retry; stale = real dimmed data + hatch + Intl age chip)

## Open gaps / decisions

- Per-screen accent rgba derivations are unspecified beyond Dashboard/Performance: the spec names magenta/sky/violet/amber/gold/lime as the accent but gives no hex for --accent / --accent-dk / the --area-accent gradient / the six --mrb-* per screen. Each must be defined as a token set AND re-verified for the 3:1 mark / 4.5:1 text / CVD floors when it lands (gain/loss are exempt and fixed, but the accent contrast changes per screen) — none of these palettes are proven yet.
- Accent-vs-gain collision is solved per-viz inconsistently: the donut auto-switches to cream-fill+thick-ink when accent is teal-family, the P/L bars use an ink-stroke focal (never accent fill), the value/radar use accent for the line. A non-teal screen whose accent collides with --gain/--loss instead (e.g. Compare=violet near --purple benchmark, or any warm accent near --loss/--orange) has no stated resolution — needs a general 'accent ∈ {gain,loss,purple,orange} hue-family → fallback signal' rule, not just the teal case.
- Live-data / re-quote cadence is unspecified: scrub redraws, the stale chip ticking, and 'live P/L updates' are mentioned, but there is no shared policy for redraw throttling/rAF-coalescing across many tiles, when aria-live announces vs stays off (only the P/L spec pins aria-live=off), or how often the data layer pushes — risks jank or SR spam across a 6-tile Dashboard.
- The reduced-motion CSS currently only covers .tile/.tb-live/.marble-drift (shipped line 1035); the new overlay-entrance, tag transitions, the loader sweep, the value-line draw-on, radar scale-in, and donut/PL entrances must all be ADDED to that block — this is called out per-spec but there is no single consolidated reduced-motion contract, so a screen could ship covering some entrances and not others.
- Font loading race for canvas text: every spec relies on document.fonts.ready + rAF/240ms/380ms re-draws, but with N tiles + sparklines + a modal canvas all redrawing on those passes there's no debounce/coordination — and no fallback if Anton/Space-Mono fail to load (canvas would silently fall back to default sans, the one banned face). A shared font-gate/redraw scheduler is implied but not specified.
- Virtualization + canvas interplay is unaddressed: StatReadout virtualizes >50 rows and PLBars virtualizes >50 positions, but the canvas draws all bars while the DOM hit-layer/table virtualize — the relationship between the drawn (top-N) collapsed canvas, the virtualized modal table, and the >1000-point down-sample (drill-down on zoom) is described separately per viz with no shared windowing helper, risking drift between what's drawn, what's tabbable, and what's in the aria table.
- Touch scrub vs native scroll/expand gesture conflict on the ValueChart scrubLayer (pointer capture across the full inset:0 layer) vs the tile being a click-to-expand target vs page scroll on a touch device is not resolved — needs an explicit gesture-disambiguation rule (e.g. horizontal-intent threshold) so scrubbing doesn't swallow taps-to-expand or block vertical scroll.
- The 'one drawn SVG expand-arrow glyph' is referenced as a single shared asset but never defined (path data, stroke weight, sizing) — each spec bans the unicode/emoji arrow and assumes this glyph exists; it should be authored once in the shared layer so all tiles use the identical stroke voice.
- CRT bulge/curvature interaction with the z100 expand overlay (which sits OUTSIDE the clipped stage, above the CRT) means the modal is NOT under the screen-curve while tiles are — a subtle visual inconsistency (modal reads flat, dashboard reads curved) that is implied by the z-stack but never explicitly accepted or addressed.
