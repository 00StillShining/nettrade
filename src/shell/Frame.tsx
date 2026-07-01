import type { ReactNode } from "react";
import styles from "./Frame.module.css";

/**
 * Frame — the dark cinematic frame everything sits in (hard rule §1-2 of the
 * actuality-ui skill): near-black field, soft top-left light pool, faint
 * static facet lines, radial vignette, static grain texture. All decorative
 * layers are inert (pointer-events:none, no animation, no filters, no
 * blend modes). Real content renders in the content well above them.
 */
export default function Frame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.frame}>
      <div className={styles.lightPool} />
      <div className={styles.facets} />
      <div className={styles.vignette} />
      <div className={styles.grain} />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
