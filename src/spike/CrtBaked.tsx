import styles from "./CrtBaked.module.css";

// Baked CRT overlay (hard rule #3): static + inert.
// gradients / box-shadow ONLY. No mix-blend-mode, no backdrop-filter, no filter.
// When `suspended`, fully removed from compositing (display:none) — used during
// the wipe transition so it never competes with the transition's GPU layer.
export default function CrtBaked({ suspended }: { suspended: boolean }) {
  if (suspended) return null;

  return (
    <div className={styles.crt}>
      <div className={styles.vignette} />
      <div className={styles.corner} />
      <div className={styles.scanlines} />
      <div className={styles.bezel} />
      <div className={styles.glass} />
    </div>
  );
}
