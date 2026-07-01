import { useCallback, useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { WatchItem } from "../../data/mockWatchlist";
import { fmtAsOfTime, fmtMinor, fmtPct, Triangle } from "../shared/format";
import s from "./WatchDetailModal.module.css";

/**
 * WatchDetailModal — the mini-dossier that opens when a watch card is
 * clicked (VISUAL_DIRECTION.md §5 Watchlist: "selecting one can wipe into a
 * mini-dossier — price, spread, your note"). We don't have bid/ask spread on
 * a free delayed/EOD feed, so the honest field in its place is DAY RANGE
 * (low—high), which the feed actually returns — never invent a spread.
 * Smaller than PositionDetailModal (this is a quote lookup, not a full P/L
 * dossier): single column, ~64vw x ~60vh capped ~820x560.
 *
 * Interaction code (scrim/Esc/focus-trap/focus-restore/close X) copied
 * VERBATIM from PositionDetailModal.tsx — same pattern, smaller content.
 */

interface Props {
  item: WatchItem;
  onClose: () => void;
}

/** One bold-label / mono-value dossier row (the SDN key/value grammar). */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.row}>
      <span className={s.rowLabel}>{label}</span>
      <span className={s.rowValue}>{value}</span>
    </div>
  );
}

/** Spelled-out freshness label for the dossier row (the honest data-scope
 * disclosure — never let "D15"/"EOD" stand alone in the detail view). */
function freshnessLabel(freshness: WatchItem["freshness"]): string {
  return freshness === "D15" ? "DELAYED 15M" : "END OF DAY";
}

/** External chart target — exchange-qualified so ambiguous tickers (LSE "RR"
 * vs the US "RR") resolve to the RIGHT instrument; the watch item knows its venue. */
function chartUrl(ticker: string, market: string): string {
  return `https://www.tradingview.com/symbols/${encodeURIComponent(market)}-${encodeURIComponent(ticker)}/`;
}

export default function WatchDetailModal({ item, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the close control on open + Esc to close; restore focus to the
  // opening watch card on close (copied verbatim from PositionDetailModal).
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

  const dayChangeMinor = item.priceMinor - item.prevCloseMinor;
  const dayChangePct = item.prevCloseMinor > 0 ? dayChangeMinor / item.prevCloseMinor : null;
  const flat = dayChangeMinor === 0;
  const up = dayChangeMinor > 0;

  const openChart = useCallback(async () => {
    const url = chartUrl(item.ticker, item.market);
    try {
      // Real .app: launches the system browser via the Tauri opener plugin.
      await openUrl(url);
    } catch {
      // Dev/preview (plain browser, no Tauri IPC): fall back to a new tab.
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [item.ticker, item.market]);

  return (
    <div
      className={s.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className={s.dialog} role="dialog" aria-modal="true" aria-label={`${item.ticker} watch detail`}>
        {/* ---- Ribbon: neutral "at rest" (matches the card) + market chip + close ---- */}
        <div className={s.ribbon}>
          <div className={s.ribbonLeft}>
            <span className={s.ribbonSymbol}>{item.ticker}</span>
            <span className={s.ribbonName}>{item.name}</span>
            <span className={s.marketChip}>{item.market}</span>
          </div>
          <button ref={closeRef} type="button" className={s.close} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5 L15 15 M15 5 L5 15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ---- Scrollable body (viewport-lock discipline: never clip) ---- */}
        <div className={s.body}>
          <section className={s.priceHero}>
            <div className={s.priceLabel}>Price</div>
            <div className={s.priceValue}>{fmtMinor(item.priceMinor, item.currency)}</div>
            <div className={flat ? s.dayRow : `${s.dayRow} ${up ? s.gain : s.loss}`}>
              {!flat && <Triangle up={up} className={s.dayTri} />}
              <span>
                {flat
                  ? fmtMinor(0, item.currency)
                  : `${up ? "+" : "−"}${fmtMinor(Math.abs(dayChangeMinor), item.currency)}`}
              </span>
              {dayChangePct !== null && !flat && (
                <span className={s.dayPct}>
                  ({up ? "+" : "−"}
                  {fmtPct(dayChangePct)} vs prev close)
                </span>
              )}
            </div>
          </section>

          <section className={s.dossier}>
            <Row label="Prev close" value={fmtMinor(item.prevCloseMinor, item.currency)} />
            <Row
              label="Day range"
              value={`${fmtMinor(item.dayLowMinor, item.currency)} — ${fmtMinor(item.dayHighMinor, item.currency)}`}
            />
            <Row label="As of" value={`${fmtAsOfTime(item.asOfISO)} · ${freshnessLabel(item.freshness)}`} />
            <Row label="Market" value={item.market} />
            <Row label="Currency" value={item.currency} />
          </section>

          <div className={s.noteCard}>
            <div className={s.noteLabel}>Your note</div>
            <div className={s.noteBody}>{item.note}</div>
          </div>
        </div>

        {/* ---- Foot: honest one-liner + the external chart action ---- */}
        <div className={s.foot}>
          <p className={s.footNote}>Delayed/EOD quote — for the live chart open the official page.</p>
          <button type="button" className={s.chartBtn} onClick={() => void openChart()}>
            Open chart ↗
          </button>
        </div>
      </div>
    </div>
  );
}
