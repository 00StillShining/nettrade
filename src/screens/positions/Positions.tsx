import { useMemo, useState } from "react";
import Chrome from "../../shell/Chrome";
import { usePositions, type UsePositionsResult } from "../../state/usePositions";
import type { Position } from "../../adapters/trading212";
import { MOCK_POSITIONS } from "../../data/mockPositions";
import { tickerInitials, tickerMotif } from "./tickerGlyph";
import PositionDetailModal from "./PositionDetailModal";
import { fmtMinor, fmtQty, fmtPct, Triangle } from "../shared/format";
import s from "./Positions.module.css";

/**
 * Positions — the SDN roster-card strip (VISUAL_DIRECTION.md §5 "Positions",
 * SCREEN_PATTERNS.md §7 the locked cream-paper recipe). Function-first
 * (actuality-ui skill §1-2): answers ONE question — "what do I hold and how
 * is each doing?" — via a responsive grid of cream cards, one per holding,
 * sorted by current value. Same shell/data-wiring pattern as the Dashboard:
 * Chrome handles the dark frame + telemetry/status bars; this screen owns
 * only the cream content between them, wired to the SAME usePositions hook
 * (live) or MOCK_POSITIONS (VITE_MOCK) — no fetch/parse logic of its own.
 */

function SyncButton({ status, onClick }: { status: string; onClick: () => void }) {
  const loading = status === "loading";
  return (
    <button type="button" className={s.syncBtn} onClick={onClick} disabled={loading}>
      {loading ? "SYNCING…" : "SYNC"}
    </button>
  );
}

/**
 * TickerGlyph — a GENERATED abstract "portrait" mark, never a real or fake
 * company logo (honest-data rule). Ground = muted --paper-2 utility tone;
 * foreground = the ticker's initials in the display font + a small
 * deterministic geometric motif seeded from the ticker string, so the same
 * ticker always renders the same glyph without ever pretending to be art
 * fetched from anywhere.
 */
function TickerGlyph({ ticker }: { ticker: string }) {
  const initials = tickerInitials(ticker);
  const motif = tickerMotif(ticker);
  const cx = 30 + motif.seedA * 40;
  const cy = 20 + motif.seedB * 30;
  const r = 10 + motif.seedC * 14;

  return (
    <div className={s.glyph} aria-hidden="true">
      <svg className={s.glyphSvg} viewBox="0 0 80 60" preserveAspectRatio="xMidYMid slice">
        <g transform={`rotate(${motif.rotate} 40 30)`} opacity="0.5">
          {motif.variant === 0 && <circle cx={cx} cy={cy} r={r} className={s.glyphShape} />}
          {motif.variant === 1 && (
            <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} className={s.glyphShape} />
          )}
          {motif.variant === 2 && (
            <polygon
              points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`}
              className={s.glyphShape}
            />
          )}
          {motif.variant === 3 && (
            <>
              <circle cx={cx - r * 0.5} cy={cy} r={r * 0.6} className={s.glyphShape} />
              <circle cx={cx + r * 0.5} cy={cy} r={r * 0.6} className={s.glyphShape} />
            </>
          )}
          {motif.variant === 4 && (
            <rect
              x={cx - r}
              y={cy - r * 0.4}
              width={r * 2}
              height={r * 0.8}
              transform={`rotate(45 ${cx} ${cy})`}
              className={s.glyphShape}
            />
          )}
        </g>
      </svg>
      <span className={s.glyphInitials}>{initials}</span>
    </div>
  );
}

/** One roster card — the recipe (SCREEN_PATTERNS §7) applied per-holding:
 * cream fill + paper-grain + ink outline + a P/L-coloured header ribbon. */
function PositionCard({
  position,
  totalValue,
  onSelect,
}: {
  position: Position;
  totalValue: number;
  onSelect: (p: Position) => void;
}) {
  const plZero = position.unrealizedPlMinor === 0;
  const up = position.unrealizedPlMinor >= 0;
  const plDenom = position.totalCostMinor;
  const plPct = plDenom > 0 ? position.unrealizedPlMinor / plDenom : null;
  const alloc = totalValue > 0 ? position.currentValueMinor / totalValue : null;

  return (
    <div
      className={s.card}
      tabIndex={0}
      role="button"
      aria-label={`${position.ticker.split("_")[0]} position — open detail`}
      onClick={() => onSelect(position)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(position);
        }
      }}
    >
      <div className={`${s.ribbon} ${plZero ? s.ribbonFlat : up ? s.ribbonGain : s.ribbonLoss}`}>
        {position.ticker.split("_")[0]}
      </div>

      <div className={s.body}>
        <div className={s.topRow}>
          <TickerGlyph ticker={position.ticker} />
          <div className={s.nameCol}>
            <div className={s.name}>{position.name ?? position.ticker}</div>
            <div className={s.qty}>{fmtQty(position.quantity)} sh</div>
          </div>
        </div>

        <div className={s.valueRow}>
          <div className={s.valueLabel}>Value</div>
          <div className={s.value}>{fmtMinor(position.currentValueMinor, position.accountCurrency)}</div>
        </div>

        <div className={plZero ? s.plRow : `${s.plRow} ${up ? s.gain : s.loss}`}>
          {!plZero && <Triangle up={up} className={s.plTri} />}
          <span className={s.plValue}>
            {plZero ? fmtMinor(0, position.accountCurrency) : `${up ? "+" : "−"}${fmtMinor(Math.abs(position.unrealizedPlMinor), position.accountCurrency)}`}
          </span>
          {plPct !== null && !plZero && (
            <span className={s.plPct}>
              ({up ? "+" : "−"}
              {fmtPct(plPct)})
            </span>
          )}
        </div>

        <div className={s.footRow}>
          <div className={s.footStat}>
            <span className={s.footLabel}>Alloc</span>
            <span className={s.footValue}>{alloc !== null ? fmtPct(alloc) : "—"}</span>
          </div>
          <div className={s.footStat}>
            <span className={s.footLabel}>Avg</span>
            <span className={s.footValue}>{fmtMinor(position.avgPriceMinor, position.instrumentCurrency)}</span>
          </div>
          <div className={s.footStat}>
            <span className={s.footLabel}>Price</span>
            <span className={s.footValue}>{fmtMinor(position.currentPriceMinor, position.instrumentCurrency)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PositionsView({ positions, status, error, lastSync, refresh }: UsePositionsResult) {
  const displayCcy = positions[0]?.accountCurrency ?? "GBP";
  const [selected, setSelected] = useState<Position | null>(null);

  const sortedPositions = useMemo(
    () => [...positions].sort((a, b) => b.currentValueMinor - a.currentValueMinor),
    [positions],
  );

  const totals = useMemo(() => {
    const totalValue = positions.reduce((sum, p) => sum + p.currentValueMinor, 0);
    const totalUnrealizedPl = positions.reduce((sum, p) => sum + p.unrealizedPlMinor, 0);
    return { totalValue, totalUnrealizedPl };
  }, [positions]);

  const connection: "ok" | "loading" | "no-key" | "error" =
    status === "ok"
      ? "ok"
      : status === "loading" || status === "idle"
        ? "loading"
        : status === "no-key"
          ? "no-key"
          : "error";

  const showSkeleton = (status === "loading" || status === "idle") && positions.length === 0;
  const showNoKey = status === "no-key";
  const showEmpty = status === "ok" && positions.length === 0;

  return (
    <Chrome
      title="POSITIONS"
      env="live"
      accountLabel="DEFAULT"
      connection={connection}
      lastSyncISO={lastSync}
      positionsCount={positions.length}
      rateLimitNote="1 req/s"
    >
      <div className={s.screen}>
        {/* ============================== HERO ============================== */}
        <section className={s.hero} aria-label="Holdings summary">
          <div className={s.heroRibbon}>Positions</div>
          <div className={s.heroRow}>
            <div className={s.heroStat}>
              <div className={s.heroLabel}>Positions</div>
              <div className={s.heroValue}>{positions.length}</div>
            </div>
            <div className={s.heroStat}>
              <div className={s.heroLabel}>Total Value</div>
              <div className={s.heroValue}>{fmtMinor(totals.totalValue, displayCcy)}</div>
            </div>
            <div className={s.heroStat}>
              <div className={s.heroLabel}>Unrealised</div>
              <div className={`${s.heroValue} ${totals.totalUnrealizedPl >= 0 ? s.gain : s.loss}`}>
                <Triangle up={totals.totalUnrealizedPl >= 0} className={s.heroTri} />
                {fmtMinor(Math.abs(totals.totalUnrealizedPl), displayCcy)}
              </div>
            </div>
          </div>
          <div className={s.heroFoot}>
            <p className={s.heroNote}>What you hold, sorted by current value — sign + ▲/▼ always shown with colour.</p>
            <SyncButton status={status} onClick={() => void refresh()} />
          </div>
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

        {/* ============================== ROSTER GRID ============================== */}
        {!showNoKey && !showEmpty && (
          <section className={s.panel} aria-label="Holdings roster">
            <div className={s.panelHead}>
              <span className={s.panelTitle}>Holdings Roster</span>
              <span className={s.panelMeta}>{sortedPositions.length} positions</span>
            </div>
            <div className={s.gridScroll}>
              {showSkeleton ? (
                <div className={s.grid}>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div className={s.skeletonCard} key={i}>
                      <div className={s.skeletonBar} style={{ width: "40%", height: 18 }} />
                      <div className={s.skeletonBar} style={{ width: "70%", height: 12, marginTop: 10 }} />
                      <div className={s.skeletonBar} style={{ width: "55%", height: 22, marginTop: 14 }} />
                      <div className={s.skeletonBar} style={{ width: "60%", height: 14, marginTop: 8 }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className={s.grid}>
                  {sortedPositions.map((p) => (
                    <PositionCard key={p.ticker} position={p} totalValue={totals.totalValue} onSelect={setSelected} />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {selected && (
        <PositionDetailModal position={selected} totalValue={totals.totalValue} onClose={() => setSelected(null)} />
      )}
    </Chrome>
  );
}

/** Live container — the real Trading 212 data path (Keychain + native HTTP). */
function LivePositions() {
  return <PositionsView {...usePositions("default", "live")} />;
}

/** Mock container — placeholder data for design iteration (VITE_MOCK builds).
 * Never touches the Keychain/API, so no password prompts while we tune the UI. */
function MockPositions() {
  const [lastSync] = useState(() => new Date(Date.now() - 90_000).toISOString());
  const data: UsePositionsResult = {
    positions: MOCK_POSITIONS,
    status: "ok",
    error: null,
    lastSync,
    refresh: async () => {},
  };
  return <PositionsView {...data} />;
}

/** Build-time switch: VITE_MOCK => placeholder data (no Keychain); else live.
 * The unused branch is tree-shaken since VITE_MOCK is a compile-time constant. */
export default function Positions() {
  return import.meta.env.VITE_MOCK ? <MockPositions /> : <LivePositions />;
}
