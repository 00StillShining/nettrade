// Shared SQLite client. The Rust side owns the schema via migrations
// (see src-tauri/src/lib.rs); this module just memoizes the loaded handle so
// callers don't each pay the IPC round-trip to open the DB.

import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:nettrade.db");
  }
  return dbPromise;
}
