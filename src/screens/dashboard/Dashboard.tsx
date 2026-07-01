import { useMemo, useState } from "react";
import Chrome from "../../shell/Chrome";
import { usePositions, type UsePositionsResult } from "../../state/usePositions";
import type { Position } from "../../adapters/trading212";
import { MOCK_POSITIONS } from "../../data/mockPositions";
import { computePortfolioShape } from "./portfolioShape";
import { PortfolioShapeRadar } from "./PortfolioShapeRadar";
import { fmtMinor, fmtQty, fmtPct, Triangle } from "../shared/format";
import s from "./Dashboard.module.css";

/**
 * Dashboard — the Phase-1 gate screen. Flat-DOM, function-first (actuality-ui
 * skill §1-2). Answers ONE question: "am I actually up or down, and what do I
 * hold?" One hero (portfolio value + unrealised P/L), a wide holdings table
 * (main), and a quieter supporting rail (movers · allocation · snapshot) that
 * fills the column so there's no leftover deadspace. Chrome handled by <Chrome/>.
 *
 * Wired to the EXISTING, untouched usePositions("default", "live") hook —
 * this screen owns no fetch/parse logic of its own.
 */

function SyncButton({ status, onClick }: { status: string; onClick: () => void }) {
  const loading = status === "loading";
  return (
    <button type="button" className={s.syncBtn} onClick={onClick} disabled={loading}>
      {loading ? "SYNCING…" : "SYNC"}
    </button>
  );
}

/** Compact BEST/WORST holding micro-stat — ticker + its own unrealised P/L. */
function HoldingStat({
  label,
  position,
  ccy,
}: {
  label: string;
  position: Position | null;
  ccy: string;
}) {
  if (!position) {
    return (
      <div className={s.microStat}>
        <div className={s.microLabel}>{label}</div>
        <div className={s.microValue}>&mdash;</div>
      </div>
    );
  }
  const up = position.unrealizedPlMinor >= 0;
  return (
    <div className={s.microStat}>
      <div className={s.microLabel}>{label}</div>
      <div className={s.microTicker}>{position.ticker}</div>
      <div className={`${s.microPl} ${up ? s.gain : s.loss}`}>
        <Triangle up={up} className={s.microTri} />
        {fmtMinor(Math.abs(position.unrealizedPlMinor), ccy)}
      </div>
    </div>
  );
}

/** Allocation rail row — ticker + a bar (relative to the largest holding) + share %. */
function AllocRow({ ticker, share, maxShare }: { ticker: string; share: number; maxShare: number }) {
  const w = maxShare > 0 ? (share / maxShare) * 100 : 0;
  return (
    <div className={s.allocItem}>
      <div className={s.allocItemHead}>
        <span className={s.allocTicker}>{ticker}</span>
        <span className={s.allocShare}>{fmtPct(share)}</span>
      </div>
      <div className={s.allocTrack}>
        <div className={s.allocFill} style={{ width: `${w.toFixed(2)}%` }} />
      </div>
    </div>
  );
}

/** Movers rail row — ticker + signed P/L + muted %. Guards cost<=0 for %. */
function MoverRow({ position, ccy }: { position: Position; ccy: string | null }) {
  const up = position.unrealizedPlMinor >= 0;
  const denom = position.totalCostMinor;
  const pct = denom > 0 ? position.unrealizedPlMinor / denom : null;
  return (
    <div className={s.moverRow}>
      <span className={s.moverTicker}>{position.ticker}</span>
      <span className={`${s.moverPl} ${up ? s.gain : s.loss}`}>
        <Triangle up={up} className={s.moverTri} />
        {fmtMinor(Math.abs(position.unrealizedPlMinor), ccy)}
        {pct !== null && <span className={s.moverPct}>({fmtPct(pct)})</span>}
      </span>
    </div>
  );
}

function DashboardView({ positions, status, error, lastSync, refresh }: UsePositionsResult) {
  const displayCcy = positions[0]?.accountCurrency ?? "GBP";

  const totals = useMemo(() => {
    const totalValue = positions.reduce((sum, p) => sum + p.currentValueMinor, 0);
    const totalUnrealizedPl = positions.reduce((sum, p) => sum + p.unrealizedPlMinor, 0);
    const totalInvested = positions.reduce((sum, p) => sum + p.totalCostMinor, 0);
    const denom = totalInvested;
    const pct = denom > 0 ? totalUnrealizedPl / denom : null;

    let best: Position | null = null;
    let worst: Position | null = null;
    for (const p of positions) {
      if (!best || p.unrealizedPlMinor > best.unrealizedPlMinor) best = p;
      if (!worst || p.unrealizedPlMinor < worst.unrealizedPlMinor) worst = p;
    }
    // A single holding shouldn't appear as both BEST and WORST.
    if (positions.length < 2) worst = null;

    return { totalValue, totalUnrealizedPl, totalInvested, pct, best, worst };
  }, [positions]);

  const sortedPositions = useMemo(
    () => [...positions].sort((a, b) => b.currentValueMinor - a.currentValueMinor),
    [positions],
  );

  /** PORTFOLIO SHAPE radar — five honest axes derived only from the current
   * Position[] snapshot (see portfolioShape.ts for the exact formulas). */
  const portfolioShape = useMemo(() => computePortfolioShape(positions), [positions]);

  /** Honest allocation — each position's share of total current value. No
   * history/time-series exists yet (honest-data rule), so this is the only
   * "bar" the hero is allowed: a same-instant composition readout. */
  const allocation = useMemo(() => {
    if (totals.totalValue <= 0) return [];
    return sortedPositions.map((p) => ({
      ticker: p.ticker,
      share: p.currentValueMinor / totals.totalValue,
    }));
  }, [sortedPositions, totals.totalValue]);

  /** Movers rail — top gainers/losers by unrealizedPlMinor (honest-data rule:
   * derived straight from the current Position[] snapshot, no fabrication). */
  const gainers = useMemo(
    () =>
      positions
        .filter((p) => p.unrealizedPlMinor > 0)
        .sort((a, b) => b.unrealizedPlMinor - a.unrealizedPlMinor)
        .slice(0, 4),
    [positions],
  );
  const losers = useMemo(
    () =>
      positions
        .filter((p) => p.unrealizedPlMinor < 0)
        .sort((a, b) => a.unrealizedPlMinor - b.unrealizedPlMinor)
        .slice(0, 4),
    [positions],
  );

  /** Rail supporting panels — top holdings by allocation + a compact snapshot,
   * all derived from the current Position[] snapshot (honest-data rule). */
  const allocTop = useMemo(() => allocation.slice(0, 8), [allocation]);

  const railStats = useMemo(() => {
    const winners = positions.filter((p) => p.unrealizedPlMinor > 0).length;
    const decliners = positions.filter((p) => p.unrealizedPlMinor < 0).length;
    const top3 = allocation.slice(0, 3).reduce((sum, a) => sum + a.share, 0);
    const avgPositionMinor = positions.length > 0 ? Math.round(totals.totalValue / positions.length) : 0;
    const topHolding = allocation[0] ?? null;
    return { winners, decliners, top3, avgPositionMinor, topHolding };
  }, [positions, allocation, totals.totalValue]);

  const connection: "ok" | "loading" | "no-key" | "error" =
    status === "ok"
      ? "ok"
      : status === "loading" || status === "idle"
        ? "loading"
        : status === "no-key"
          ? "no-key"
          : "error";

  const plUp = totals.totalUnrealizedPl >= 0;
  const pctFmt = totals.pct !== null ? fmtPct(totals.pct) : null;

  const showSkeleton = (status === "loading" || status === "idle") && positions.length === 0;
  const showNoKey = status === "no-key";
  const showEmpty = status === "ok" && positions.length === 0;

  return (
    <Chrome
      title="DASHBOARD"
      env="live"
      accountLabel="DEFAULT"
      connection={connection}
      lastSyncISO={lastSync}
      positionsCount={positions.length}
      rateLimitNote="1 req/s"
    >
      <div className={s.screen}>
        {/* ============================== HERO ============================== */}
        <section className={s.hero} aria-label="Portfolio value and unrealised profit or loss">
          <div className={s.heroRibbon}>Dashboard</div>

          {/* ---- LEFT: the existing hero content (value + P/L + micro-stats +
              allocation bar), unchanged — just moved into its own column so a
              radar can sit to its right (CHANGE 3). ---- */}
          <div className={s.heroLeft}>
            <div className={s.heroMain}>
              <div className={s.heroLabel}>Total Value</div>

              {showSkeleton ? (
                <>
                  <div className={s.skeletonBar} style={{ width: "70%", height: 48 }} />
                  <div className={s.skeletonBar} style={{ width: "50%", height: 22, marginTop: 8 }} />
                  <div className={s.heroNote}>Fetching live positions…</div>
                </>
              ) : (
                <>
                  <div className={s.heroValue}>{fmtMinor(totals.totalValue, displayCcy)}</div>

                  <div className={`${s.heroPlRow} ${plUp ? s.gain : s.loss}`}>
                    <Triangle up={plUp} className={s.heroTri} />
                    <span>{fmtMinor(Math.abs(totals.totalUnrealizedPl), displayCcy)}</span>
                    {pctFmt && (
                      <span className={s.heroPlPct}>
                        ({plUp ? "+" : "−"}
                        {pctFmt})
                      </span>
                    )}
                  </div>
                  <div className={s.heroSubLabel}>Unrealised · Open Positions</div>

                  <p className={s.heroNote}>
                    Deposits/withdrawals &amp; realised P/L arrive with the Performance engine.
                  </p>

                  <SyncButton status={status} onClick={() => void refresh()} />
                </>
              )}
            </div>

            {!showSkeleton && (
              <div className={s.heroAside}>
                {/* ---- Supporting micro-stats: all derived from Position[] (honest-data) ---- */}
                <div className={s.microRow}>
                  <div className={s.microStat}>
                    <div className={s.microLabel}>Invested</div>
                    <div className={s.microValue}>{fmtMinor(totals.totalInvested, displayCcy)}</div>
                  </div>
                  <div className={s.microStat}>
                    <div className={s.microLabel}>Unrealised</div>
                    <div className={`${s.microValue} ${plUp ? s.gain : s.loss}`}>
                      {plUp ? "+" : "−"}
                      {fmtMinor(Math.abs(totals.totalUnrealizedPl), displayCcy)}
                      {pctFmt && <span className={s.microPct}> ({pctFmt})</span>}
                    </div>
                  </div>
                  <div className={s.microStat}>
                    <div className={s.microLabel}>Positions</div>
                    <div className={s.microValue}>{positions.length}</div>
                  </div>
                  <HoldingStat label="Best" position={totals.best} ccy={displayCcy} />
                  <HoldingStat label="Worst" position={totals.worst} ccy={displayCcy} />
                </div>

                {/* ---- Allocation: each position's share of total current value ---- */}
                {allocation.length > 0 && (
                  <div className={s.allocation} aria-label="Allocation by current value">
                    <div className={s.allocationBar}>
                      {allocation.map((a, i) => (
                        <div
                          key={a.ticker}
                          className={s.allocationSeg}
                          style={{
                            width: `${(a.share * 100).toFixed(3)}%`,
                            opacity: 1 - (i / Math.max(allocation.length, 1)) * 0.55,
                          }}
                          title={`${a.ticker} · ${(a.share * 100).toFixed(1)}%`}
                        />
                      ))}
                    </div>
                    <div className={s.allocationLabel}>Allocation · Share of Value</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---- RIGHT: the honest "Portfolio Shape" pentagon radar (CHANGE 3) ---- */}
          {!showSkeleton && (
            <div className={s.heroRadarCol}>
              <PortfolioShapeRadar axes={portfolioShape.axes} />
            </div>
          )}
        </section>

        {/* ============================== STATE NOTES ============================== */}
        {showNoKey && (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>No Trading 212 key found</div>
            <p>Connect one in Settings to see your live positions here.</p>
          </div>
        )}

        {status === "error" && error && (
          <div className={s.stateNote}>Live sync failed — showing last known data. ({error})</div>
        )}

        {showEmpty && (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>No open positions</div>
            <p>Positions will appear here as soon as you hold something in this account.</p>
          </div>
        )}

        {/* ============================== MAIN ROW: HOLDINGS + MOVERS ============================== */}
        {!showNoKey && !showEmpty && (sortedPositions.length > 0 || showSkeleton) && (
          <div className={s.mainRow}>
            {/* ---- LEFT: wide holdings trading table ---- */}
            <section className={s.panel} aria-label="Open positions">
              <div className={s.panelHead}>
                <span className={s.panelTitle}>Holdings</span>
                <span className={s.panelMeta}>{sortedPositions.length} positions</span>
              </div>
              <div className={s.tableScroll}>
                {showSkeleton ? (
                  <div>
                    {[0, 1, 2, 3].map((i) => (
                      <div className={s.skeletonRow} key={i}>
                        <div className={s.skeletonBar} style={{ width: "20%" }} />
                        <div className={s.skeletonBar} style={{ width: "8%", marginLeft: "auto" }} />
                        <div className={s.skeletonBar} style={{ width: "10%" }} />
                        <div className={s.skeletonBar} style={{ width: "10%" }} />
                        <div className={s.skeletonBar} style={{ width: "12%" }} />
                        <div className={s.skeletonBar} style={{ width: "8%" }} />
                        <div className={s.skeletonBar} style={{ width: "14%" }} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th scope="col">Ticker</th>
                        <th scope="col" className={s.num}>
                          Qty
                        </th>
                        <th scope="col" className={s.num}>
                          Avg
                        </th>
                        <th scope="col" className={s.num}>
                          Price
                        </th>
                        <th scope="col" className={s.num}>
                          Value
                        </th>
                        <th scope="col" className={s.num}>
                          Alloc
                        </th>
                        <th scope="col" className={s.num}>
                          Unrealised
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPositions.map((p: Position) => {
                        const up = p.unrealizedPlMinor >= 0;
                        const alloc = totals.totalValue > 0 ? p.currentValueMinor / totals.totalValue : null;
                        const plDenom = p.totalCostMinor;
                        const plPct = plDenom > 0 ? p.unrealizedPlMinor / plDenom : null;
                        return (
                          <tr key={p.ticker}>
                            <td>
                              <span className={s.ticker}>{p.ticker}</span>
                              {p.name && <span className={s.tickerName}>{p.name}</span>}
                            </td>
                            <td className={`${s.num} ${s.qty}`}>{fmtQty(p.quantity)}</td>
                            <td className={`${s.num} ${s.value}`}>{fmtMinor(p.avgPriceMinor, p.instrumentCurrency)}</td>
                            <td className={`${s.num} ${s.value}`}>{fmtMinor(p.currentPriceMinor, p.instrumentCurrency)}</td>
                            <td className={`${s.num} ${s.value}`}>{fmtMinor(p.currentValueMinor, p.accountCurrency)}</td>
                            <td className={`${s.num} ${s.value}`}>{alloc !== null ? fmtPct(alloc) : "—"}</td>
                            <td className={s.num}>
                              <span className={`${s.plCell} ${up ? s.gain : s.loss}`}>
                                <Triangle up={up} className={s.plTri} />
                                {fmtMinor(Math.abs(p.unrealizedPlMinor), p.accountCurrency)}
                                {plPct !== null && <span className={s.plPct}>({fmtPct(plPct)})</span>}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* ---- RIGHT: quieter movers rail — top gainers/losers ---- */}
            {!showSkeleton && (
              <aside className={s.rail} aria-label="Top gainers and losers">
                <div className={s.railPanel}>
                  <div className={`${s.railHead} ${s.railHeadGain}`}>Top Gainers</div>
                  <div className={s.moverList}>
                    {gainers.length > 0 ? (
                      gainers.map((p) => <MoverRow key={p.ticker} position={p} ccy={p.accountCurrency} />)
                    ) : (
                      <div className={s.moverEmpty}>&mdash;</div>
                    )}
                  </div>
                </div>
                <div className={s.railPanel}>
                  <div className={`${s.railHead} ${s.railHeadLoss}`}>Top Losers</div>
                  <div className={s.moverList}>
                    {losers.length > 0 ? (
                      losers.map((p) => <MoverRow key={p.ticker} position={p} ccy={p.accountCurrency} />)
                    ) : (
                      <div className={s.moverEmpty}>&mdash;</div>
                    )}
                  </div>
                </div>

                {allocTop.length > 0 && (
                  <div className={`${s.railPanel} ${s.railFlex}`}>
                    <div className={`${s.railHead} ${s.railHeadAlloc}`}>Allocation</div>
                    <div className={s.allocList}>
                      {allocTop.map((a) => (
                        <AllocRow key={a.ticker} ticker={a.ticker} share={a.share} maxShare={allocTop[0]?.share ?? 1} />
                      ))}
                    </div>
                  </div>
                )}

                <div className={s.railPanel}>
                  <div className={`${s.railHead} ${s.railHeadSnap}`}>Snapshot</div>
                  <div className={s.statList}>
                    <div className={s.statRow}>
                      <span className={s.statLabel}>Winners / Losers</span>
                      <span className={s.statValue}>
                        <span className={s.gain}>
                          <Triangle up className={s.statTri} />
                          {railStats.winners}
                        </span>
                        <span className={s.statSep}>/</span>
                        <span className={s.loss}>
                          <Triangle up={false} className={s.statTri} />
                          {railStats.decliners}
                        </span>
                      </span>
                    </div>
                    <div className={s.statRow}>
                      <span className={s.statLabel}>Top Holding</span>
                      <span className={s.statValue}>
                        {railStats.topHolding
                          ? `${railStats.topHolding.ticker} · ${fmtPct(railStats.topHolding.share)}`
                          : "—"}
                      </span>
                    </div>
                    <div className={s.statRow}>
                      <span className={s.statLabel}>Top 3 Conc.</span>
                      <span className={s.statValue}>{fmtPct(railStats.top3)}</span>
                    </div>
                    <div className={s.statRow}>
                      <span className={s.statLabel}>Avg Position</span>
                      <span className={s.statValue}>{fmtMinor(railStats.avgPositionMinor, displayCcy)}</span>
                    </div>
                  </div>
                </div>
              </aside>
            )}
          </div>
        )}
      </div>
    </Chrome>
  );
}

/** Live container — the real Trading 212 data path (Keychain + native HTTP). */
function LiveDashboard() {
  return <DashboardView {...usePositions("default", "live")} />;
}

/** Mock container — placeholder data for design iteration (VITE_MOCK builds).
 * Never touches the Keychain/API, so no password prompts while we tune the UI. */
function MockDashboard() {
  const [lastSync] = useState(() => new Date(Date.now() - 90_000).toISOString());
  const data: UsePositionsResult = {
    positions: MOCK_POSITIONS,
    status: "ok",
    error: null,
    lastSync,
    refresh: async () => {},
  };
  return <DashboardView {...data} />;
}

/** Build-time switch: VITE_MOCK => placeholder data (no Keychain); else live.
 * The unused branch is tree-shaken since VITE_MOCK is a compile-time constant. */
export default function Dashboard() {
  return import.meta.env.VITE_MOCK ? <MockDashboard /> : <LiveDashboard />;
}
