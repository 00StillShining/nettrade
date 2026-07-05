mod keychain;
mod keychain_bio;

use tauri_plugin_sql::{Migration, MigrationKind};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "phase2_init",
            sql: r#"
CREATE TABLE IF NOT EXISTS position_cache (
  account_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  isin TEXT,
  name TEXT,
  instrument_currency TEXT,
  quantity REAL,
  avg_price_minor INTEGER,
  current_price_minor INTEGER,
  account_currency TEXT,
  current_value_minor INTEGER,
  unrealized_pl_minor INTEGER,
  fx_impact_minor INTEGER,
  total_cost_minor INTEGER,
  raw_json TEXT,
  fetched_at TEXT,
  PRIMARY KEY (account_id, ticker)
);
CREATE TABLE IF NOT EXISTS sync_meta (
  account_id TEXT NOT NULL,
  k TEXT NOT NULL,
  v TEXT,
  PRIMARY KEY (account_id, k)
);
"#,
            kind: MigrationKind::Up,
        },
        // phase 2c — persisted history + honest recorded value snapshots. This is
        // what makes the Performance-Truth engine's realised P/L, dividends, cash
        // events and value curve survive a relaunch (and paginate incrementally
        // rather than re-fetching the whole ~6/min-rate-limited history each time).
        // All *_minor columns are INTEGER minor units (pennies), matching the
        // adapter's toMinor convention; quantity is REAL (fractional shares).
        // raw_json keeps the untouched adapter payload for forward-compat/audit.
        Migration {
            version: 2,
            description: "phase2c_history",
            sql: r#"
CREATE TABLE IF NOT EXISTS order_history (
  id TEXT PRIMARY KEY,
  date_iso TEXT NOT NULL,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  fill_price_minor INTEGER NOT NULL,
  filled_value_minor INTEGER NOT NULL,
  fee_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  raw_json TEXT
);
CREATE TABLE IF NOT EXISTS dividend_history (
  id TEXT PRIMARY KEY,
  date_iso TEXT NOT NULL,
  ticker TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  quantity REAL,
  gross_per_share_minor INTEGER,
  type TEXT,
  raw_json TEXT
);
CREATE TABLE IF NOT EXISTS transaction_history (
  id TEXT PRIMARY KEY,
  date_iso TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  reference TEXT,
  raw_json TEXT
);
CREATE TABLE IF NOT EXISTS equity_snapshots (
  at_iso TEXT PRIMARY KEY,
  total_value_minor INTEGER NOT NULL,
  net_deposits_minor INTEGER NOT NULL,
  ccy TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_history_date ON order_history(date_iso);
CREATE INDEX IF NOT EXISTS idx_dividend_history_date ON dividend_history(date_iso);
CREATE INDEX IF NOT EXISTS idx_transaction_history_date ON transaction_history(date_iso);
"#,
            // NOTE: no index on equity_snapshots(at_iso) — it's the PRIMARY KEY, which
            // already carries one. SINGLE-ACCOUNT ASSUMPTION: unlike position_cache,
            // the v2 tables carry no account_id; a future multi-account phase must
            // migrate them (or scope by account) before histories can coexist.
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:nettrade.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            greet,
            keychain::keychain_set_credentials,
            keychain::keychain_get_credentials,
            keychain::keychain_delete_credentials,
            keychain::keychain_has_credentials,
            keychain::keychain_set_marketdata_key,
            keychain::keychain_get_marketdata_key,
            keychain::keychain_delete_marketdata_key,
            keychain::keychain_has_marketdata_key,
            keychain_bio::keychain_bio_available,
            keychain_bio::keychain_bio_has,
            keychain_bio::keychain_bio_get,
            keychain_bio::keychain_bio_enable,
            keychain_bio::keychain_bio_disable,
            keychain_bio::keychain_bio_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
