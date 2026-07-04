/* =========================================================================
   TERMINAL 77 — segToggle (ported from prototypes/terminal-77 buildSegToggle)

   Orange-active-only segmented control. §1 PALETTE LAW enforced structurally:
   EXACTLY ONE .segbtn carries .on (the --orange active VERB); everything else
   is paper-dark/ink-soft. Optional `count` renders the small superscript
   match-count (the Scanner preset bar uses it). onPick fires only when an
   INACTIVE segment is clicked — clicking the active one is a no-op, exactly
   like the prototype.
   ========================================================================= */

export interface SegOption {
  key: string;
  label: string;
  count?: number | null;
}

export default function SegToggle({ options, active, onPick }: {
  options: SegOption[];
  active: string;
  onPick: (key: string) => void;
}) {
  return (
    <div className="segrow">
      {options.map((o) => (
        <button
          key={o.key}
          className={"segbtn" + (o.key === active ? " on" : "")}
          data-key={o.key}
          onClick={() => { if (o.key !== active) onPick(o.key); }}
        >
          {o.label}
          {o.count != null && <span className="segcount">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
