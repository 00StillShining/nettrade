# Actuality — a dark-cinematic Trading 212 "trading station"

Actuality is a **local, free (£0/month), read-only** desktop app (Tauri v2 + React
19 + Vite + TS, Mac-first) that connects to Trading 212 and shows a
**"Performance-Truth"** view — separating deposits/withdrawals from realised vs
unrealised P/L so the user can tell when they're *actually* making money. It is
**built for and directed by a non-coder** — explain plainly, give click-by-click
steps, work in signed-off phases, never place trades or move money, keep keys only
in the macOS Keychain.

**The interface is the product.** The look *and* the usability are the deliverable
— not generic functional UI, and not decoration that forgets function.

## The golden rule
For **any** UI work — a screen, component, chart, gauge, transition, layout,
restyle, or even a small tweak — **load and follow the `actuality-ui` skill** in
`.claude/skills/`. It is the single source of truth for the design language *and*
the usability doctrine. Design **function first, then dress it.** Don't freestyle.

Full detail behind the skill:
- `docs/VISUAL_DIRECTION.md` — the complete look (exact palette, per-screen spec).
- `docs/RUNTIME_AND_STACK.md` — the engineering plan + what's banned and why.
- `docs/REBUILD_BRIEF.md` — the postmortem + lessons from the first attempt.
- `references/` — the reference screenshots (AC "Animus" / Dispatch "SDN" / Persona 5 / Nier / Pragmata / Concord / Cyberpunk). Study these before designing.

## The direction (one line)
A **dark cinematic diegetic instrument**: an Assassin's Creed *Animus* 3D-strata
menu, Dispatch *SDN* cream-paper data screens, Persona 5 kinetic transitions —
with **usability co-equal to the look** (one clear hero per screen, dense-but-calm,
better use of space than Dispatch, honest data).

## Always-on guardrails (apply even without re-reading the skill)
- **Function first.** Every screen answers ONE question fast; give it one clear
  hero (not everything the same weight); dense-but-organized, never flat/aimless.
  Run the "does it make sense?" test before shipping. Beat Dispatch's use of space
  by being *denser where it counts, calmer where it doesn't*.
- **Depth is real, never a live whole-screen filter.** Gradient/vignette, glass
  over a *pre-blurred static* asset, `transform`/`opacity` parallax, real WebGL
  (react-three-fiber) for the menu. **NO `backdrop-filter`; NO whole-screen live
  SVG/CSS filter over live content** — that (a displacement "CRT curve") bricked
  the last build and broke click targeting.
- **The CRT curve stays — but BAKED/static/inert** (a PNG or in the WebGL shader,
  `pointer-events:none`, suspended during transitions). Never a live filter.
- **Animate only `transform`, `opacity`, `clip-path`.** One full-screen effect per
  transition (suspend the CRT + freeze the data DOM during it). One persistent
  WebGL context; no camera-tracked interactive DOM (`drei <Html>`).
- **One accent per world** — red = Animus/dark, amber = SDN/paper. Color carries
  meaning: gain/loss by sign + shape (▲/▼) + position, not color alone. Type =
  condensed display + humanist body + Space Mono telemetry; never Inter/system at
  default weight.

## Verify before declaring done
- **Verify in the REAL compiled `.app` on the Mac, never a Chrome/Playwright
  preview** — the preview *lied* last time (effects stable in Chromium broke in the
  real WKWebView). Measure smoothness with the **inter-frame pixel-diff** (static
  ≈0.02, jank ≈10), not an FPS counter (it misreads pacing).
- Run the skill's §8 checklist — function, look, AND technical — and fix in the
  real app. "Looks fixed" in a browser preview is not fixed.

## Stack / where things live
- Tauri v2 + React 19 + Vite + TS; a **react-three-fiber (WebGL)** layer for the
  3D menu + transitions is the planned addition (WebGL is fine — it was CSS/SVG
  *filters* that broke, not WebGL). **No off-the-shelf UI kit** (shadcn/MUI/Chakra
  read "SaaS" — build from scratch).
- Backend to REUSE (proven, untouched): `src/adapters/trading212.ts` (Basic auth,
  rate-limiter, defensive parser, minor-units), `src-tauri/src/keychain.rs`
  (`keyring`), `tauri-plugin-sql` + `src/db/`.
- Run: `npm run dev` (→ http://localhost:1420, HashRouter); `npm run build`;
  `npm run tauri build` → the real `.app` (the only honest verification surface).
- Fonts: a condensed display face (Oswald / Bebas class), a humanist body face,
  and Space Mono (telemetry). Load via Google Fonts or local `@font-face`.
