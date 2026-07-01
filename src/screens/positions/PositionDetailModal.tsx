import { useCallback, useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Position } from "../../adapters/trading212";
import { tickerInitials, tickerMotif } from "./tickerGlyph";
import { fmtMinor, fmtQty, fmtPct, Triangle } from "../shared/format";
import s from "./PositionDetailModal.module.css";

/**
 * PositionDetailModal — the ~80%-screen dossier that opens when a roster card
 * is clicked (SCREEN_PATTERNS.md §7 cream-paper recipe; actuality-ui skill §1
 * function-first + §5 SDN dossier grammar). Answers ONE deeper question about
 * a single holding — "how is THIS position doing, in full?" — from the HONEST
 * data we hold (Trading 212 positions: qty, avg/current price, value, cost,
 * unrealised P/L, allocation). NO fabricated candle/time-series: detailed
 * charting is deferred to the official page (opened externally), which the
 * user chose over wiring a delayed/rate-limited market feed.
 *
 * Anti-brick (actuality-ui §7): the scrim is a plain rgba dim — NO
 * backdrop-filter, NO blend, NO live filter; the paper-grain is the same inert
 * static data-URI every panel uses; the open animation touches only transform
 * + opacity. Rendered inside the screen, so it sits beneath the baked CRT like
 * every other cream surface (the centre-clear vignette keeps it legible).
 */

interface Props {
  position: Position;
  /** Portfolio total (minor units, account ccy) — for the allocation %. */
  totalValue: number;
  onClose: () => void;
}

/** The GENERATED portrait mark, larger than the card's — same deterministic
 * motif seeded from the ticker (never a fetched/real logo). */
function GlyphArt({ ticker }: { ticker: string }) {
  const motif = tickerMotif(ticker);
  const cx = 30 + motif.seedA * 40;
  const cy = 20 + motif.seedB * 30;
  const r = 10 + motif.seedC * 14;
  return (
    <div className={s.glyph} aria-hidden="true">
      <svg className={s.glyphSvg} viewBox="0 0 80 60" preserveAspectRatio="xMidYMid slice">
        <g transform={`rotate(${motif.rotate} 40 30)`} opacity="0.5">
          {motif.variant === 0 && <circle cx={cx} cy={cy} r={r} className={s.glyphShape} />}
          {motif.variant === 1 && <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} className={s.glyphShape} />}
          {motif.variant === 2 && (
            <polygon points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`} className={s.glyphShape} />
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
      <span className={s.glyphInitials}>{tickerInitials(ticker)}</span>
    </div>
  );
}

/** One bold-label / mono-value dossier row (the SDN key/value grammar). */
function Row({ label, value, tone, mono }: { label: string; value: string; tone?: "gain" | "loss"; mono?: boolean }) {
  return (
    <div className={s.row}>
      <span className={s.rowLabel}>{label}</span>
      <span className={`${s.rowValue} ${tone ? s[tone] : ""} ${mono ? s.rowValueMono : ""}`}>{value}</span>
    </div>
  );
}

/** One stamped stat for the P/L ANATOMY row — label above, mono signed value
 * (+ drawn triangle) below. Exactly-zero renders in neutral --ink with no
 * triangle (honest — there is no direction to claim). */
function AnatomyStat({ label, minor, ccy }: { label: string; minor: number; ccy: string | null }) {
  const isZero = minor === 0;
  const isUp = minor > 0;
  return (
    <div className={s.anatomyStat}>
      <div className={s.anatomyLabel}>{label}</div>
      <div className={`${s.anatomyValue} ${isZero ? "" : isUp ? s.gain : s.loss}`}>
        {!isZero && <Triangle up={isUp} className={s.anatomyTri} />}
        {isZero ? fmtMinor(0, ccy) : `${isUp ? "+" : "−"}${fmtMinor(Math.abs(minor), ccy)}`}
      </div>
    </div>
  );
}

/** One horizontal bar for the COST VS VALUE comparison — static width % of a
 * shared scale, mono amount stamped to the right. Never animated (fix 4d). */
function CompareBar({ label, minor, ccy, pct, tone }: { label: string; minor: number; ccy: string | null; pct: number; tone: "cost" | "gain" | "loss" }) {
  return (
    <div className={s.compareRow}>
      <span className={s.compareLabel}>{label}</span>
      <div className={s.compareTrack}>
        <div className={`${s.compareFill} ${s[`compareFill_${tone}`]}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={s.compareValue}>{fmtMinor(minor, ccy)}</span>
    </div>
  );
}

/**
 * External chart target — the official public page for this symbol (full
 * candles, all intervals/ranges the user listed). TradingView's symbol page
 * resolves the exchange automatically; swap the base here for Yahoo/Google/etc.
 * if preferred. We strip Trading 212's `_US_EQ`-style suffix to the bare symbol.
 */
function chartUrl(ticker: string): string {
  const symbol = ticker.split("_")[0];
  return `https://www.tradingview.com/symbols/${encodeURIComponent(symbol)}/`;
}

export default function PositionDetailModal({ position, totalValue, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the close control on open (obvious, reversible exit) + Esc to close;
  // restore focus to the opening roster card on close so a keyboard user
  // doesn't lose their place in the grid.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab inside the dialog — without this, keyboard focus can walk
      // out into the dimmed roster/status bar behind the scrim.
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, a[href], [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !dialogRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const plZero = position.unrealizedPlMinor === 0;
  const up = position.unrealizedPlMinor >= 0;
  const plPct = position.totalCostMinor > 0 ? position.unrealizedPlMinor / position.totalCostMinor : null;
  const alloc = totalValue > 0 ? position.currentValueMinor / totalValue : null;
  const priceMovePct =
    position.avgPriceMinor > 0 ? (position.currentPriceMinor - position.avgPriceMinor) / position.avgPriceMinor : null;
  // Gauge must be PRICE-PURE (fix 1): share-price move only, instrument ccy —
  // never the account-ccy P/L (which also carries FX). A holding can be up on
  // price but down overall (or vice-versa) once FX is folded in; conflating the
  // two here would be dishonest. `up` above stays for the hero, which IS P/L.
  const priceUp = priceMovePct === null ? true : priceMovePct >= 0;
  const priceZero = priceMovePct === 0;

  // Avg-cost gauge marker: centre = your average cost (NOT "break-even" — true
  // break-even only equals avg cost when instrument ccy === account ccy; FX can
  // shift the real break-even off this tick). Marker offsets toward the
  // cheaper/dearer side. Honest — it is literally your two real prices, no time
  // axis invented. ±20% move reaches the gauge edge.
  const gaugePos = priceMovePct === null ? 50 : 50 + Math.max(-46, Math.min(46, priceMovePct * 230));
  // Beyond the ±20% scale the marker pins at the clamp — flag it so a pinned
  // marker never silently claims a proportional position (honest-data).
  const gaugeClamped = priceMovePct !== null && Math.abs(priceMovePct) > 0.2;

  const symbol = position.ticker.split("_")[0];
  const sameCcy = position.instrumentCurrency !== null && position.instrumentCurrency === position.accountCurrency;

  // P/L ANATOMY (fix 4c) — honest decomposition of the account-ccy P/L into the
  // share-price move vs the currency move. Only meaningful when the instrument
  // trades in a different currency to the account; same-ccy holdings have zero
  // FX effect by construction, so we skip the row entirely rather than show a
  // misleading "0 FX" line.
  const priceEffectMinor = position.unrealizedPlMinor - position.fxImpactMinor;
  const fxEffectMinor = position.fxImpactMinor;
  // Collapse to a single "Price Effect = Total" stat only when it's actually
  // true (same ccy AND zero FX impact) — belt-and-braces honesty in case the
  // API ever reports a nonzero FX impact alongside equal currencies.
  const collapsedAnatomy = sameCcy && position.fxImpactMinor === 0;

  // COST VS VALUE (fix 4d) — two-datum static comparison, no time axis.
  const costVsValueMax = Math.max(position.totalCostMinor, position.currentValueMinor);
  const costBarPct = costVsValueMax > 0 ? Math.max(0, (position.totalCostMinor / costVsValueMax) * 100) : 0;
  const valueBarPct = costVsValueMax > 0 ? Math.max(0, (position.currentValueMinor / costVsValueMax) * 100) : 0;
  const valueUp = position.currentValueMinor >= position.totalCostMinor;

  const openChart = useCallback(async () => {
    const url = chartUrl(position.ticker);
    try {
      // Real .app: launches the system browser via the Tauri opener plugin.
      await openUrl(url);
    } catch {
      // Dev/preview (plain browser, no Tauri IPC): fall back to a new tab.
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [position.ticker]);

  return (
    <div
      className={s.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className={s.dialog} role="dialog" aria-modal="true" aria-label={`${symbol} position detail`}>
        {/* ---- Ribbon: symbol + name, P/L-coloured (matches the card) + close ---- */}
        <div className={`${s.ribbon} ${plZero ? s.ribbonFlat : up ? s.ribbonGain : s.ribbonLoss}`}>
          <div className={s.ribbonLeft}>
            <span className={s.ribbonSymbol}>{symbol}</span>
            <span className={s.ribbonName}>{position.name ?? position.ticker}</span>
          </div>
          <button ref={closeRef} type="button" className={s.close} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5 L15 15 M15 5 L5 15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ---- Scrollable body (viewport-lock discipline: never clip) ----
            Two-column SDN dossier grid (fix 4): left main column + right
            rail, so the dialog's height is earned by real content instead of
            trailing off into empty cream (SCREEN_PATTERNS §1 fill-the-space). */}
        <div className={s.body}>
          {/* ---- LEFT: hero + gauge + the two honest breakdown panels ---- */}
          <div className={s.main}>
            {/* HERO — the single answer: value + how it's doing. Stays
                coloured by account-ccy P/L (it is literally labelled
                Unrealised P/L — that is honest); only the gauge below
                becomes price-pure. */}
            <section className={s.heroBand}>
              <GlyphArt ticker={position.ticker} />
              <div className={s.heroStat}>
                <div className={s.heroLabel}>Market Value</div>
                <div className={s.heroValue}>{fmtMinor(position.currentValueMinor, position.accountCurrency)}</div>
              </div>
              <div className={s.heroStat}>
                <div className={s.heroLabel}>Unrealised P/L</div>
                <div className={`${s.heroValue} ${plZero ? "" : up ? s.gain : s.loss}`}>
                  {!plZero && <Triangle up={up} className={s.heroTri} />}
                  {!plZero && (up ? "+" : "−")}
                  {fmtMinor(Math.abs(position.unrealizedPlMinor), position.accountCurrency)}
                  {plPct !== null && !plZero && (
                    <span className={s.heroPct}>
                      ({up ? "+" : "−"}
                      {fmtPct(plPct)})
                    </span>
                  )}
                </div>
              </div>
            </section>

            {/* GAUGE — PRICE-PURE (fix 1): marker colour, meta sign and meta
                colour all derive from priceMovePct (share-price move, instrument
                ccy) — never from `up` (account-ccy P/L, which also carries FX).
                For FX-exposed holdings those two can disagree; conflating them
                was the dishonest bug this fixes. Centre tick reads "avg cost",
                not "break-even" — true break-even only equals avg cost when
                instrumentCurrency === accountCurrency. */}
            <section className={s.gauge}>
              <div className={s.gaugeHead}>
                <span className={s.gaugeLabel}>Share price vs your avg cost</span>
                <span className={`${s.gaugeMeta} ${priceMovePct === null || priceZero ? "" : priceUp ? s.gain : s.loss}`}>
                  {priceMovePct !== null && !priceZero && <Triangle up={priceUp} className={s.gaugeMetaTri} />}
                  {priceMovePct !== null
                    ? priceZero
                      ? `0.0% vs avg (${position.instrumentCurrency ?? "—"})`
                      : `${priceUp ? "+" : "−"}${fmtPct(priceMovePct)} vs avg (${position.instrumentCurrency ?? "—"})`
                    : "—"}
                </span>
              </div>
              <div className={s.gaugeTrack}>
                <div className={s.gaugeMid} />
                {/* No marker when the move is unknowable (degenerate avg price):
                    an empty track matches the em-dash meta instead of silently
                    claiming "price at avg cost". */}
                {priceMovePct !== null && (
                  <div
                    className={`${s.gaugeMarker} ${priceZero ? s.markerFlat : priceUp ? s.markerGain : s.markerLoss}`}
                    style={{ left: `${gaugePos}%` }}
                  />
                )}
              </div>
              <div className={s.gaugeScale}>
                <span>
                  {gaugeClamped && !priceUp ? "‹ " : ""}−20%
                </span>
                <span className={s.gaugeAvgCost}>avg cost</span>
                <span>
                  +20%{gaugeClamped && priceUp ? " ›" : ""}
                </span>
              </div>
              <div className={s.gaugePrices}>
                <span>AVG {fmtMinor(position.avgPriceMinor, position.instrumentCurrency)}</span>
                <span>NOW {fmtMinor(position.currentPriceMinor, position.instrumentCurrency)}</span>
              </div>
            </section>

            {/* P/L ANATOMY — honest decomposition: price move vs currency move.
                Same-ccy holdings have zero FX effect by construction, so we
                skip the FX stat + note rather than show a misleading 0 row. */}
            <section className={s.anatomy}>
              <div className={s.sectionLabel}>P/L Anatomy</div>
              <div className={s.anatomyRow}>
                {collapsedAnatomy ? (
                  <AnatomyStat label="Price Effect = Total" minor={position.unrealizedPlMinor} ccy={position.accountCurrency} />
                ) : (
                  <>
                    <AnatomyStat label="Price Effect" minor={priceEffectMinor} ccy={position.accountCurrency} />
                    {/* Gate on the DATA, not just the ccy pair — if the API ever
                        reports nonzero FX alongside equal currencies, the stats
                        must still visibly reconcile (Price + FX = Total). */}
                    {(!sameCcy || position.fxImpactMinor !== 0) && (
                      <AnatomyStat label="FX Effect" minor={fxEffectMinor} ccy={position.accountCurrency} />
                    )}
                    <AnatomyStat label="Total" minor={position.unrealizedPlMinor} ccy={position.accountCurrency} />
                  </>
                )}
              </div>
              {(!sameCcy || position.fxImpactMinor !== 0) && (
                <p className={s.anatomyNote}>
                  Price effect is the share-price move; FX effect is the {position.instrumentCurrency ?? "—"}→
                  {position.accountCurrency ?? "—"} currency move.
                </p>
              )}
            </section>

            {/* COST VS VALUE — honest two-datum static comparison, no time axis. */}
            <section className={s.compare}>
              <div className={s.sectionLabel}>Cost vs Value</div>
              {costVsValueMax > 0 ? (
                <div className={s.compareRows}>
                  <CompareBar
                    label="Total Cost"
                    minor={position.totalCostMinor}
                    ccy={position.accountCurrency}
                    pct={costBarPct}
                    tone="cost"
                  />
                  <CompareBar
                    label="Market Value"
                    minor={position.currentValueMinor}
                    ccy={position.accountCurrency}
                    pct={valueBarPct}
                    tone={valueUp ? "gain" : "loss"}
                  />
                </div>
              ) : (
                <div className={s.compareRows}>
                  <div className={s.compareRow}>
                    <span className={s.compareLabel}>Total Cost</span>
                    <span className={s.compareValue}>—</span>
                  </div>
                  <div className={s.compareRow}>
                    <span className={s.compareLabel}>Market Value</span>
                    <span className={s.compareValue}>—</span>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* ---- RIGHT: the dossier rail (bold-label / mono-value pairs) ---- */}
          <aside className={s.rail}>
            <Row label="Quantity" value={`${fmtQty(position.quantity)} sh`} />
            <Row label="Allocation" value={alloc !== null ? fmtPct(alloc) : "—"} />
            <Row label="Avg price" value={fmtMinor(position.avgPriceMinor, position.instrumentCurrency)} />
            <Row label="Current price" value={fmtMinor(position.currentPriceMinor, position.instrumentCurrency)} />
            <Row label="Total cost" value={fmtMinor(position.totalCostMinor, position.accountCurrency)} />
            <Row label="Market value" value={fmtMinor(position.currentValueMinor, position.accountCurrency)} />
            <Row
              label="Unrealised P/L"
              tone={plZero ? undefined : up ? "gain" : "loss"}
              value={
                plZero
                  ? fmtMinor(0, position.accountCurrency)
                  : `${up ? "+" : "−"}${fmtMinor(Math.abs(position.unrealizedPlMinor), position.accountCurrency)}`
              }
            />
            {!sameCcy && (
              <Row
                label="of which FX"
                value={
                  position.fxImpactMinor === 0
                    ? fmtMinor(0, position.accountCurrency)
                    : `${position.fxImpactMinor >= 0 ? "+" : "−"}${fmtMinor(Math.abs(position.fxImpactMinor), position.accountCurrency)}`
                }
              />
            )}
            <Row label="Currency" value={`${position.instrumentCurrency ?? "—"} → ${position.accountCurrency ?? "—"}`} />
            {position.isin && <Row label="ISIN" value={position.isin} mono />}
          </aside>
        </div>

        {/* ---- Foot: honest note + the external chart action (pinned) ---- */}
        <div className={s.foot}>
          <p className={s.footNote}>
            Candle charts need a market-data feed (delayed/EOD) — planned with the Watchlist screen. For the full
            chart now — 15-min, hourly and daily candles, every range — open the official page.
          </p>
          <button type="button" className={s.chartBtn} onClick={() => void openChart()}>
            Open chart ↗
          </button>
        </div>
      </div>
    </div>
  );
}
