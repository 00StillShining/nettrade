/**
 * format — shared readout primitives for the data screens (Dashboard, Positions,
 * Watchlist + their detail modals). The money/qty/percent formatters + the drawn
 * ▲/▼ triangle were originally hand-synced, byte-identical copies across screens;
 * lifted here once so they can't quietly drift out of sync (behaviour unchanged
 * from those original four exports). fmtAsOfTime was added for the Watchlist's
 * as-of quote readouts.
 */

/** Money formatter — INTEGER MINOR UNITS in, locale currency string out. */
export function fmtMinor(minor: number, ccy: string | null): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: ccy || "GBP",
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${ccy || "GBP"} ${(minor / 100).toFixed(2)}`;
  }
}

/** Quantity formatter — up to 4 fraction digits, no trailing zero padding. */
export function fmtQty(n: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 4 }).format(n);
}

/** Percent formatter — 1 dp, magnitude only (sign applied by caller). */
export function fmtPct(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(n));
}

/** HH:MM (local) from an ISO timestamp, mono — the honest as-of readout. */
export function fmtAsOfTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Drawn ▲/▼ triangle — never an emoji/colour-only signal (honest-data rule).
 * Callers supply their own CSS-module className for sizing/placement. */
export function Triangle({ up, className }: { up: boolean; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 10 10" aria-hidden="true">
      {up ? <path d="M5 1 L9 8 L1 8 Z" fill="currentColor" /> : <path d="M5 9 L1 2 L9 2 Z" fill="currentColor" />}
    </svg>
  );
}
