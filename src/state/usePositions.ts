// React hook wiring the Trading 212 adapter + SQLite cache together for a
// single account. Deliberately dependency-light (no TanStack/Zustand) per
// Phase 2 scope — this is the only state container positions need for now.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  fetchPositions,
  type Credentials,
  type Environment,
  type Position,
} from "../adapters/trading212";
import { cachePositions, readCachedPositions, getLastSync } from "../db/positions";

export type PositionsStatus = "idle" | "loading" | "ok" | "no-key" | "error";

export interface UsePositionsResult {
  positions: Position[];
  status: PositionsStatus;
  error: string | null;
  lastSync: string | null;
  refresh: () => Promise<void>;
}

/** Matches the shape returned by the Rust `keychain_get_credentials` command. */
interface StoredCredentials {
  apiKey: string;
  apiSecret: string;
}

export function usePositions(accountId: string, env: Environment): UsePositionsResult {
  const [positions, setPositions] = useState<Position[]>([]);
  const [status, setStatus] = useState<PositionsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Guards against a stale async response clobbering state after the
  // accountId/env changes or the component unmounts mid-fetch.
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const myId = ++requestId.current;
    setStatus("loading");
    setError(null);

    try {
      const creds = await invoke<StoredCredentials | null>("keychain_get_credentials", { accountId });
      if (myId !== requestId.current) return;

      if (!creds) {
        setStatus("no-key");
        setPositions(await readCachedPositions(accountId));
        setLastSync(await getLastSync(accountId));
        return;
      }

      try {
        const fetched = await fetchPositions(creds as Credentials, env);
        if (myId !== requestId.current) return;
        await cachePositions(accountId, fetched);
        setPositions(fetched);
        setLastSync(await getLastSync(accountId));
        setStatus("ok");
      } catch (fetchErr) {
        // Fall back to whatever we have cached rather than showing nothing.
        if (myId !== requestId.current) return;
        const cached = await readCachedPositions(accountId);
        setPositions(cached);
        setLastSync(await getLastSync(accountId));
        setError(fetchErr instanceof Error ? fetchErr.message : "Failed to fetch positions");
        setStatus("error");
      }
    } catch (credErr) {
      if (myId !== requestId.current) return;
      setError(credErr instanceof Error ? credErr.message : "Failed to read credentials");
      setStatus("error");
    }
  }, [accountId, env]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { positions, status, error, lastSync, refresh };
}
