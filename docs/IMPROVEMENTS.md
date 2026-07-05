# Actuality — the 40-Improvement Plan

*Drafted 2026-07-05 (post phase-2c). Four-lens mining (functionality / intuitiveness /
look / polish) over the real codebase — every item is grounded in a specific file and
respects the house laws: read-only, honest data, £0/month, anti-brick, the locked
diegetic language. Impact = user-felt value. Effort: S < half day · M ≈ a day · L = multi-day.*

*Status key: ☐ planned · ◐ in progress · ✅ shipped*

---

## A · FUNCTIONALITY & LIVE DATA (12)

**1. ☐ Exact-GBP realised P/L** — HIGH / M
Fills already carry `walletImpact.netValue` (the exact £ cash impact), stored as
`settledValueMinor`. Add a settled-value replay branch to `replayRealisedEvents` so
realised P/L (and TOTAL GAIN) become exact account-currency instead of the documented
instrument-ccy v1 approximation — falling back only when settled values are missing.
The single biggest honesty upgrade, on data already flowing.
*Area: `src/engine/truth.ts`, `types.ts`; fed by `liveHistory.ts` `fillToTrade`.*

**2. ☐ Portfolio reconciliation (fills vs holdings)** — HIGH / M
Replay net quantity per ticker from the 440-fill ledger and compare against the live
T212 positions: per-ticker ✓ / ▲Δ plus an account-level "RECONCILED / N MISMATCHES"
verdict on the Truth deck. Catches an incomplete history sync the moment it happens —
the audit this app exists to earn trust with.
*Area: new `reconcile()` in `truthStore.ts`; surfaced on `Performance.tsx`.*

**3. ☐ Dividend income surface** — HIGH / M
`TruthStore.dividends` is synced but has no home. A RECORDED dividend ledger
(date · ticker · amount · running Σ), per-ticker totals, trailing-12-month income —
plus each holding's upcoming ex/pay dates via the already-shipped free
`fmpStockDividends`. Real income the user has earned, currently invisible.
*Area: new band on `Performance.tsx` or `Journal.tsx`.*

**4. ☐ Truth-deck period selector (1M/3M/6M/YTD/1Y/ALL)** — HIGH / M
`computePeriodTruth` / `filterByPeriod` are written and tested but unwired. A SegToggle
that windows the value/deposits chart AND shows the two-lens PeriodTruth readings
(component lens vs snapshot lens, kept distinct per the engine's discipline).
Pure wiring — the maths already exists.
*Area: `Performance.tsx` + `src/engine/period.ts`.*

**5. ☐ Real Animus 24H card** — HIGH / M
The menu's DASHBOARD preview card still shows "SYNC PENDING" live. Equity snapshots
now exist: compute the honest 24h delta (latest snapshot vs the one ≥24h prior, net of
deposits in the window) — the first honest live number on the app's front door.
Null until two real snapshots exist; never invents.
*Area: `src/animus/daySummary.ts` live branch → `Animus.tsx` card.*

**6. ☐ Editable watchlist with real delayed quotes** — HIGH / L
The watchlist is the hardcoded seed universe. Add persisted add/remove/reorder of
arbitrary symbols, priced via free-tier `fmpBatchQuotes` (delayed, labelled LIVE) +
`fmpProfile` for name/sector; non-quotable symbols stay honestly MODEL. Turns a demo
roster into a genuine personal watch surface.
*Area: `dataEngine.ts` roster persistence + `Watchlist.tsx` UI.*

**7. ☐ Real news wire (RSS + earnings calendar)** — HIGH / L
`NewsEngine.tryLive` has a marked live seam. Fetch per-ticker RSS (Yahoo Finance RSS
et al.) through the Rust http plugin (CORS-free, £0) + the free FMP earnings-calendar
for the ticker's next print. The News screen becomes a real wire with honest CACHED
fallback.
*Area: `news.ts` seam + a Rust fetch path; CSP additions for feed hosts.*

**8. ☐ Price alerts → macOS notifications** — HIGH / M
The Alerts engine already latches ARMED→TRIGGERED; nothing reaches the user outside
the app. Add `tauri-plugin-notification`: a triggered alert posts a native macOS
notification (read-only information, never an action). The station finally "taps you
on the shoulder".
*Area: `alerts.ts` latch transition + Cargo/capabilities.*

**9. ☐ XIRR — money-weighted return** — MEDIUM / M
The deliberately-deferred engine piece. All inputs now exist (dated cash events +
current value). Hand-rolled Newton-Raphson with bisection fallback per the original
plan; shown beside RETURN % with an honest "money-weighted" label.
*Area: new `xirr()` in `src/engine/` + Truth deck readout.*

**10. ☐ Benchmark race: you vs SPY** — MEDIUM / M
"Did I beat just buying the index?" Record a SPY reference point alongside each equity
snapshot (from the live quote — a RECORDED series that grows exactly like the value
curve; no fabricated backfill, since free-tier FMP gates historical EOD). The truth
chart gains an honest benchmark line from the day it's enabled.
*Area: `liveHistory.ts` `recordSnapshot` + migration + chart line.*

**11. ☐ CSV export of the truth ledger** — MEDIUM / S
Fills, dividends, cash events, and the truth split are trapped in the app. One EXPORT
action writing tidy CSVs (Downloads folder via the fs/dialog plugin) — the user's own
data, portable. Local only; nothing leaves the machine.
*Area: serializer over `TruthStore` + a Settings/Orders button.*

**12. ☐ Scanner: free-tier live fundamentals** — MEDIUM / L
`scanFundamentals` has a marked live seam. Wire the free subset (52-week position from
quotes, dividend growth from `fmpStockDividends`, profile beta/mcap) into the VCP /
CANSLIM / BURST / DIVPULL scorers with per-criterion LIVE/MODEL labels — paid-gated
inputs stay honestly MODEL.
*Area: `scan.ts` seam; scorers untouched.*

---

## B · INTUITIVENESS & UX (10)

**13. ☐ Taskbar sync chip + named errors everywhere** — HIGH / S
Sync state lives only in Orders' empty-state — once fills exist, a later 403/429 is
invisible. Add a persistent taskbar segment (`sync: LIVE · 14:32` / `SYNC ERR (403)`)
patched from `TruthStore`, and give Journal/Performance the same cause-naming error
lines Orders already has.
*Area: `Terminal.tsx` taskbar + screens.*

**14. ☐ SYNC NOW button** — HIGH / S
`refreshLive()` exists but no UI calls it — the user can only wait out the 5-minute
poller. A taskbar/keyboard affordance (e.g. `R`) that forces an immediate account +
history re-sync, with the sync chip animating while in flight.
*Area: `Terminal.tsx` → `live.ts refreshLive`.*

**15. ☐ First-run onboarding path** — HIGH / M
With no key, the terminal silently runs the seed-77 world; nothing says why or what to
do. A one-time diegetic overlay: "NO BROKER LINK — this is the SIMULATED world. Seat
your key in ⚙ SETTINGS to go live", with a jump-to-settings keycap.
*Area: `Dashboard.tsx` + `live.ts` no-creds path.*

**16. ☐ Keyboard help overlay** — HIGH / M
The keymap is rich (Q/E, TAB, per-screen verbs) but memorized-only. `?` opens a
diegetic cheat-sheet card (global + current-screen verbs, auto-built from the
registries); extends the existing LSHIFT tooltip pattern.
*Area: `Terminal.tsx` + per-screen hint data.*

**17. ☐ Make the Refresh setting real** — HIGH / S
Settings persists a refresh preference that nothing reads — `startLive(5min)` is
hardcoded. Wire the chips to the poller (MANUAL = no timer + SYNC NOW only). A setting
that lies is an honesty bug.
*Area: `Terminal.tsx:299` + `useSettingsPanel`.*

**18. ☐ Journal notes on real fills, persisted** — HIGH / L
The Journal's promise is annotating YOUR trades, but writable cards exist only for
dry-run session fills — and notes die on quit. Make real broker-history day pages
annotatable (notes + tags) and persist to SQLite (migration v3 `journal_notes`).
*Area: `Journal.tsx` + `state.ts` + `src/db/` + `lib.rs`.*

**19. ☐ Orders ledger: filter / search / date-jump** — MEDIUM / M
440 rows in one flat scroll. Symbol filter (roster-chip row), BUY/SELL toggle, and a
month divider with jump — the terminal-native version of search.
*Area: `Orders.tsx`.*

**20. ☐ Remember last screen + selection** — MEDIUM / M
Every launch boots to the menu and resets the selected symbol. Persist last
screen/selection (localStorage) and offer "RESUME → PERFORMANCE.chart" on the Animus
card rail.
*Area: `state.ts`, `Terminal.tsx`, `Animus.tsx`.*

**21. ☐ Roster: held-marks, pin/reorder, cross-screen flag** — MEDIUM / M
Every roster card looks identical — nothing marks which symbols you actually HOLD
(the data exists: `_liveHeld`). Add a held tick + qty micro-line, drag/keyboard
reorder persisted, and stamp the watch-trigger star visibly even when it fires while
you're on another screen.
*Area: `Roster.tsx` + `state.ts`.*

**22. ☐ Settings truth pass** — MEDIUM / S
Show "last tested HH:MM" on each key slot; merge the duplicate Environment/Data-Mode
toggles into one honest control; put the sub-minute-chips explanation in visible
microcopy instead of a hover title.
*Area: `AnimusSettings.tsx` + `useAnimusVault.ts`.*

---

## C · LOOK & DIEGETIC CRAFT (9)

**23. ☐ Stamped money figures on live sync** — HIGH / S
When a sync lands, the TOTAL GAIN hero and the Dashboard masthead just swap text.
Give real money changes the Persona stamp (translateY + opacity + 1° rotate, ink-burst
underline) — transform/opacity only, reduced-motion aware. Mock ticks keep the quiet
digit flash; the stamp is reserved for REAL money moving.
*Area: `Performance.tsx` truthRow hero, `Dashboard.tsx` masthead, `terminal.css`.*

**24. ☐ Truth chart scrub crosshair** — HIGH / M
The candle deck has a full crosshair + readout; the truth chart has none. Add pointer
scrub: nearest snapshot/deposit point, date + value + deposits + gap readout in the
house mono style, drawn in-canvas.
*Area: `Performance.tsx` `drawTruth`.*

**25. ☐ Click-to-expand the truth chart** — MEDIUM / L
CHART_CRAFT's house law: viz left → clear numbers on expand. Click the truth chart →
focused modal with the full-size curve, period chips, crosshair, and the split table —
the progressive-disclosure moment the deck deserves.
*Area: `Performance.tsx` + modal pattern from the cream-era screens.*

**26. ☐ One-shot chart entrance draw-on** — MEDIUM / M
Per CHART_CRAFT §7: on screen-enter, the value line draws on once (clipped progressive
redraw ≤420ms), then static. Applies to both truth and candle decks; skipped under
reduced motion.
*Area: `Performance.tsx` draw functions + mount effect.*

**27. ☐ Signature per-screen wipes** — MEDIUM / M
Every navigation plays the same vertical CRT collapse. Assign each screen its
spec-mandated directional wipe (deeper = L→R, back = reverse, peer = diagonal) — a
learnable vocabulary, one full-screen effect at a time, CRT suspended during.
*Area: `Terminal.tsx` `runPowerOff` variants.*

**28. ☐ Label the synthetic: index chips + movers** — MEDIUM / S
The masthead is LIVE but SPX/NDX/DJI/VIX chips and the movers rail are synthetic and
unlabelled beside it. Tiny MODEL chips (the established grammar) — or live-ify the
movers from the real roster's real day-% (already available) and label only the
indices.
*Area: `Dashboard.tsx`.*

**29. ☐ Taskbar telemetry: retire the fiction** — MEDIUM / M
"input detected: keyboard" and "battery: 100%" are hardcoded set-dressing sharing a
bar with real telemetry. Replace with real segments: API budget, sync age, snapshot
count, roster size — chrome that earns its pixels.
*Area: `Terminal.tsx` taskbar + `updateTaskbar`.*

**30. ☐ Diegetic empty-state art** — MEDIUM / M
Alerts/Scanner/Orders/Compare zero-states are bare centered sentences. Give each a
small in-fiction plate (ink-stamped "NO CONTACTS ON THE BOARD", corner brackets,
per-screen glyph) — character on the frame, data area stays honest.
*Area: the four screens + `terminal.css`.*

**31. ☐ Sound design pass** — LOW / M
The Animus has synthesized SFX; the terminal has a vol control and one power-off beep.
Add sparse, quiet cues: fill confirm thunk, alert trigger ping, sync-landed tick —
all gated by the existing vol/mute.
*Area: `Terminal.tsx` `beep()` family + trigger sites.*

---

## D · POLISH & RELIABILITY (9)

**32. ☐ SYSTEM diagnostics screen** — HIGH / M
An 11th screen surfacing what we debug by hand in sqlite3: sync cursors + last errors
per stream, row counts + spans, snapshot count, FMP daily budget meter, last refresh
timings. The app explains itself; future issues become self-diagnosable.
*Area: new `System.tsx` + screens registry; reads `sync_meta`/`TruthStore`.*

**33. ☐ Snapshot on quit/hide** — MEDIUM / S
Snapshots only land on the 5-min poller — short sessions record nothing. Record one
honest snapshot on window-hide/quit (same minute-key dedupe, same gating).
*Area: `Terminal.tsx` lifecycle + `recordSnapshot`.*

**34. ☐ As-of freshness stamps** — MEDIUM / S
Nothing says how fresh the money is. Small mono "as of HH:MM" beside the masthead,
Positions header, and Truth deck — flipping to an amber "stale >10m" state when the
poller has failed silently.
*Area: `Dashboard.tsx`, `Positions.tsx`, `Performance.tsx`.*

**35. ☐ DB backup / restore / export** — MEDIUM / M
`nettrade.db` is the only copy of the recorded history + (soon) journal notes. A Data
group in Settings: BACKUP (timestamped copy to a chosen folder), RESTORE, plus the
CSV export (#11). Guard restores behind an explicit confirm.
*Area: `AnimusSettings.tsx` + a small Rust fs command.*

**36. ☐ Money-path tests** — MEDIUM / M
The pure engine is well-tested; the live composition isn't. Extract + test: masthead
total-return composition (ppl+result, fallbacks), snapshot gating (never before
transactions complete), the settled-value replay (#1), and the sync stop/recovery
predicates. The money paths that bit us this phase, pinned forever.
*Area: `live.ts`/`liveHistory.ts` extracted helpers + new tests.*

**37. ☐ Offline airplane audit** — MEDIUM / M
Verify every screen with the network fully down: honest OFFLINE/CACHED labels, last-good
data with as-of stamps, no spinners-forever, no fabricated ticks. Fix what fails; add
the checklist to the verify docs.
*Area: all screens; likely fixes in Dashboard/Performance labels.*

**38. ☐ Pause the engine when hidden** — MEDIUM / S
The mock walk, Coinbase re-poll, and CRT jitter all run while the app is hidden —
wasted battery re-rendering an invisible screen. Gate on `document.hidden`, resume
cleanly on show.
*Area: `dataEngine.ts` tick loop + `Terminal.tsx` jitter.*

**39. ☐ Code-split the Animus from the terminal** — LOW / S
One 298K chunk parses the whole WebGL menu even when deep-launching into a screen.
`React.lazy` the three route roots (keeping the `cssCodeSplit:false` WKWebView guard)
for a faster first paint.
*Area: `App.tsx` + verify in the real .app (the CSS gotcha lives here).*

**40. ☐ Live reduced-motion + always-on-motion audit** — LOW / S
`prefersReduced` is computed once at module load — toggling macOS Reduce Motion
mid-session does nothing. Make it reactive (media-query listener) and audit the
always-on CRT jitter/rolling band against it.
*Area: `bus.ts` + consumers.*

---

## Suggested waves (for sign-off, one at a time)

- **Wave 1 — quick wins, mostly S-effort:** 13, 14, 17, 22, 23, 28, 33, 34, 38 (nine items, ~2 builds)
- **Wave 2 — the truth completed:** 1, 2, 3, 4, 5, 9 (the deck becomes exact, audited, time-windowed, and reaches the front door)
- **Wave 3 — the station goes fully live:** 6, 7, 8, 10, 12 (+32 diagnostics alongside)
- **Wave 4 — craft & keeps:** 16, 15, 18, 19, 20, 21, 24, 25, 26, 27, 29, 30, 31, 35, 36, 37, 39, 40, 11

*Laws apply to every item; anything touching visuals verifies in the REAL `.app`.*
