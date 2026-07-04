/* =========================================================================
   TERMINAL 77 — statusChip (ported from prototypes/terminal-77)

   ink/teal WORD + SHAPE classification chip. Severity is expressed by PIPS
   (filled vs hollow, 1–4) + border weight — NEVER by green/red/orange (those
   are market-number colours only; §1 palette law enforced structurally).
   `level` is an ordinal: 'ok'|'warn'|'high'|'severe'. `pips` (0–4) overrides
   the auto pip count; `na` renders a dashed N/A chip (for BTC/ETH on
   CANSLIM/DIVPULL — not-applicable, never zero-scored).

   TWO FORMS, one truth: the <StatusChip> component for JSX call sites, and
   statusChipHtml() for screens that build ledger rows as HTML strings (the
   prototype's render style — Scanner/Alerts inject whole <tr> strings).
   ========================================================================= */

import { clamp } from "../engine/dataEngine";

export type ChipLevel = "ok" | "warn" | "high" | "severe";

const STATUSCHIP_SEV: Record<ChipLevel, { cls: string; pips: number }> = {
  ok:     { cls: "sev-ok",     pips: 1 },
  warn:   { cls: "sev-warn",   pips: 2 },
  high:   { cls: "sev-high",   pips: 3 },
  severe: { cls: "sev-severe", pips: 4 },
};

export interface StatusChipProps {
  word: string;
  level?: ChipLevel | string; // unknown grades fall back to warn (prototype behaviour)
  pips?: number;
  na?: boolean;
}

/** Prototype statusChip(word, level, opts) → HTML string (for innerHTML rows). */
export function statusChipHtml(word: string, level?: string, opts: { pips?: number; na?: boolean } = {}): string {
  if (opts.na) {
    return `<span class="statuschip na" title="not applicable to this instrument">` +
      `<span class="pips"><span class="pip"></span><span class="pip"></span><span class="pip"></span><span class="pip"></span></span>` +
      `${word}</span>`;
  }
  const sev = STATUSCHIP_SEV[level as ChipLevel] || { cls: "sev-warn", pips: 2 };
  const n = opts.pips != null ? clamp(opts.pips | 0, 0, 4) : sev.pips;
  let pips = ""; for (let i = 0; i < 4; i++) pips += `<span class="pip${i < n ? " f" : ""}"></span>`;
  return `<span class="statuschip ${sev.cls}"><span class="pips">${pips}</span>${word}</span>`;
}

/** JSX form — identical markup/classes, so terminal.css styles both. */
export default function StatusChip({ word, level, pips, na }: StatusChipProps) {
  if (na) {
    return (
      <span className="statuschip na" title="not applicable to this instrument">
        <span className="pips"><span className="pip" /><span className="pip" /><span className="pip" /><span className="pip" /></span>
        {word}
      </span>
    );
  }
  const sev = STATUSCHIP_SEV[level as ChipLevel] || { cls: "sev-warn", pips: 2 };
  const n = pips != null ? clamp(pips | 0, 0, 4) : sev.pips;
  return (
    <span className={`statuschip ${sev.cls}`}>
      <span className="pips">
        {[0, 1, 2, 3].map((i) => <span key={i} className={"pip" + (i < n ? " f" : "")} />)}
      </span>
      {word}
    </span>
  );
}
