// Touch ID gate + trusted-app keychain ACLs for the Actuality API keys.
//
// WHY THIS SHAPE (both "obvious" designs are dead on a self-signed app):
//  1. Hardware-bound biometric items (SecAccessControl) only live in the
//     data-protection keychain, which requires an `application-identifier`
//     entitlement — and AMFI KILLS a self-signed app that claims one (verified
//     empirically: test binary exit 137). So the keys stay in the file keychain.
//  2. The login keychain's "Always Allow" ACL grant needs a Team-ID partition
//     entry to persist — a self-signed app has no Team ID, so the grant can
//     never stick and every read re-prompts (the user's 50-click purgatory).
//
// The working design:
//  - TOUCH ID = an app-level LocalAuthentication gate (LAContext). When enabled,
//    the Rust process refuses to release ANY stored key until one fingerprint
//    (or the Mac password, as the system sheet's fallback) passes per launch.
//    Honest framing: this GATES access with biometrics; it does not
//    biometrically ENCRYPT the keys (impossible here, see 1).
//  - SILENT READS = items are (re)created with an explicit trusted-app ACL
//    (SecAccessCreate + SecTrustedApplicationCreateFromPath(NULL) = this app),
//    the mechanism behind `security add-generic-password -T`. The app is
//    pre-authorized for its own items — no password prompt, and because the
//    trust matches the stable designated requirement, it survives rebuilds.
//
// SECURITY: secrets are NEVER logged, written outside the Keychain, or echoed
// into error strings. Errors carry only the failure kind + OSStatus code.

use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::data::CFData;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::string::{CFString, CFStringRef};
use std::os::raw::c_char;
use std::path::PathBuf;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::sync::Mutex;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};

// Must match keychain.rs.
const SERVICE: &str = "com.stillshining.nettrade";

type OSStatus = i32;

const ERR_SEC_SUCCESS: OSStatus = 0;

#[link(name = "Security", kind = "framework")]
extern "C" {
    static kSecClass: CFStringRef;
    static kSecClassGenericPassword: CFStringRef;
    static kSecAttrService: CFStringRef;
    static kSecAttrAccount: CFStringRef;
    static kSecValueData: CFStringRef;
    static kSecReturnAttributes: CFStringRef;
    static kSecMatchLimit: CFStringRef;
    static kSecMatchLimitOne: CFStringRef;
    static kSecAttrAccess: CFStringRef;

    fn SecItemAdd(attributes: CFDictionaryRef, result: *mut CFTypeRef) -> OSStatus;
    fn SecItemCopyMatching(query: CFDictionaryRef, result: *mut CFTypeRef) -> OSStatus;
    fn SecItemDelete(query: CFDictionaryRef) -> OSStatus;

    // Deprecated-but-functional file-keychain ACL API (the `-T` mechanism). The
    // modern replacement (data-protection keychain) is unavailable to a
    // self-signed app, so this IS the supported path for us.
    fn SecTrustedApplicationCreateFromPath(
        path: *const c_char,
        app: *mut CFTypeRef,
    ) -> OSStatus;
    fn SecAccessCreate(
        descriptor: CFStringRef,
        trustedlist: CFArrayRef,
        access_ref: *mut CFTypeRef,
    ) -> OSStatus;
}

// Force-link LocalAuthentication (used only through objc2 dynamic dispatch).
#[link(name = "LocalAuthentication", kind = "framework")]
extern "C" {}

/// LAPolicyDeviceOwnerAuthentication — biometry with device-password fallback,
/// so a failed sensor can never lock the user out of their own keys.
const LA_POLICY_DEVICE_OWNER_AUTHENTICATION: i64 = 2;

/// Wrap a framework CFStringRef constant as a CFType (get rule — do not consume).
unsafe fn cfstr(r: CFStringRef) -> CFType {
    CFString::wrap_under_get_rule(r).as_CFType()
}

/* ============================ EXISTENCE (NO PROMPT) ============================ */

/// Does a file-keychain item exist for (service, account)? ATTRIBUTE-ONLY query —
/// never requests the secret data, so it NEVER triggers a password prompt. This
/// is what a seat-check must use (the old has-commands called get_password,
/// which is why merely opening Settings popped a password dialog).
pub fn file_item_exists(service: &str, account: &str) -> bool {
    unsafe {
        let pairs: Vec<(CFType, CFType)> = vec![
            (cfstr(kSecClass), cfstr(kSecClassGenericPassword)),
            (cfstr(kSecAttrService), CFString::new(service).as_CFType()),
            (cfstr(kSecAttrAccount), CFString::new(account).as_CFType()),
            (cfstr(kSecReturnAttributes), CFBoolean::true_value().as_CFType()),
            (cfstr(kSecMatchLimit), cfstr(kSecMatchLimitOne)),
        ];
        let dict = CFDictionary::from_CFType_pairs(&pairs);
        let mut result: CFTypeRef = ptr::null();
        let status = SecItemCopyMatching(dict.as_concrete_TypeRef(), &mut result);
        if status == ERR_SEC_SUCCESS && !result.is_null() {
            let _ = CFType::wrap_under_create_rule(result); // balance +1
        }
        status == ERR_SEC_SUCCESS
    }
}

/* ============================ TRUSTED-APP ACL WRITE ============================ */

/// (Re)create the item at (SERVICE, account) with `secret`, ACL-trusting THIS
/// app — so its own reads never password-prompt again, across rebuilds (the
/// trust matches the stable designated requirement, not the per-build cdhash).
pub fn acl_set(account: &str, secret: &str) -> Result<(), String> {
    unsafe {
        // trusted application = the calling app (NULL path)
        let mut app: CFTypeRef = ptr::null();
        let st = SecTrustedApplicationCreateFromPath(ptr::null(), &mut app);
        if st != ERR_SEC_SUCCESS || app.is_null() {
            return Err(format!("keychain error: trusted-app create failed ({st})"));
        }
        let app = CFType::wrap_under_create_rule(app);

        let trusted = CFArray::from_CFTypes(&[app]);
        let descriptor = CFString::new("Actuality"); // shown in any manual-access prompt
        let mut access: CFTypeRef = ptr::null();
        let st = SecAccessCreate(
            descriptor.as_concrete_TypeRef(),
            trusted.as_concrete_TypeRef(),
            &mut access,
        );
        if st != ERR_SEC_SUCCESS || access.is_null() {
            return Err(format!("keychain error: access create failed ({st})"));
        }
        let access = CFType::wrap_under_create_rule(access);

        // replace any prior item (keyring-created ones carry the broken ACL)
        let del_pairs: Vec<(CFType, CFType)> = vec![
            (cfstr(kSecClass), cfstr(kSecClassGenericPassword)),
            (cfstr(kSecAttrService), CFString::new(SERVICE).as_CFType()),
            (cfstr(kSecAttrAccount), CFString::new(account).as_CFType()),
        ];
        let del = CFDictionary::from_CFType_pairs(&del_pairs);
        let _ = SecItemDelete(del.as_concrete_TypeRef());

        let data = CFData::from_buffer(secret.as_bytes());
        let add_pairs: Vec<(CFType, CFType)> = vec![
            (cfstr(kSecClass), cfstr(kSecClassGenericPassword)),
            (cfstr(kSecAttrService), CFString::new(SERVICE).as_CFType()),
            (cfstr(kSecAttrAccount), CFString::new(account).as_CFType()),
            (cfstr(kSecValueData), data.as_CFType()),
            (cfstr(kSecAttrAccess), access),
        ];
        let add = CFDictionary::from_CFType_pairs(&add_pairs);
        let st = SecItemAdd(add.as_concrete_TypeRef(), ptr::null_mut());
        if st == ERR_SEC_SUCCESS {
            Ok(())
        } else {
            Err(format!("keychain error: SecItemAdd failed ({st})"))
        }
    }
}

/* ============================ THE TOUCH ID GATE ============================ */

/// Passed-this-launch latch: ONE fingerprint per app launch, shared by every
/// secret read. A Mutex serialises concurrent first-readers so only one system
/// sheet ever shows.
static GATE_PASSED: AtomicBool = AtomicBool::new(false);
static GATE_LOCK: Mutex<()> = Mutex::new(());

fn flag_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "keychain error: no HOME".to_string())?;
    Ok(PathBuf::from(home)
        .join("Library/Application Support")
        .join(SERVICE)
        .join("touchid-required"))
}

/// Whether the user has turned the Touch ID gate on. The flag file holds no
/// secret — it's a preference marker next to the app's existing nettrade.db.
pub fn gate_enabled() -> bool {
    flag_path().map(|p| p.exists()).unwrap_or(false)
}

/// Run one LocalAuthentication evaluation (Touch ID with password fallback).
/// Blocks the calling (non-main) command thread until the sheet resolves.
fn evaluate_gate(reason: &str) -> Result<(), String> {
    unsafe {
        let ctx: *mut AnyObject = msg_send![class!(LAContext), new];
        if ctx.is_null() {
            return Err("keychain error: LAContext unavailable".to_string());
        }
        let can: Bool = msg_send![
            ctx,
            canEvaluatePolicy: LA_POLICY_DEVICE_OWNER_AUTHENTICATION,
            error: ptr::null_mut::<*mut AnyObject>()
        ];
        if !can.as_bool() {
            let _: () = msg_send![ctx, release];
            return Err(
                "keychain error: Touch ID / device password is not available on this Mac"
                    .to_string(),
            );
        }
        let (tx, rx) = channel::<bool>();
        let block = RcBlock::new(move |success: Bool, _error: *mut AnyObject| {
            let _ = tx.send(success.as_bool());
        });
        let reason_cf = CFString::new(reason);
        let reason_ptr = reason_cf.as_concrete_TypeRef() as *const AnyObject;
        let _: () = msg_send![
            ctx,
            evaluatePolicy: LA_POLICY_DEVICE_OWNER_AUTHENTICATION,
            localizedReason: reason_ptr,
            reply: &*block
        ];
        match rx.recv_timeout(Duration::from_secs(180)) {
            Ok(true) => {
                let _: () = msg_send![ctx, release];
                Ok(())
            }
            Ok(false) => {
                let _: () = msg_send![ctx, release];
                Err("keychain error: Touch ID was cancelled or failed".to_string())
            }
            // timed out: deliberately LEAK ctx — releasing while the sheet may
            // still call the reply block would be a use-after-free.
            Err(_) => Err("keychain error: Touch ID timed out".to_string()),
        }
    }
}

/// Enforce the gate before releasing any secret: no-op when the gate is off or
/// already passed this launch; otherwise show ONE Touch ID sheet.
pub fn ensure_gate() -> Result<(), String> {
    if !gate_enabled() || GATE_PASSED.load(Ordering::Acquire) {
        return Ok(());
    }
    let _guard = GATE_LOCK.lock().map_err(|_| "keychain error: gate poisoned".to_string())?;
    if GATE_PASSED.load(Ordering::Acquire) {
        return Ok(()); // another thread passed it while we waited
    }
    evaluate_gate("unlock your Actuality keys")?;
    GATE_PASSED.store(true, Ordering::Release);
    Ok(())
}

/* ============================ TAURI COMMANDS ============================ */

/// slot → the password-item account it protects (MUST match keychain.rs).
fn pw_account(slot: &str) -> Result<&'static str, String> {
    match slot {
        "creds" => Ok("nettrade:default"),
        "marketdata" => Ok("marketdata:fmp"),
        _ => Err("keychain error: unknown slot".to_string()),
    }
}

/// Can this Mac run the Touch ID gate (biometry or device password)?
#[tauri::command]
pub fn keychain_bio_available() -> bool {
    unsafe {
        let ctx: *mut AnyObject = msg_send![class!(LAContext), new];
        if ctx.is_null() {
            return false;
        }
        let can: Bool = msg_send![
            ctx,
            canEvaluatePolicy: LA_POLICY_DEVICE_OWNER_AUTHENTICATION,
            error: ptr::null_mut::<*mut AnyObject>()
        ];
        let _: () = msg_send![ctx, release];
        can.as_bool()
    }
}

/// Is the Touch ID gate protecting this slot? (gate on AND a key seated — no prompt)
#[tauri::command]
pub fn keychain_bio_has(slot: String) -> Result<bool, String> {
    Ok(gate_enabled() && file_item_exists(SERVICE, pw_account(&slot)?))
}

/// Read a slot's key through the gate (first read per launch shows the sheet).
#[tauri::command]
pub fn keychain_bio_get(slot: String) -> Result<Option<String>, String> {
    ensure_gate()?;
    match slot.as_str() {
        "creds" => {
            let creds = crate::keychain::keychain_get_credentials("default".to_string())?;
            match creds {
                Some(c) => Ok(Some(
                    serde_json::to_string(&c)
                        .map_err(|_| "keychain error: serialize failed".to_string())?,
                )),
                None => Ok(None),
            }
        }
        "marketdata" => crate::keychain::keychain_get_marketdata_key(),
        _ => Err("keychain error: unknown slot".to_string()),
    }
}

/// Turn the Touch ID gate ON: confirm one fingerprint, set the flag, and migrate
/// the slot's item onto the trusted-app ACL (kills the password prompts). The
/// migration read may show ONE FINAL password prompt for a keyring-created item.
#[tauri::command]
pub fn keychain_bio_enable(slot: String) -> Result<(), String> {
    let account = pw_account(&slot)?;
    if !gate_enabled() {
        evaluate_gate("turn on Touch ID for your Actuality keys")?;
        let path = flag_path()?;
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        std::fs::write(&path, b"1").map_err(|e| format!("keychain error: flag write: {e}"))?;
        GATE_PASSED.store(true, Ordering::Release);
    }
    // migrate this slot's item to the trusted-app ACL (idempotent)
    if !file_item_exists(SERVICE, account) {
        return Err("keychain error: no key seated to protect".to_string());
    }
    let secret: String = match slot.as_str() {
        "creds" => match crate::keychain::keychain_get_credentials("default".to_string())? {
            Some(c) => serde_json::to_string(&c)
                .map_err(|_| "keychain error: serialize failed".to_string())?,
            None => return Err("keychain error: no key seated to protect".to_string()),
        },
        "marketdata" => match crate::keychain::keychain_get_marketdata_key()? {
            Some(k) => k,
            None => return Err("keychain error: no key seated to protect".to_string()),
        },
        _ => return Err("keychain error: unknown slot".to_string()),
    };
    acl_set(account, &secret)
}

/// Turn the gate OFF: confirm identity once, remove the flag. Items keep their
/// trusted-app ACL (silent reads stay — strictly better than the old state).
#[tauri::command]
pub fn keychain_bio_disable(slot: String) -> Result<(), String> {
    let _ = pw_account(&slot)?; // validate the slot name
    if !gate_enabled() {
        return Ok(());
    }
    evaluate_gate("turn off Touch ID for your Actuality keys")?;
    let path = flag_path()?;
    std::fs::remove_file(&path).map_err(|e| format!("keychain error: flag remove: {e}"))?;
    Ok(())
}

/// Nothing separate to delete under the gate design (keys live in the standard
/// items, which the normal delete commands remove). Kept for the CLEAR flow.
#[tauri::command]
pub fn keychain_bio_delete(_slot: String) -> Result<(), String> {
    Ok(())
}
