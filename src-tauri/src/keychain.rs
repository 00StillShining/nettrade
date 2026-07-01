// Keychain-backed storage for Trading 212 API credentials.
//
// SECURITY: credentials are persisted ONLY via the macOS Keychain (through the
// `keyring` crate's apple-native backend). Never write the api_key / api_secret
// to disk, logs, stdout, or error strings. Error messages returned to the
// frontend must only ever describe the *kind* of failure, never the secret
// value itself.

use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.stillshining.nettrade";

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
    let entry = entry_for(&account_id)?;
    let creds = Credentials { api_key, api_secret };
    let payload = serde_json::to_string(&creds).map_err(|e| format!("keychain error: {e}"))?;
    entry
        .set_password(&payload)
        .map_err(|e| format!("keychain error: {e}"))
}

#[tauri::command]
pub fn keychain_get_credentials(account_id: String) -> Result<Option<Credentials>, String> {
    let entry = entry_for(&account_id)?;
    match entry.get_password() {
        Ok(payload) => {
            // Static message on parse failure: never format the serde error, which
            // could carry fragments of the stored payload (the secret).
            let creds: Credentials = serde_json::from_str(&payload)
                .map_err(|_| "keychain error: stored credential is malformed".to_string())?;
            Ok(Some(creds))
        }
        // No entry in the current location — fall back to the Phase-0 location
        // and migrate it forward so we don't re-read it (and its OS access
        // prompt) on every launch. The legacy entries are left untouched.
        Err(keyring::Error::NoEntry) => match read_legacy(&account_id)? {
            Some(creds) => {
                if let Ok(payload) = serde_json::to_string(&creds) {
                    let _ = entry.set_password(&payload); // best-effort migrate
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
    let entry = entry_for(&account_id)?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        // Not in the current location — count the Phase-0 location too.
        Err(keyring::Error::NoEntry) => Ok(read_legacy(&account_id)?.is_some()),
        Err(e) => Err(format!("keychain error: {e}")),
    }
}
