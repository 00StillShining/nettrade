import { useMemo, useState } from "react";
import Chrome from "../../shell/Chrome";
import { MOCK_WATCHLIST, type WatchItem } from "../../data/mockWatchlist";
import { tickerInitials, tickerMotif } from "../positions/tickerGlyph";
import WatchDetailModal from "./WatchDetailModal";
import { fmtAsOfTime, fmtMinor, fmtPct, Triangle } from "../shared/format";
import s from "./Watchlist.module.css";

/**
 * Watchlist — the SDN roster-card strip "at rest" (VISUAL_DIRECTION.md §5
 * "Watchlist", SCREEN_PATTERNS.md §7 the locked cream-paper recipe).
 * Function-first (actuality-ui skill §1-2): answers ONE question — "what am I
 * watching, and has anything moved enough to care?" — via the SAME grid
 * grammar as Positions, but quieter: neutral ribbons, no P/L glow, a smaller
 * day-move row (a day tick is not your money). Same shell/data-wiring
 * pattern as Positions: Chrome handles the dark frame + telemetry/status
 * bars; this screen owns only the cream content between them.
 *
 * Data is HONEST delayed/EOD quote shape only (Twelve Data / Alpha Vantage
 * free-tier fields) — no bid/ask spread, no invented time-series. There is no
 * live feed yet, so the live container renders the same honest empty state
 * Positions uses for "no key" rather than fabricate a list.
 */

interface WatchlistData {
  items: WatchItem[];
  /** Whether a market-data feed is actually connected (there isn't one yet). */
  connected: boolean;
  lastSyncISO: string | null;
}

/** Quieter version of Positions' TickerGlyph (VISUAL_DIRECTION.md §5:
 * "quieter portraits") — same deterministic shapes/initials from
 * tickerGlyph.ts, rendered at lower opacity / duller ink via a LOCAL CSS
 * override class. tickerGlyph.ts and Positions' own glyph styles are
 * untouched (scope-element-changes discipline). */
function QuietTickerGlyph({ ticker }: { ticker: string }) {
  const initials = tickerInitials(ticker);
  const motif = tickerMotif(ticker);
  const cx = 30 + motif.seedA * 40;
  const cy = 20 + motif.seedB * 30;
  const r = 10 + motif.seedC * 14;

  return (
    <div className={s.glyphQuiet} aria-hidden="true">
      <svg className={s.glyphQuietSvg} viewBox="0 0 80 60" preserveAspectRatio="xMidYMid slice">
        <g transform={`rotate(${motif.rotate} 40 30)`} opacity="0.5">
          {motif.variant === 0 && <circle cx={cx} cy={cy} r={r} className={s.glyphQuietShape} />}
          {motif.variant === 1 && (
            <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} className={s.glyphQuietShape} />
          )}
          {motif.variant === 2 && (
            <polygon
              points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`}
              className={s.glyphQuietShape}
            />
          )}
          {motif.variant === 3 && (
            <>
              <circle cx={cx - r * 0.5} cy={cy} r={r * 0.6} className={s.glyphQuietShape} />
              <circle cx={cx + r * 0.5} cy={cy} r={r * 0.6} className={s.glyphQuietShape} />
            </>
          )}
          {motif.variant === 4 && (
            <rect
              x={cx - r}
              y={cy - r * 0.4}
              width={r * 2}
              height={r * 0.8}
              transform={`rotate(45 ${cx} ${cy})`}
              className={s.glyphQuietShape}
            />
          )}
        </g>
      </svg>
      <span className={s.glyphQuietInitials}>{initials}</span>
    </div>
  );
}

/** One roster card — "at rest" (VISUAL_DIRECTION.md §5): neutral ribbon + a
 * small teal market chip, quieter glyph, a smaller day-move row than
 * Positions' P/L row, freshness pill + as-of time in the foot. */
function WatchCard({ item, onSelect }: { item: WatchItem; onSelect: (w: WatchItem) => void }) {
  const dayChangeMinor = item.priceMinor - item.prevCloseMinor;
  const dayChangePct = item.prevCloseMinor > 0 ? dayChangeMinor / item.prevCloseMinor : null;
  const flat = dayChangeMinor === 0;
  const up = dayChangeMinor > 0;

  return (
    <div
      className={s.card}
      tabIndex={0}
      role="button"
      aria-label={`${item.ticker} — open dossier`}
      onClick={() => onSelect(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(item);
        }
      }}
    >
      <div className={s.ribbon}>
        <span className={s.ribbonTicker}>{item.ticker}</span>
        <span className={s.marketChip}>{item.market}</span>
      </div>

      <div className={s.body}>
        <div className={s.topRow}>
          <QuietTickerGlyph ticker={item.ticker} />
          <div className={s.nameCol}>
            <div className={s.name}>{item.name}</div>
            <div className={s.qty}>{item.currency}</div>
          </div>
        </div>

        <div className={s.priceRow}>
          <div className={s.priceLabel}>Price</div>
          <div className={s.price}>{fmtMinor(item.priceMinor, item.currency)}</div>
        </div>

        <div className={flat ? s.dayRow : `${s.dayRow} ${up ? s.gain : s.loss}`}>
          {!flat && <Triangle up={up} className={s.dayTri} />}
          <span className={s.dayValue}>
            {flat
              ? fmtMinor(0, item.currency)
              : `${up ? "+" : "−"}${fmtMinor(Math.abs(dayChangeMinor), item.currency)}`}
          </span>
          {dayChangePct !== null && !flat && (
            <span className={s.dayPct}>
              ({up ? "+" : "−"}
              {fmtPct(dayChangePct)})
            </span>
          )}
        </div>

        <p className={s.note}>{item.note}</p>

        <div className={s.footRow}>
          <span className={s.freshPill}>{item.freshness}</span>
          <span className={s.asOf}>AS OF {fmtAsOfTime(item.asOfISO)}</span>
        </div>
      </div>
    </div>
  );
}

function WatchlistView({ items, connected, lastSyncISO }: WatchlistData) {
  const [selected, setSelected] = useState<WatchItem | null>(null);

  // TOP MOVER — the item with max |dayChangePct|, honest from the quote data,
  // never invented ranking. null when there's nothing to watch or every
  // prevClose is degenerate (0).
  const topMover = useMemo(() => {
    let best: { item: WatchItem; pct: number } | null = null;
    for (const item of items) {
      if (item.prevCloseMinor <= 0) continue;
      const pct = (item.priceMinor - item.prevCloseMinor) / item.prevCloseMinor;
      if (best === null || Math.abs(pct) > Math.abs(best.pct)) best = { item, pct };
    }
    return best;
  }, [items]);

  const connection: "ok" | "no-key" = connected ? "ok" : "no-key";
  const showEmpty = !connected;

  return (
    <Chrome
      title="WATCHLIST"
      env={import.meta.env.VITE_MOCK ? "demo" : "live"}
      accountLabel="DEFAULT"
      connection={connection}
      lastSyncISO={lastSyncISO}
      positionsCount={null}
      rateLimitNote="1 req/s"
    >
      {/* When the dossier dialog is open, mark the background screen `inert` so
          roving screen-reader cursors (and Tab) can't reach the cards behind it
          — aria-modal alone doesn't isolate the DOM (nit a11y fix). */}
      <div className={s.screen} inert={selected ? true : undefined}>
        {/* ============================== HERO ============================== */}
        <section className={s.hero} aria-label="Watchlist summary">
          <div className={s.heroRibbon}>Watchlist</div>
          <div className={s.heroRow}>
            <div className={s.heroStat}>
              <div className={s.heroLabel}>Watching</div>
              <div className={s.heroValue}>{items.length}</div>
            </div>
            <div className={s.heroStat}>
              <div className={s.heroLabel}>Top Mover</div>
              <div className={`${s.heroValue} ${s.heroValueSm} ${topMover && topMover.pct !== 0 ? (topMover.pct > 0 ? s.gain : s.loss) : ""}`}>
                {topMover ? (
                  topMover.pct === 0 ? (
                    <>
                      {topMover.item.ticker} {fmtPct(0)}
                    </>
                  ) : (
                    <>
                      <Triangle up={topMover.pct > 0} className={s.heroTri} />
                      {topMover.item.ticker} {topMover.pct > 0 ? "+" : "−"}
                      {fmtPct(topMover.pct)}
                    </>
                  )
                ) : (
                  "—"
                )}
              </div>
            </div>
            <div className={s.heroStat}>
              <div className={s.heroLabel}>Quotes</div>
              <div className={`${s.heroValue} ${s.heroValueSm}`}>{connected ? "DELAYED/EOD" : "—"}</div>
            </div>
          </div>
          <div className={s.heroFoot}>
            <p className={s.heroNote}>
              Instruments you follow but do not hold — delayed/EOD quotes, never live.
            </p>
          </div>
        </section>

        {/* ============================== STATE NOTES ============================== */}
        {showEmpty && (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>No market-data feed connected</div>
            <p>
              Watchlist quotes need a free delayed/EOD feed (Twelve Data / Alpha Vantage) — connect one in Settings
              when it lands. Until then this screen runs on placeholder data in MOCK builds.
            </p>
          </div>
        )}

        {/* ============================== ROSTER GRID ============================== */}
        {!showEmpty && (
          <section className={s.panel} aria-label="Watch roster">
            <div className={s.panelHead}>
              <span className={s.panelTitle}>Watch Roster</span>
              <span className={s.panelMeta}>{items.length} watched &middot; delayed/EOD</span>
            </div>
            <div className={s.gridScroll}>
              <div className={s.grid}>
                {items.map((item) => (
                  // market+ticker, not ticker alone — the same symbol can list on
                  // two venues (e.g. LSE "RR" vs a US "RR"); this is the identity
                  // chartUrl already treats as canonical. Carries into live data.
                  <WatchCard key={`${item.market}:${item.ticker}`} item={item} onSelect={setSelected} />
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      {selected && <WatchDetailModal item={selected} onClose={() => setSelected(null)} />}
    </Chrome>
  );
}

/** Live container — no market-data feed exists yet, so this honestly renders
 * the "not connected" empty state rather than fabricate a list or call any
 * network API. Wire a real hook here once a delayed/EOD feed is chosen. */
function LiveWatchlist() {
  return <WatchlistView items={[]} connected={false} lastSyncISO={null} />;
}

/** Mock container — placeholder data for design iteration (VITE_MOCK builds).
 * Never touches the Keychain/API/network, so no prompts while we tune the UI. */
function MockWatchlist() {
  const [lastSync] = useState(() => new Date(Date.now() - 90_000).toISOString());
  return <WatchlistView items={MOCK_WATCHLIST} connected={true} lastSyncISO={lastSync} />;
}

/** Build-time switch: VITE_MOCK => placeholder data; else the honest
 * no-feed-yet live container. The unused branch is tree-shaken since
 * VITE_MOCK is a compile-time constant. */
export default function Watchlist() {
  return import.meta.env.VITE_MOCK ? <MockWatchlist /> : <LiveWatchlist />;
}
