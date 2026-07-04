/* =========================================================================
   TERMINAL 77 — DOM MICRO-HELPERS (ported verbatim from prototypes/terminal-77)

   setTickText — the digit-level tick flash. THIS is the port's update
   discipline for every live numeral: screens render EMPTY spans in JSX (so
   React never claims their text) and route each tick's value through this
   helper against a ref. Changed digits flash gain-green / loss-brick for
   300ms via inline color + transition — colour-only, no layout, no reflow
   beyond the span swap, exactly the prototype's behaviour.
   ========================================================================= */

export function setTickText(el: HTMLElement | null, text: string): void {
  if (!el) { return; }
  const old = el.dataset.val || "";
  if (old === text || !old) { el.textContent = text; el.dataset.val = text; return; }
  // determine direction from numeric parse
  const nOld = parseFloat(old.replace(/[^0-9.-]/g, "")) || 0;
  const nNew = parseFloat(text.replace(/[^0-9.-]/g, "")) || 0;
  const col = nNew >= nOld ? "#4CAF6E" : "#B23A2F";
  // build digit spans, flash the ones that changed
  const frag = document.createDocumentFragment();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]; const changed = old[i] !== ch;
    if (changed && /[0-9]/.test(ch)) {
      const s = document.createElement("span"); s.textContent = ch; s.style.color = col; s.style.transition = "color .3s";
      frag.appendChild(s); setTimeout(() => { s.style.color = ""; }, 300);
    } else { frag.appendChild(document.createTextNode(ch)); }
  }
  el.textContent = ""; el.appendChild(frag); el.dataset.val = text;
}
