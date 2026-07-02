import { useEffect, useRef } from "react";
import { DESTINATIONS } from "./destinations";
import { useAnimus } from "./animusStore";
import styles from "./Labels.module.css";

// ---------------------------------------------------------------------------
// Labels — the projected 2D label overlay (VISUAL_DIRECTION §5: "projected 2D
// overlay, NEVER 3D-baked text"). A NON-interactive DOM sibling of the canvas
// (pointer-events:none): it only DISPLAYS. Each label registers its DOM node
// into the store's labelSlots; the in-Canvas projector (AnimusScene) writes
// screen-space transforms straight onto those nodes each rendered frame — so
// there's no per-frame React re-render and no second rAF loop here.
//
// Anti-brick #3: labels are display-only DOM; selection input is keyboard +
// canvas raycast, never DOM buttons positioned over the 3D (that caused the
// visual-vs-hit-test drift bug). Anti-brick #4: only transform+opacity animate,
// both written imperatively by the projector.
// ---------------------------------------------------------------------------
export default function Labels() {
  const { selected, labelSlots, invalidate } = useAnimus();
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  // Register each label's DOM node into the shared slots so the projector can
  // position it, then kick ONE render so the in-Canvas projector writes the
  // first screen positions immediately (the scene may have already settled to
  // still before this overlay mounted; without this kick the labels would sit
  // unpositioned until the next selection change). One invalidate, then idle.
  useEffect(() => {
    const slots = labelSlots.current;
    refs.current.forEach((el, i) => {
      if (slots[i]) slots[i].el = el;
    });
    invalidate();
    return () => {
      refs.current.forEach((_, i) => {
        if (slots[i]) slots[i].el = null;
      });
    };
  }, [labelSlots, invalidate]);

  return (
    <div className={styles.overlay} aria-hidden="true">
      {DESTINATIONS.map((d, i) => (
        <div
          key={d.route}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={`${styles.label} ${i === selected ? styles.selected : ""}`}
        >
          <span className={styles.leader} />
          <span className={styles.text}>
            {i === selected && <span className={styles.diamond}>◆</span>}
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}
