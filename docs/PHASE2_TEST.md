# Phase 2 — test your real Trading 212 connection (click-by-click)

Phase 2 is built. This is how you confirm it works with your real account. It is
**read-only** — it can only *look at* your positions, never trade or move money.
Your key lives only in your Mac's Keychain.

> **You already have a key in your Keychain.** The app now **auto-reads** it — you
> don't need to paste anything. Skip to **B** and **C-auto** below. (Section A is
> only for someone setting up a key for the first time.) **Never paste your key or
> secret into a Claude chat** — it only ever belongs in your Keychain / the app.

## A. (First-timers only) Get a Trading 212 API key + secret
Only **General Invest** and **Stocks & Shares ISA** accounts have an API (not
SIPP/CFD).
1. Open the **Trading 212** app (or web).
2. Go to **Settings → API (Beta)**.
3. Accept the risk warning, then **Generate** a key.
4. Copy **both** the **API key** and the **API secret**. ⚠️ The **secret is shown
   only once** — paste it somewhere safe for the next steps.

## B. Open Actuality
- Double-click **Actuality.app** at:
  `~/nettrade/src-tauri/target/release/bundle/macos/Actuality.app`
  (or open the installer `…/bundle/dmg/Actuality_0.1.0_aarch64.dmg` and drag it to
  Applications first).
- **First launch only:** macOS may say "unidentified developer" (the app is
  ad-hoc signed). If so: **right-click the app → Open → Open**, or go to
  **System Settings → Privacy & Security** and click **Open Anyway**.

## C-auto. Connect — using the key already in your Keychain (recommended)
The app reads the key you already generated, straight from your Keychain. Nothing
to paste.
1. From the main menu, open **Settings** (or press **7**).
2. On the **Accounts** tab, click **Manage API Keys**.
3. **First time only:** macOS will pop up *"Actuality wants to use your confidential
   information stored in 'apikey' (and 'apisecret') in your keychain."* Click
   **Always Allow** on each (it'll ask for your Mac login password). This is macOS
   confirming the app may read the key you saved earlier — your secret stays on
   your Mac and never appears on screen.
4. The status dot shows **"Key stored in Keychain"** and the positions list fills
   in automatically. Click **Test Connection** to double-check (**"✓ Connected"**).

## C-manual. Connect — typing a key in (alternative)
Only if you want to enter a different/fresh key:
1. Settings → Accounts → **Manage API Keys**.
2. (optional) a **label**; paste **API key** + **API secret**; choose **Live**
   (real money) or **Demo** (practice).
3. **Save to Keychain** (the secret is wiped from the screen the instant it's
   saved), then **Test Connection** → **"✓ Connected"**.

## D. See your real positions
- Below the buttons, the **positions list** fills in with your real open
  holdings: **ticker · quantity · current value · unrealised P/L**, plus a
  "N positions synced / last sync" line.
- Cross-check one or two numbers against the Trading 212 app to confirm.

## If something's off
- **"✕ Unauthorized"** → the key/secret is wrong, or you picked the wrong
  Live/Demo environment. Re-check and re-save.
- **"Rate limited"** → Trading 212 asked us to slow down; wait ~10s and retry.
- **"✕ Network error"** → check your internet.
- **Remove Key** deletes the credential from the Keychain entirely.

## Notes
- Keys are stored **only** in the macOS Keychain, never in the app's files, logs,
  or code. The app reads your existing Phase-0 key (Keychain service
  `com.nettrade.trading212`) and copies it forward to its own location
  (`com.stillshining.nettrade`) on first use — your secret never leaves your Mac.
- **"Remove Key"** deletes the app's own copy but, by design, does **not** delete
  your original Phase-0 Keychain entries (that could destroy your only copy of the
  secret, which Trading 212 showed only once). So after Remove, the key will
  re-appear from that original entry next time. To remove it completely, delete the
  `apikey` / `apisecret` items under `com.nettrade.trading212` in **Keychain
  Access** yourself.
- This proves the connection. **Wiring these live numbers into the Dashboard /
  Positions screens (replacing the mock data) is Phase 4**; the
  **Performance-Truth maths is Phase 3** — both still to come.
