mod keychain;

use tauri_plugin_sql::{Migration, MigrationKind};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn migrations() -> Vec<Migration> {
    vec![Migration {
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
    }]
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
            keychain::keychain_has_marketdata_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
