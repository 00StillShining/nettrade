// Keychain-backed storage for Trading 212 API credentials.
//
// SECURITY: credentials are persisted ONLY via the macOS Keychain (through the
// `keyring` crate's apple-native backend). Never write the api_key / api_secret
// to disk, logs, stdout, or error strings. Error messages returned to the
// frontend must only ever describe the *kind* of failure, never the secret
// value itself.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

const SERVICE: &str = "com.stillshining.nettrade";

// Once-per-launch guards for the on-read ACL migration below (avoids rewriting
// the keychain item on every read).
static MIGRATED_CREDS: AtomicBool = AtomicBool::new(false);
static MIGRATED_MD: AtomicBool = AtomicBool::new(false);

// Phase-0 (pre-Phase-2) stored the credential as TWO separate keychain items
// under a different service. We READ these as a fallback so a user who already
// generated a key doesn't have to re-enter it. This is strictly read-only and
// non-destructive — we never write to or delete the legacy entries.
const LEGACY_SERVICE: &str = "com.nettrade.trading212";
const LEGACY_ACCOUNT_KEY: &str = "apikey";
const LEGACY_ACCOUNT_SECRET: &str = "apisecret";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub api_key: String,
    pub api_secret: String,
}

fn entry_for(account_id: &str) -> Result<Entry, String> {
    let username = format!("nettrade:{account_id}");
    Entry::new(SERVICE, &username).map_err(|e| format!("keychain error: {e}"))
}

/// Reads the Phase-0 credential (separate `apikey` + `apisecret` items under the
/// legacy service) for the primary account. Returns `Ok(None)` unless BOTH items
/// exist. Read-only; never logs the values. Only the `"default"` account maps to
/// the legacy (single-account) location.
fn read_legacy(account_id: &str) -> Result<Option<Credentials>, String> {
    if account_id != "default" {
        return Ok(None);
    }
    let read = |acct: &str| -> Result<Option<String>, String> {
        let entry = Entry::new(LEGACY_SERVICE, acct).map_err(|e| format!("keychain error: {e}"))?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keychain error: {e}")),
        }
    };
    match (read(LEGACY_ACCOUNT_KEY)?, read(LEGACY_ACCOUNT_SECRET)?) {
        (Some(api_key), Some(api_secret)) => Ok(Some(Credentials { api_key, api_secret })),
        _ => Ok(None),
    }
}

#[tauri::command]
pub fn keychain_set_credentials(
    account_id: String,
    api_key: String,
    api_secret: String,
) -> Result<(), String> {
    let creds = Credentials { api_key, api_secret };
    let payload = serde_json::to_string(&creds).map_err(|e| format!("keychain error: {e}"))?;
    // Write with the trusted-app ACL (not keyring's set_password): a self-signed
    // app has no Team ID, so "Always Allow" can never persist on a plain item —
    // the explicit ACL is what makes our own reads silent across rebuilds.
    let username = format!("nettrade:{account_id}");
    crate::keychain_bio::acl_set(&username, &payload)
}

#[tauri::command]
pub fn keychain_get_credentials(account_id: String) -> Result<Option<Credentials>, String> {
    // Existence first (attribute-only, no prompt): if nothing is seated anywhere,
    // answer None WITHOUT running the Touch ID gate — no sheet for a missing key.
    let username = format!("nettrade:{account_id}");
    let here = crate::keychain_bio::file_item_exists(SERVICE, &username);
    let legacy = account_id == "default"
        && crate::keychain_bio::file_item_exists(LEGACY_SERVICE, LEGACY_ACCOUNT_KEY)
        && crate::keychain_bio::file_item_exists(LEGACY_SERVICE, LEGACY_ACCOUNT_SECRET);
    if !here && !legacy {
        return Ok(None);
    }
    // THE gate: when Touch ID is enabled, no secret leaves this process until one
    // fingerprint (or the Mac password fallback) passes this launch.
    crate::keychain_bio::ensure_gate()?;
    let entry = entry_for(&account_id)?;
    match entry.get_password() {
        Ok(payload) => {
            // Static message on parse failure: never format the serde error, which
            // could carry fragments of the stored payload (the secret).
            let creds: Credentials = serde_json::from_str(&payload)
                .map_err(|_| "keychain error: stored credential is malformed".to_string())?;
            // ON-READ MIGRATION (once per launch): rewrite the item with the
            // trusted-app ACL so this app's future reads never password-prompt —
            // this read already passed the old ACL, so it costs nothing extra.
            if account_id == "default" && !MIGRATED_CREDS.swap(true, Ordering::AcqRel) {
                let _ = crate::keychain_bio::acl_set(&username, &payload); // best-effort
            }
            Ok(Some(creds))
        }
        // No entry in the current location — fall back to the Phase-0 location
        // and migrate it forward (onto the trusted-app ACL) so we don't re-read
        // it on every launch. The legacy entries are left untouched.
        Err(keyring::Error::NoEntry) => match read_legacy(&account_id)? {
            Some(creds) => {
                if let Ok(payload) = serde_json::to_string(&creds) {
                    let _ = crate::keychain_bio::acl_set(&username, &payload); // best-effort migrate
                }
                Ok(Some(creds))
            }
            None => Ok(None),
        },
        Err(e) => Err(format!("keychain error: {e}")),
    }
}

#[tauri::command]
pub fn keychain_delete_credentials(account_id: String) -> Result<(), String> {
    let entry = entry_for(&account_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain error: {e}")),
    }
}

#[tauri::command]
pub fn keychain_has_credentials(account_id: String) -> Result<bool, String> {
    // PROMPT-FREE seat-check: attribute-only existence queries, never a secret
    // read (get_password hits the ACL → a password prompt just for OPENING
    // Settings). Counts all three locations: current, Phase-0 legacy, and the
    // Touch ID (biometric) store.
    let username = format!("nettrade:{account_id}");
    if crate::keychain_bio::file_item_exists(SERVICE, &username) {
        return Ok(true);
    }
    Ok(account_id == "default"
        && crate::keychain_bio::file_item_exists(LEGACY_SERVICE, LEGACY_ACCOUNT_KEY)
        && crate::keychain_bio::file_item_exists(LEGACY_SERVICE, LEGACY_ACCOUNT_SECRET))
}

// ============================================================================
// MARKET-DATA KEY (Financial Modeling Prep)
//
// A SECOND, independent secret: the market-data provider's single API key
// (Trading 212 uses a key+secret pair above; FMP is one opaque token). Stored
// under the SAME service but a DISTINCT account so it never collides with the
// broker credential. Same discipline: the key is NEVER logged, written to disk
// outside the Keychain, or echoed into an error string.
// ============================================================================

const MARKETDATA_ACCOUNT: &str = "marketdata:fmp";

fn marketdata_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, MARKETDATA_ACCOUNT).map_err(|e| format!("keychain error: {e}"))
}

#[tauri::command]
pub fn keychain_set_marketdata_key(key: String) -> Result<(), String> {
    // Reject an empty key up front rather than seating a blank secret that would
    // then read back as "present". Callers delete to clear, not set to "".
    if key.trim().is_empty() {
        return Err("keychain error: refusing to store an empty market-data key".to_string());
    }
    // Trusted-app ACL write — see keychain_set_credentials for why.
    crate::keychain_bio::acl_set(MARKETDATA_ACCOUNT, &key)
}

#[tauri::command]
pub fn keychain_get_marketdata_key() -> Result<Option<String>, String> {
    // Existence first (no prompt), then the Touch ID gate, then the read.
    if !crate::keychain_bio::file_item_exists(SERVICE, MARKETDATA_ACCOUNT) {
        return Ok(None);
    }
    crate::keychain_bio::ensure_gate()?;
    let entry = marketdata_entry()?;
    match entry.get_password() {
        Ok(key) => {
            // ON-READ MIGRATION — see keychain_get_credentials.
            if !MIGRATED_MD.swap(true, Ordering::AcqRel) {
                let _ = crate::keychain_bio::acl_set(MARKETDATA_ACCOUNT, &key); // best-effort
            }
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain error: {e}")),
    }
}

#[tauri::command]
pub fn keychain_delete_marketdata_key() -> Result<(), String> {
    let entry = marketdata_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain error: {e}")),
    }
}

#[tauri::command]
pub fn keychain_has_marketdata_key() -> Result<bool, String> {
    // PROMPT-FREE seat-check (see keychain_has_credentials).
    Ok(crate::keychain_bio::file_item_exists(SERVICE, MARKETDATA_ACCOUNT))
}
