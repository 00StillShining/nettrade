/* =========================================================================
   TERMINAL 77 — table.ledger wrapper (optional convenience)

   The wire-format ledger look (sticky ink thead, mono tabular numerals,
   zebra paper rows) is ALL in terminal.css under `table.ledger` — this
   component only guarantees the class name so screens can't typo it.
   Inline <table className="ledger"> is equally fine (the brief allows it);
   screens that build rows as HTML strings should set them on <tbody>
   via dangerouslySetInnerHTML, keeping the header as JSX.
   ========================================================================= */

import type { ReactNode } from "react";

export default function Ledger({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={"ledger" + (className ? " " + className : "")}>{children}</table>;
}
