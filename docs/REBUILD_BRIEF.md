# Actuality — Rebuild Brief & Lessons Learned

*The product is now **Actuality**; the first attempt was code-named **NETTRADE** (preserved intact at `…/nettrade-v1-original/`). The working folder is still `~/nettrade` (legacy dir name) — that's fine.*

*A handoff from the first build attempt (paused 2026-07-01) to a fresh Claude session that will RE-PLAN and REBUILD this from a stronger foundation. Read this fully before proposing a new plan. The old code lives at `~/nettrade` — treat it as a reference and a parts bin, not as something to preserve.*

---

## 0. TL;DR for the next session
The **product concept and the entire data/backend layer are solid and worth reusing.** The first attempt hit a wall in the **visual layer** — specifically a whole-screen CRT "barrel curve" (an SVG displacement filter over the entire live UI) that looked great in Chrome previews but **breaks in the real desktop app's webview** (broke click targeting, then made the whole screen flicker/flatten on hover). Repeated UI redesigns and a stack of full-screen effects compounded the fragility until the app became a "brick."

**Your job:** propose a revised plan that (a) keeps the working backend + product concept, (b) picks a bold-but-webview-safe visual direction and *locks it*, and (c) verifies every visual milestone in the **real app**, not just Chrome. The user is a **non-coder** — explain plainly, give click-by-click steps, work in signed-off phases.

---

## 1. The product (unchanged — this part is good)
A **local, free, read-only** desktop "trading station" (Mac-first) for the user + their partner. It connects to their **Trading 212** account(s) and shows a **"Performance-Truth"** view: it separates deposits/withdrawals from **realised vs unrealised** P/L so they can tell when they're actually making or losing money (not just seeing a balance move because they deposited).

**Hard constraints (keep all of these):**
- **Read-only.** Never place trades or move money.
- **API keys ONLY in the macOS Keychain.** Never in code, logs, git, or chat. (The user correctly refuses to paste keys into chat — never ask them to.)
- **£0/month.** Free API tiers only, no card; any paid feed is opt-in and off by default.
- **Built for a non-coder.** Plain English, click-by-click, phased with sign-off gates.

**Confirmed product decisions:** base currency GBP; two-account sharing = **Option A snapshot** (each app holds only its owner's key; exchange small read-only JSON summaries via a shared cloud folder — no key sharing); watchlist uses free delayed/EOD feeds (Twelve Data primary + Alpha Vantage fallback), indicators client-side via `indicatorts`.

---

## 2. What WORKED — reuse this
- **Stack:** Tauri v2 + React 19 + Vite + TypeScript (+ Tailwind), HashRouter. Good choice; keep it.
- **Backend / data layer (this was the solid part — port it largely as-is):**
  - **Keychain:** Rust `keyring` crate with the **`apple-native`** feature (NOT the deprecated Stronghold plugin). Tauri commands `keychain_{set,get,delete,has}_credentials`. Store under the app's bundle id as the service.
  - **DB cache:** `tauri-plugin-sql` (SQLite) with Rust-side migrations.
  - **HTTP:** `tauri-plugin-http`, with the capability **scoped only to the Trading 212 hosts** (avoids CORS and limits surface).
  - **Adapter pattern:** ONE `trading212.ts` module is the only thing that talks to the API — auth header, a shared **rate-limiter** (≥1.2s spacing + 429/Retry-After backoff), and a **defensive parser** (the API is beta; tolerate schema variants, never throw on a missing field).
  - **Money:** store as **integer minor units (pennies)** + **decimal.js** for ratios; round only at display. XIRR = hand-rolled Newton-Raphson with a bisection fallback.
- **Product concept + information design:** the Performance-Truth framing, and the per-screen data design (canvas gauges/charts that click-to-expand into clear numbers) were good and liked.

---

## 3. What WENT WRONG — the wall (avoid this)
**The root failure: a whole-screen CRT "barrel curve" implemented as an SVG displacement filter (`feImage` + `feDisplacementMap`) applied to the entire live, interactive UI.** It demoed beautifully in headless Chrome / Playwright-Chromium, then failed in the actual app:

1. **It broke pointer hit-testing.** SVG filters warp the *painted pixels* but NOT the *clickable geometry*. Near the corners, what you saw was ~30px from what you could click — you had to click to the side of buttons. We patched it with enlarged invisible hit-areas; fragile and never clean.
2. **It dropped on repaint in the real webview (WKWebView).** Any change under the filter — even a menu hover — made the webview drop/recreate the filter's GPU layer for a frame, so the warp vanished and the **whole screen snapped flat → "jumping."** GPU-layer-pinning + removing under-filter animations stopped the drop, but at the cost of other regressions ("fixed what we wanted but broke everything else"). The effect fundamentally fights the platform.
3. **Animations under a full-screen filter re-rasterize every frame → flicker.** An earlier animated "liquid-marble" had to be frozen for the same reason; then page transitions and hover animations all fought the filter too.

**The meta-causes (the user's own insight is right):**
- **Chrome preview ≠ the real app.** The Tauri desktop app renders in **WKWebView** (macOS Safari's engine), which handles SVG filters and GPU compositing differently than Chromium. We verified in Chrome and got a false green for the most platform-sensitive feature in the whole app.
- **Too many UI redesigns.** The look pivoted repeatedly (neon-metal → holographic → comic-collage → "Cream & Pigment"), and each pass piled on more ambitious full-screen effects (marble, CRT curve, tube-power-off page transitions). The churn burned effort and **accreted fragility** until small interactions destabilized the whole screen.
- **Stacking signature effects.** Marble + barrel curve + page transitions + per-frame canvas redraws all competed for the same compositor. Individually cool; together, a brick.

---

## 4. The lessons (bake these into the revised plan)
1. **Verify in the REAL target webview early.** For anything visually ambitious, test in the actual Tauri build (or at least Safari / Playwright-**WebKit**, `npx playwright install webkit`) — not Chrome. Chrome is fine for layout/logic; it lies about SVG filters and GPU compositing. Make "does the real app render this?" a gate, not an afterthought.
2. **Never put SVG filters (especially `feDisplacementMap`) over live, interactive content** in a Tauri/WKWebView app. They break hit-testing and drop on repaint. If you want a curved-screen/CRT vibe, get it from **stable** techniques: a curved *bezel/frame* + vignette around **flat** content, scanline/glow overlays (cheap CSS gradients), subtle border-radius on the screen container — or, if you truly need geometric warp, a **WebGL shader over a static snapshot**, never the live DOM.
3. **Keep the interactive surface free of whole-screen effects.** Put heavy/decorative effects on **isolated, non-interactive, composited layers**. The layer the user clicks should be plain and stable.
4. **Budget visual effects: one robust signature, not a stack.** Each full-screen effect is a liability. Prove each one in the real app *before* adding the next.
5. **Lock a simple, bold, webview-safe visual direction and STOP redesigning.** The comic-collage *aesthetic itself was fine* — heavy condensed type, hard zero-blur offset shadows, halftone, tilts, torn/jagged shapes are all cheap and stable. It was the **screen-warp + stacked effects** that broke, not the style. Pick the look once, lock it, resist re-opening it.
6. **Build the backend first and keep it.** The data layer was the reliable part; start the rebuild there and treat the UI as a separable, simpler layer on top.
7. **Spike risky things in 30 lines in the real app before committing.** "Can the platform even do this smoothly?" is a 10-minute experiment, not a phase.
8. **"Looks fixed" ≠ fixed — verify the real render, in the real environment.** Use objective checks (e.g. `elementFromPoint` for hit-testing; before/after pixel diffs) and run them where it actually ships.

---

## 5. Technical reference (so you don't re-derive it)
**Trading 212 API (confirmed live, 2026):**
- Auth: **HTTP Basic**, header `Authorization: Basic base64(API_KEY:API_SECRET)`. (A raw single-token header returns 401; Basic returns 200. The user has a key+secret already generated, sitting in their macOS Keychain.)
- Base URLs: live `https://live.trading212.com/api/v0`, demo `https://demo.trading212.com/api/v0`.
- Open positions: `GET /equity/positions`, **rate limit 1 req/1s** (pace ≥1.2s, backoff on 429). Response = array of:
  `{ averagePricePaid:number, currentPrice:number, createdAt:string, instrument:{currency,isin,name,ticker}, quantity:number, quantityAvailableForTrading:number, quantityInPies:number, walletImpact:{currency,currentValue,fxImpact,totalCost,unrealizedProfitLoss} }`. Parse defensively (an older flat shape `{ticker,averagePrice,currentPrice,ppl,fxPpl,quantity}` also exists in the wild).
- Account: `GET /equity/account/info` → `{ id, currencyCode }` (user's = GBP). Also `/equity/account/cash`, history endpoints (`/equity/history/{orders,dividends,transactions}`), and a **CSV export** endpoint that is the authoritative source for a first-time full history backfill (the transactions feed is "superficial").
- **Only General Invest & Stocks-&-Shares-ISA accounts expose the API** (not SIPP/CFD). Confirm which account types the user has before promising live data.
- It's **beta** — schemas can change; keep all calls behind the one adapter and code defensively. `trading212-labs/agent-skills` is a useful reference for exact request shapes.

**Keychain scheme used:** service = the bundle id (`com.stillshining.nettrade`), account `nettrade:{accountId}` (single account = `"default"`), key+secret stored together as one JSON value. (A Phase-0 test left a *separate* legacy entry under service `com.nettrade.trading212` with items `apikey`/`apisecret`; the app read it as a fallback. The user already has a working key in their Keychain — design so they don't have to re-enter or paste it.)

**Money:** integer minor units + decimal.js (`new Decimal(n).times(100).round()`); never floats for money.

**Project path gotcha:** real path is `/Users/stillshining/Documents/60-69 Dev/63 Apps & builds/nettrade` (has spaces + `&`); exposed via symlink `~/nettrade`. Not under git. The symlink has broken mid-session before — if `~/nettrade` looks empty, re-link it.

**Run/build:** `npm run dev` → http://localhost:1420 (HashRouter routes like `/#/dashboard`). `npm run build` (tsc+vite). `npm run tauri build` → `.app` + `.dmg` in `src-tauri/target/release/bundle/`. **Build output `.app` ≠ what's in `/Applications`** — keep ONE canonical install or you get duplicate icons + stale-build confusion.

---

## 6. Recommended shape for the revised attempt
- **Keep:** the stack, the backend/data layer, the API facts above, the money approach, the Performance-Truth concept, and the screens' information design.
- **Re-approach the visuals:** keep a bold comic/arcade aesthetic if the user still wants it (it's on-brand and cheap), but **drop the live whole-screen geometric warp**. If a "CRT" feel is wanted, get it from a stable curved bezel + scanlines + vignette over flat content. Add at most one signature motion, proven in the real app.
- **Process:** phase it with **real-app verification gates** (each phase ends with "it works in the actual Tauri build, on the user's Mac"). Lock the visual direction after one round. Backend-first, then a simple UI, then *maybe* one tasteful effect.
- **Reuse from the old repo (`~/nettrade`):** `src/adapters/trading212.ts`, `src-tauri/src/keychain.rs`, the `tauri-plugin-sql` setup + migrations, `src/db/*`, `src/state/usePositions.ts`. Read `docs/HANDOFF.md`, `docs/BUILD_STATE.md`, `docs/DESIGN_PRINCIPLE.md`, `docs/CHART_CRAFT.md` for detail, but feel free to start the UI fresh.

---

## 7. One honest note for the user
Most of the hard, un-fun parts are already solved (secure key storage, the live API, the money maths, the data model). What burned the time was chasing a single spectacular visual effect that the desktop webview can't do reliably — and only finding out late because previews lied. A revised plan that locks a simpler look and proves effects in the real app early will move much faster and won't brick. The concept is good. This is a normal mid-project reset, not a failure.
