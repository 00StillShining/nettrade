# NETTRADE — Session Handoff / Resume Context

*Single source of truth to resume work in a fresh chat. Read this first, then the linked docs only as needed.*

---

## 1. What NETTRADE is
A **local, free, read-only** desktop "trading station" (Tauri v2 + React 19 + Vite + TS + Tailwind, HashRouter) for the user + partner. It connects to their **Trading 212** account(s) and shows a **"Performance-Truth"** view — separating deposits/withdrawals from realised vs unrealised P/L so they can tell when they're actually making/losing money. Mac-first. Built for a **non-coder** (explain plainly, give click-by-click steps). Hard constraints: **read-only (never place trades)**, **API keys ONLY in the macOS Keychain** (Rust `keyring` crate, never in code/logs/git), **£0/month** (free tiers, no card; paid feeds opt-in & off by default).

## 2. ⚠️ Project location (READ THIS)
- **Real path:** `/Users/stillshining/Documents/60-69 Dev/63 Apps & builds/nettrade`
- Exposed as the convenience symlink **`~/nettrade`** (use this in commands; note the real path has spaces + `&`).
- **Gotcha:** that symlink broke once mid-session (`~/nettrade` became an empty `.vite` stub → tools went blind, dev server dropped). The project was safe in Documents. If `~/nettrade` ever looks empty, re-link:
  ```bash
  rm -rf ~/nettrade && ln -s "/Users/stillshining/Documents/60-69 Dev/63 Apps & builds/nettrade" ~/nettrade
  ```
- NOT under git.

## 3. The initial plan (full file + summary)
**Full approved plan:** `/Users/stillshining/.claude/plans/users-stillshining-library-application-cosmic-yeti.md`

Phased build, sign-off at each gate. Phases:
- **0 Prep** — Rust + Tauri scaffold + Trading 212 key. ✅ done.
- **1 Design** — the look + all screens. ✅ **done (ahead of plan: the UI for ALL screens is built).**
- **2 Skeleton + secure connection** — keychain (`keyring`) + Trading 212 adapter (Basic auth, rate-limiter, SQLite cache) reading live positions. ⬜ **NOT started (next).**
- **3 Performance-Truth engine** — pure, Vitest-tested money maths (realized/unrealized/net-deposits/Total P/L/XIRR/TWR/drawdown); historical import (CSV backfill + incremental). ⬜
- **4 Dashboard + Positions hero**, **5 Watchlist + delayed data** (Twelve Data + Alpha Vantage, `indicatorts`), **6 Compare + Journal + Option A snapshot sharing**, **7 Polish**, **8 Package**. UI for 4/5/6 is already built; their DATA wiring is not.

**Key confirmed facts:** Trading 212 auth = **HTTP Basic base64(key:secret)** (confirmed live), base currency **GBP**, live env `https://live.trading212.com/api/v0`; money stored as **integer minor units + decimal.js**; XIRR = hand-rolled Newton-Raphson + bisection; two-account sharing = **Option A snapshot** (small read-only JSON via a shared cloud folder, no key sharing).

## 4. Current status (2026-06-30)
**The entire UI is built, ported to React, and runs. `npm run build` green.** 8 screens, all routable from the menu:

| Screen | Route | Accent |
|---|---|---|
| Main Menu | `/` | orange |
| Dashboard | `/dashboard` | teal |
| Positions | `/positions` | magenta |
| Watchlist | `/watchlist` | sky `#1FA6F0` |
| Performance | `/performance` | lime `#B4E600` |
| Compare | `/compare` | violet `#7A3CFF` |
| Journal | `/journal` | amber `#F2A416` |
| Settings | `/settings` | gold |

All on **honest MOCK data** — not yet wired to real Trading 212 (that's Phase 2/3, the next big work).

**Recent session work (all done + verified):** shared `src/viz/` extraction; Dashboard chart-craft upgrade; cross-screen nav (BACK pill + NT-logo + keyboard **1–7** jump / **M** menu); flicker fix; conservative polish (real bugs fixed); packaged Mac app; **page transition**; **parallelograms removed → 90° boxes**; **whole-screen CRT barrel curve**; **marble + pulse made static** (so the curve stays smooth); **shared `<Crt/>` overlay on every screen incl. menu**; transition changed to a **CRT turn-OFF → turn-ON**.

**Main-menu wordmark redesign (2026-06-30, user-directed):** the "NET TRADE" title is now ONE LINE (was stacked). **NET** = flat cream-on-orange knockout box in **Anton** (`.titleNet`); **TRADE** = the original 3D chromatic **Nabla** with palette `--nt-orange-ink` set inline (`.titleTrade`). The flat-box-vs-3D contrast is intentional — the user explicitly wanted ONLY TRADE's font kept 3D and NET kept as the box. `.titlewrap` moved to `left:56/top:108`, tilt eased to `-5deg` (a wide one-liner at -7deg pushed TRADE's right end into the barrel-curve top clip; now clears by ~100px at the user's 1512×982 window). Slash accent shortened + nudged left. (An inverse Nabla palette `--nt-cream-orange` was tried for NET then removed — the user preferred the box.)

**Menu hover-jump fix (2026-06-30, verified):** in the running app the menu "jumped" vertically whenever a row was hovered. Cause: `CreamMenu.tsx` rows set themselves active on `onMouseEnter`, and `.row.active .plate` was **6px taller** (padding `9/12` + border `8` vs inactive `7/10` + border `7`) → the flex column reflowed every hover. Fix: equalized the active plate's **vertical** padding + border to the inactive plate (`padding: 7px 34px 10px 70px; border: 7px`) — keeps the orange fill / arrow / bigger shadow / left-kick for emphasis but same height. Verified: all plates 71px, `maxVerticalShiftOnHover: 0`.

**Curve-vs-clicks fix (2026-06-30, verified):** the barrel curve introduced two bugs the user spotted on their machine — (a) the menu title was clipped by the top-left curve, (b) corner nav (NT logo, BACK pill) was un-clickable at its *visual* position because the `#crt-barrel` displacement filter warps painted pixels but NOT pointer hit-testing (~26px gap at the corners). Fixes: menu title `.titlewrap` moved to `left:40px/top:50px` (out of the compression corner); a scoped global hit-area extension in `src/index.css` (`[aria-label="Back to menu"]` ::after, `inset:-26px -34px`) enlarges the *invisible* hit box on the two CORNER controls only (logo = no `<span>`, pill = `<span class="txt">`) — Settings' inline "Back" button (a `<span>` w/o `.txt`, sits beside Apply) is deliberately **excluded** to avoid clobbering its neighbour; the BACK pill's `clip-path` (a no-op rectangle since `--slant-sm:0`) was removed from each screen's `.bbPill` base rule so the ::after isn't clipped. Verified geometrically with `elementFromPoint` at the computed displaced pixel (logo+pill `visualHits:true`, Apply still clickable, tile not clobbered) + a 0.03 pixel-diff on the pill (visually identical).

## 5. Run / build / verify
```bash
cd ~/nettrade
npm run dev          # → http://localhost:1420  (HashRouter: /#/dashboard, /#/positions, …)
npm run build        # tsc && vite build  (keep green)
npm run tauri build  # → src-tauri/target/release/bundle/macos/NETTRADE.app  (run from a GUI Terminal for the .dmg)
cd prototypes && python3 -m http.server 8181   # serve the HTML design mockups
```
**Verifying UI:** dev server + headless Chrome screenshots (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=… --window-size=1680,1050 "http://localhost:1420/#/<route>"`) or the Playwright MCP. **Confirm a visual fix by RE-DIFFING before/after** (PIL `ImageChops.difference` mean) — a low number is proof; "looks fixed" is not. **Headless throttles rAF → can't measure FPS/smoothness; the user's real machine is the perf judge.**

## 6. Tech / key files (all under `~/nettrade/`)
- `src/App.tsx` — router + the **CRT barrel curve** (`<CrtCurve/>` generates the `#crt-barrel` SVG displacement filter; `k`=barrel strength, `scale`=displacement px) + the **turn-off→on page transition** (`AnimatedRoutes` pins `<Routes>` to the old location during the off-phase).
- `src/index.css` — global + the `.crt-swap` transition keyframes (`crt-tube-off` / `crt-tube-on`) + the `.crt-curve` filter host.
- `src/main.tsx` — entry; **NO `<React.StrictMode>`** (it double-mounted canvas effects and flickered — keep it off).
- `src/screens/<Name>.tsx` + `<Name>.module.css` — the 8 screens (self-contained: own draws + EXP config + tokens + layout; import the shared `src/viz/` bits).
- `src/viz/` — shared: `canvas.ts` (fitCanvas/line/triCanvas), `Marble.tsx` (NtMarble/MarbleDefs, **static** turbulence + drift removed), `Crt.tsx` + `Crt.module.css` (the rich CRT overlay), `ExpandModal.tsx` (click-to-expand shell), `vizState.ts` (4 in-frame states), `useScreenNav.ts` (keyboard 1–7/M).
- `src/data/portfolio.ts` — mock data.
- `src-tauri/` — Tauri shell (`tauri.conf.json` — product **NETTRADE**, identifier `com.stillshining.nettrade`, window 1512×982 maximized, **ad-hoc signing** `signingIdentity:"-"`). Built app: `src-tauri/target/release/bundle/macos/NETTRADE.app`; installer `~/nettrade/NETTRADE.dmg` (made via `hdiutil` — the tauri `bundle_dmg.sh` step needs a GUI Terminal/Finder).
- `prototypes/*.html` — the signed-off HTML design mockups (source of truth for each screen's design).
- **Design docs:** `docs/DESIGN_PRINCIPLE.md` (the visual language), `docs/CHART_CRAFT.md` (chart/gauge/informatics craft — canvas-only, ink-stamp, honest, click-to-expand; run its 24-pt slop-test before shipping any chart), `docs/BUILD_STATE.md` (detailed resume notes + per-screen status).
- **Aesthetic skill:** `~/nettrade/.claude/skills/comic-collage-ui/` — load + follow for ANY UI work (per `CLAUDE.md`).

## 7. Design language (LOCKED) — "CREAM & PIGMENT"
Cream/ink base + ONE per-screen pigment accent; bold black ink outlines; hard **zero-blur** offset shadows; halftone; heavy display type (Anton/Bungee/Oswald, **never Inter/system**); data shown as canvas gauges/charts that **click-to-expand → clear numbers on the right, decoration on the border**; per-screen accent **liquid-marble** on borders only (never over data). **Recent changes:** **boxes are 90° RECTANGLES now** (parallelograms removed — `--slant` tokens = 0; small decorative diagonals like dividers/menu shards/`.bgslash` kept); **whole-screen barrel CRT curve**; **CRT turn-off transition**; **marble + pulse dot are STATIC** (keyframes kept, for the curve's sake). `border-radius:0` everywhere except the CRT bezel. Full rules + the per-screen accent map: `docs/DESIGN_PRINCIPLE.md` + `[[nettrade-design-bar]]` memory.

## 8. Gotchas / hard-won lessons
- **Animated SVG filters re-rasterise every frame** (feTurbulence/feDisplacementMap with a transform animating *inside* the filter, or SMIL noise morph) → screen-wide flicker. Fix: static turbulence + drift moved to a **composited transform on `.ntMarble > svg`** + `contain:paint`. **The barrel curve requires NO continuous animation under it** — that's why the marble + pulse were frozen. Diagnose flicker via inter-frame pixel diff (static ≈ 0.02; flashing ≈ 10+).
- The expand modal's `.exp-frame` must have **no clip-path + overflow:visible** (else it slices the title/close tags); modal z-index **100** (above the CRT z90).
- Don't re-add box parallelograms; don't recolour the fixed tokens (`--gain #2FB5A8`, `--loss #C8402F`, `--purple #5D5A86`, creams, `--ink #14110D`, `--orange #ff5a1f` = warning only).
- **Duplicate app icons / "acting weird" = running a STALE `.app`.** `tauri build` always emits `src-tauri/target/release/bundle/macos/NETTRADE.app` (build output) AND the user may have dragged an older copy into `/Applications`; both share bundle id `com.stillshining.nettrade` → two Dock/Launchpad icons, and launching the old one shows old behavior (e.g. pre-Phase-2 API-Keys placeholder). Keep ONE canonical install: after each meaningful build, `rm -rf /Applications/NETTRADE.app && ditto <build-output>.app /Applications/NETTRADE.app`, and tell the user to launch `/Applications/NETTRADE.app` (not the build folder). If a ghost icon lingers: `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain user -domain system` then relaunch Finder/Dock.
- **The barrel filter DROPS on repaint in the real webview (WKWebView), not in Chromium/Playwright-WebKit.** Symptom: hovering a menu item made the whole-screen warp vanish for the repaint → screen snapped flat → "jumping." Root cause: WKWebView drops/recreates the displacement-filter's GPU layer when content under it repaints. **Could NOT reproduce in Playwright-WebKit** (left-region idle-vs-hover diff stayed 0.0 even mid-transition) — it's specific to the real app's Core-Animation compositing, so the USER is the only judge. Fix applied (2026-06-30, awaiting user confirm): (1) **pin the filtered layer to a stable GPU backing** — `.crt-curve { will-change: transform; transform: translateZ(0); backface-visibility: hidden; }` (verified it doesn't REGRESS the warp in WebKit); (2) **removed the `.row` hover `transition`** so the menu doesn't animate (re-rasterize) under the filter (same reason the marble/pulse are frozen). If it still drops: escalate to a blob-URL/asset map (keep data-URL fallback — data-URL is known to render), remove hover transitions on the data screens too, and/or stop the hover from repainting the active plate. Keep a known-good data-URL map — don't risk the warp vanishing entirely on an unverifiable change.
- **SVG displacement filters (the barrel curve) warp PAINTED pixels but NOT pointer hit-testing** — the browser still hit-tests the un-warped layout box, so a corner control's visual drifts ~26px from its clickable box. No per-element CSS transform fixes this (a translate moves pixels AND the hit-box together → the filter re-displaces both). Fixes that work: enlarge the *invisible* hit area (`::after` overlay — but `clip-path` on the element clips the overlay, so drop the clip-path if it's a no-op), or move the control out of the high-displacement corner. **Verify the fix geometrically, not by eye:** compute the displaced pixel with the same barrel math (`disp = 72·nx·r²·0.42·0.5`) and check `document.elementFromPoint(visX,visY)` resolves to the control. Don't blanket-extend hit areas on controls that have interactive neighbours (e.g. Settings' inline Back next to Apply) — scope it to corner controls only.

## 9. Open items / immediate next
1. **CRT treatment — LOCKED (2026-06-30, user approved).** Final values: turn-off transition 300ms + turn-on 360ms (`src/index.css`), barrel `k=0.42`/`scale=72` (`src/App.tsx`), menu CRT as shipped. Curve bugs (title clip + corner-nav click) fixed + verified (see §4). Do not change these without the user.
2. **Mac `.app` REBUILT (2026-06-30 22:43).** `npm run tauri build` clean; `.app` + `.dmg` produced (the dmg step worked headless this run). Captures the locked CRT + the new one-line wordmark. Does NOT include Phase 2 (built after) — rebuild again once Phase 2 lands if a fresh installer is wanted.
3. **Phase 2 — BUILT + REVIEWED + BUILDS GREEN (2026-06-30); awaiting the user's LIVE key test.** Implemented by two Sonnet 5 agents (Rust infra · TS adapter+UI), reviewed by Opus. What's in:
   - **Rust** (`src-tauri/`): `src/keychain.rs` — 4 keyring (apple-native) commands `keychain_{set,get,delete,has}_credentials(accountId,...)` storing key+secret as JSON under service `com.stillshining.nettrade` / account `nettrade:{id}`; **secrets never logged** (errors are kind-only; malformed-entry path uses a static message). `lib.rs` wires `tauri-plugin-sql` (sqlite, migration v1 → tables `position_cache`+`sync_meta` in `sqlite:nettrade.db`) + `tauri-plugin-http`. `capabilities/default.json` adds sql perms + `http:default` **scoped to live/demo.trading212.com only**.
   - **TS** (`src/`): `adapters/trading212.ts` (sole API client — `authHeader`=Basic base64(key:secret), shared rate-limiter ≥1200ms + 429/Retry-After backoff, `fetchPositions`/`testConnection`, **defensive parser** for nested+flat schemas, money→integer **minor units** via decimal.js). `db/index.ts`+`db/positions.ts` (memoized `Database.load`, upsert cache + **drops stale rows not in the latest sync** + `lastSync`). `state/usePositions.ts` (loads creds→fetch→cache→show; cache fallback on error; stale-response guard; never retains secrets). `screens/Settings.tsx` Accounts→"Manage API Keys" now opens a real **KeyVaultModal** (label/key/secret(password)/Live·Demo, Save→keychain then **clears secret from state**, Test Connection, Remove) + **PositionsReadout** plain list (ticker·qty·value·P/L from minor units). On-brand CREAM & PIGMENT (ink borders, hard offsets, no rounding/blur).
   - **Verified:** `cargo check` + `npm run build` both green; 4 invoke names match the Rust commands; secrets-not-logged grep clean. **NOT yet verified live** (needs the user's real T212 key — only **General Invest / S&S ISA** accounts expose the API, not SIPP/CFD). Account id used = `"default"` (single account; multi-account is later).
   - **Account types:** confirm both of the user's account types are API-capable before the live test.
   - **Legacy keychain auto-read (2026-06-30):** the user already has a key in the Keychain from Phase 0 (service `com.nettrade.trading212`, items `apikey`+`apisecret`) and (correctly) won't paste it into chat. `keychain.rs` now **reads that legacy entry as a fallback** (only for accountId `"default"`) and **migrates it** into the new location on first read — so the app auto-uses the existing key, nothing to paste. Read-only/non-destructive: `delete` removes only the app's own copy, NOT the legacy entry (deleting it could destroy the user's only copy of the once-shown secret) → after "Remove Key" the key re-appears from legacy until the user deletes it in Keychain Access. First launch shows a macOS "Always Allow" prompt to read the legacy items. **.app rebuilt 23:11 with this.** Verified `cargo check` green; not yet runtime-tested live (user's key).
   **Next:** user runs the rebuilt `.app` → Settings → API Keys → click **Always Allow** on the keychain prompt → positions auto-load (no pasting). See `docs/PHASE2_TEST.md`. Then **Phase 3 = Performance-Truth engine** (data model + CSV backfill + pure unit-tested money maths).

## 10. Memory files (auto-load each session; pointers)
`/Users/stillshining/.claude/projects/-Users-stillshining/memory/` — `nettrade-project.md`, `nettrade-design-bar.md`, `nettrade-chart-craft.md`, `work-efficiency-visual-bugs.md`, `machine-no-node.md`.
