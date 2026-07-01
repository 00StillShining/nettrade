---
name: actuality-ui
description: >-
  The single source of truth for Actuality's interface — the "dark cinematic
  diegetic instrument" design language (Assassin's Creed "Animus" menu + Dispatch
  "SDN" data screens + Persona 5 transitions) AND its usability doctrine (function
  married to form; information-dense but calm; better use of space than Dispatch;
  a safe baked CRT curve). USE THIS SKILL for ANY Actuality interface work — a
  screen, component, layout, chart, gauge, transition, restyle, or design review,
  even a tiny tweak — and BEFORE styling anything, to lay out a screen's
  information architecture. Also use it whenever generated UI looks flat,
  decorative-but-unusable, "too SaaS", or when a layout feels cramped, aimless, or
  hard to scan. It supersedes the old comic-collage-ui skill.
---

# Actuality UI — the dark cinematic diegetic instrument

Actuality is a local, read-only "trading station" that tells the user the *truth*
about their Trading 212 performance (deposits/withdrawals vs realised vs
unrealised P/L). The interface is the product: it should feel like **looking into
a machine that reconstructs that truth** — cinematic, atmospheric, diegetic — and
at the same time be **ruthlessly clear and usable.** Both, always. A beautiful
screen you can't read has failed; a clear screen with no soul has also failed.

**How to use this skill:** design **function first, then dress it** (§1–2). Then
apply the look (§3–6) and the anti-brick technical laws (§7). Verify against §8 in
the *real compiled app*. For full depth, read the two companion docs — they are
the long-form of this skill:
- `docs/VISUAL_DIRECTION.md` — the complete look (exact hexes, per-screen spec).
- `docs/RUNTIME_AND_STACK.md` — the engineering plan + why certain things are banned.
- `docs/SCREEN_PATTERNS.md` — **LOCKED data-screen laws + cream-paper skin recipe** (signed off on the Dashboard, apply to EVERY data screen): fill the space (no aimless deadspace); future-proof via internal-scroll + a viewport-locked full-height flex chain; honest data only; keep CRT top/bottom edges legible; the MOCK dev workflow — AND (§7) the concrete cream-paper panel recipe (`--paper` fill + ~3px `--ink` outline + baked static paper-grain data-URI + solid-colour header ribbon, framed by dark deadspace), the disciplined **ribbon colour palette** (amber hero/allocation · teal main/holdings · green gainers · red losers · dark-teal `--ink-trace` summary — AA-checked, never rainbow), P/L-on-cream colours (`--gain-ink`/`--loss`), honest canvas radar ("Portfolio Shape", olive `--radar-max`), and rail sizing (fixed panels + one min-height flex panel).
- `references/` — the actual reference screenshots (AC / Dispatch / Persona / Nier
  / Pragmata / Concord / Cyberpunk). **Study these before designing a screen.**

---

## 1. FUNCTION FIRST — the usability doctrine (this is load-bearing)

The last Actuality looked busy but *laid out poorly* — everything the same weight,
space used aimlessly, no clear answer to "so am I making money?". That is the
failure this section exists to prevent. Read it as seriously as the look.

**The prime directive: every screen answers ONE question, fast.** Decide the
question before you place a pixel. Dashboard → "am I actually up or down, really?"
Positions → "what do I hold and how's each doing?" Performance → "how have I done
over time?". The screen's job is to answer its question in **under ~2 seconds**,
then let the user go deeper on demand. Design the answer first; decorate second.

**Three weights, never flat.** Give every screen a clear hierarchy:
1. **Hero** — the one answer, big and calm, unmissable (e.g. the Performance-Truth
   split). One per screen.
2. **Supporting** — the structured detail that backs the hero (tables, key/value
   dossiers, small charts), scannable, tighter, quieter.
3. **Chrome** — telemetry, status, nav. Peripheral, monospace, low-contrast.
If everything is the same size and weight, the eye has nowhere to land — that was
the old "meh layout." Make the hero win.

**Use of space — beat Dispatch by being dense where it counts, calm where it
doesn't.** Dispatch is a *game* UI: airy, decorative, few data points, lots of
bezel deadspace — atmosphere is its whole job. Actuality has *dense real data*, so:
- Keep Dispatch's **identity** (the bezel, paper panels, telemetry chrome, roster
  cards) but **shrink decorative deadspace** — the frame gives character; the
  interior must earn its area with information.
- Tile the working area on a **disciplined grid** so panels pack efficiently
  instead of floating. Reserve Dispatch-style *generosity* only for the ONE hero.
- Prefer **structured density**: tight key/value dossiers, small-multiples,
  sparklines, compact tables with tabular figures — a trader wants to see more at
  once than a game shows. Density is fine when it's *organized*; clutter is
  density that isn't.
- Concretely: where Dispatch fills a screen with one giant mission card,
  Actuality's Dashboard fits the Performance-Truth split **plus** a positions
  summary **plus** sparklines in the same footprint — same look, more answered.

**Progressive disclosure is how you get density without clutter.** Show the
scannable summary; reveal full detail on demand (the click-to-expand chart law in
`docs/CHART_CRAFT.md`: viz left → clear numbers on expand, decoration on the
border). Never dump everything at full detail at once.

**Consistency = learnability.** Same thing, same place, every time: the hero
answer top/center; status bar bottom; nav consistent; roster cards identical in
structure; numbers right-aligned with tabular figures and aligned decimals. The
user should learn the layout once and never hunt again.

**Honest data is a usability rule, not just ethics.** Numbers stay calm and
legible; loud motion is for *navigation only*, never for a routine tick. Color
*carries meaning* (gain/loss) and is never spent on decoration — and gain/loss is
shown by **sign + shape (▲/▼) + position**, not color alone (accessible + honest).
Reserve color so that when the user sees red, it *means* something.

**Make interactive things obviously interactive.** The diegetic style must never
hide affordances: the AC menu selection is unmistakable; SDN cards read as
selectable; buttons look pressable and are big enough to hit easily. Give every
action clear feedback.

**The "does it make sense?" test — run it before shipping any screen.** Could a
new user, with no explanation, (a) say what this screen is *for*, (b) find its
primary answer, and (c) know what they can *do* here — within a few seconds? If
not, the layout failed, however gorgeous it looks. Fix the IA, then re-dress.

---

## 2. Layout method — content architecture before decoration

Design in this order (reversing it is how you get pretty-but-aimless screens):
1. **List the content + actions** for the screen (what data, what the user does).
2. **Rank it** into hero / supporting / chrome (§1).
3. **Block out a grid** — a base spacing scale (e.g. an 8px rhythm); every panel,
   gap, and margin snaps to it. Deadspace must be *intentional* (breathing around
   the hero), never leftover.
4. **Place by importance + reading order** — primary answer where the eye lands
   first (top-center-ish), supporting below/beside, chrome to the edges.
5. **Only now** wrap it in the diegetic frame (§5) and apply the look (§3–4).

Alignment, a consistent grid, and tabular numerics do more for "looks
professional" than any effect. Tilt/energy is for accents on the *frame*, not for
the data grid — the working area stays aligned and calm.

---

## 3. The look — palette, type, depth (summary; full hexes in VISUAL_DIRECTION.md)

**DNA:** a dark cinematic frame with *real* depth, holding two diegetic surfaces —
the **Animus** menu (3D data-strata, near-monochrome + one blood-red selection)
and the **SDN** data screens (warm cream comic-paper panels in a CRT bezel). One
accent per world: **red** in the Animus/dark world, **amber** (`#e8842a`) in the
paper/SDN world; amber is the shared through-line that makes them feel like one
product. Never rainbow — restraint is load-bearing.

**Palette anchors** (see VISUAL_DIRECTION §1 for the whole set):
- Dark frame: `--ink-void #0d1117`, `--ink-base #161b26`, CRT bezel
  `#0d1a1a→#141f1f`, hairline strokes `#ffffff14`, ghost titles `#39435a`.
- Animus: pale void `#e8e6e2`, bone wafers `#dcdad4`, the one red `#b01f1f→#c0332b`.
- SDN paper: cream `#ece2ce`, warm ink `#2b241c` (~3px outlines, not pure black),
  amber `#e8842a`, secondary teal `#2a9d9d`, radar olive/green polygons.
- P/L: gains = restrained green wash (never neon), losses = `#c0332b`; cash-flow
  neutral ink so the eye reads *truth*, not noise.

**Type — three tiers, each doing a job** (this alone sells "real device"):
condensed display (Oswald/Bebas class, ALL-CAPS chrome + titles), humanist body
(in-world written content: journal, dossiers, key/value), and **monospace**
(Space Mono) for ALL telemetry/status/timestamps — mono is the shorthand for
"machine-generated." Never Inter/system at default weight. Keep data type calm and
legible; theatrics live in navigation, not numbers.

**Depth — real, never a live whole-screen filter.** USE (all GPU-safe):
gradient+vignette backdrops, translucent glass over a *pre-blurred static* asset,
rim-light via box-shadow/sprite, bloom via layered radial gradients / blurred PNG,
`transform`+`opacity` parallax (≤5 layers), `filter:blur` on *inert* background
layers only, static grain/scanline PNG via `mix-blend-mode`, and real WebGL
(react-three-fiber) as its own layer for the Animus menu + transitions.

---

## 4. Motion — Persona 5, but only three properties animate

Animate **only `transform`, `opacity`, `clip-path`.** Never animate
`width/height/top/left/margin` or `box-shadow`/`filter` blur per frame (reflow +
re-rasterize = jank/brick). Motion is functional: guide attention, smooth cuts,
telegraph state.
- **Signature directional wipes** — assign each of the 7 screens one consistent
  wipe (deeper = L→R `clip-path: inset()` + `scale`; back = reverse; peer moves =
  diagonal). A learnable vocabulary, not random flash.
- **Stamped type / figures** — words/figures place in like physical cutouts
  (`translateY`+`opacity`+slight `rotate`, staggered 30–60ms); new
  Performance-Truth numbers "stamp" onto the paper with a subtle ink-burst.
- **Speed-differentiated layers** — background slow/static, foreground fast; two
  `transform`-only layers = depth for free (the most reproducible P5 feel).
- **Transition budget = ONE full-screen effect.** During a transition: suspend the
  CRT, freeze the data DOM, run the whole thing in the single canvas layer, no
  concurrent DOM layout animation. Stacking effects is exactly what bricked v1.
- Easing ~400–600ms ease-out-expo for wipes; idle motion slow and restrained.

---

## 5. The frame + per-screen patterns (full spec: VISUAL_DIRECTION.md §5)

Every screen sits on the **dark cinematic frame** (near-black field, soft light
pool, faint 15–20° facet lines, vignette, *static* grain). The frame never
changes; the surface inside does.
- **MENU = Animus** — WebGL 3D strata, 7 wafer-stacks receding in perspective,
  real DoF, one red selection that travels the stack, labels as *projected 2D
  overlay* (never 3D-baked text), a frosted HUD context bar in front.
- **DATA screens = SDN terminal** — cream paper panels in a teal-black CRT bezel,
  ink outlines, solid-color header ribbons, radar/pentagon charts, roster cards
  with status ribbons, top wordmark + telemetry ticker, persistent bottom mono
  status bar (last-synced · rate-limit · account · live/demo · connection). Panels
  never touch the bezel — dark deadspace frames them ("card slotted into a
  scanner"). Per-screen roles: Dashboard = mission-briefing hero (the Truth
  split + health radar); Positions/Watchlist = roster-card strips; Performance =
  dossier (equity splash + bold-label/value pairs); Compare = side-by-side radars;
  Journal = the calm written-paper surface; Settings = control-panel dossier.

### The CRT curve — you keep it, done the SAFE way
The CRT bezel/curve/scanlines are part of the identity (it's where the whole idea
came from) — but the thing that bricked v1 was a **live whole-screen displacement
filter that re-rasterized on every repaint.** So implement the CRT as a **baked,
static, inert asset**: a bezel/vignette/scanline PNG (or baked into the WebGL
layer's own shader), on its own layer, `pointer-events:none`, and **suspended
during transitions**. It reads as a curved tube monitor without ever
re-compositing over live content. Curve stays; brick doesn't. This is a law.

---

## 6. Diegetic character (don't lose the soul)

The instrument has a face and a voice: telemetry tickers, corner brackets,
environmental readouts (market open/closed, currency, last tick), comic-illustrated
ticker glyphs/portraits, the "SDN"-style wordmark. This is what keeps it from
reading like a SaaS dashboard. But character lives on the *frame and chrome* — the
data itself stays clean (§1). Decoration that costs legibility is cut.

---

## 7. Technical laws (the anti-brick rules — never violate; see RUNTIME_AND_STACK.md)
1. **Verify in the compiled `.app`, never a Chrome/Playwright preview.** The
   preview lied last time — effects stable in Chromium broke in the real WKWebView.
   Measure smoothness with the **inter-frame pixel-diff** (static ≈0.02, jank ≈10),
   not an FPS counter (it misreads pacing).
2. **No `backdrop-filter`, no whole-screen live SVG/CSS filter over live content.**
   (The v1 brick.) CRT + glass are baked/static/inert.
3. **One persistent WebGL context**, reused app-wide; never mount/unmount per
   route. Pool/cap canvas-2D contexts.
4. **No camera-tracked interactive DOM** (`drei <Html>`) — it re-creates the
   visual-vs-hit-test drift bug (visuals off from click targets). In-scene
   text/lines for labels; flat DOM panels otherwise.
5. WebGL (react-three-fiber) layered into the existing **Tauri + React** app is the
   runtime — WebGL is fine; it was CSS/SVG *filters* that broke. Don't leave Tauri
   unless the Phase-0 spike fails (it would break the working Trading 212 backend).
6. Cap `pixelRatio` ~1.5, `frameloop="demand"`, additive blending, minimal
   post-passes — look-driven, required regardless.

---

## 8. Verify checklist — run before declaring a screen done
Look at the **real compiled `.app`** on the Mac and check all three:

**Function (the part v1 failed):**
- Can a cold user name what the screen is *for*, find its primary answer, and know
  what they can do — in a few seconds? (the "does it make sense?" test)
- Is there ONE clear hero, or is everything the same weight?
- Is the working area dense-but-organized (not airy-and-aimless, not cluttered)?
- Numbers legible + tabular + aligned; gain/loss shown by sign+shape, not color alone?
- Is deadspace intentional (breathing the hero), or just leftover?

**Look:**
- Reads as a diegetic instrument, not a SaaS app? Depth *real* (3D/gradient/parallax),
  not a live whole-screen filter? One accent per world (red/Animus, amber/SDN)?
- CRT is baked/inert, not a live filter? Type = condensed + humanist + mono, never Inter?

**Technical:**
- Smooth in the real `.app` by pixel-diff (esp. the transition frame)? One WebGL
  context? No `backdrop-filter`/live whole-screen filters? No camera-tracked
  interactive DOM?

If any answer is wrong, fix it and re-check in the real app. "Looks fixed" in a
browser preview is not fixed.
