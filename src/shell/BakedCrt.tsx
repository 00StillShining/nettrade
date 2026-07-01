import styles from "./BakedCrt.module.css";

// Baked CRT overlay (hard rule #2 in the Phase-1 brief / actuality-ui skill §7):
// static + inert. gradients / box-shadow / border-radius ONLY. No
// mix-blend-mode, no backdrop-filter, no filter, no feDisplacementMap, no
// per-frame animation. When `suspended`, fully removed from compositing
// (render null) — reserved for use during future wipe transitions so it
// never competes with the transition's GPU layer. Phase 1 has no
// transitions yet, so this stays always-on.
//
// Curved-tube look is a pure optical illusion built from stacked inert
// layers (heavy rounded bezel, inward-curving edge vignette, a soft convex
// "glass sheen" highlight, present scanlines + a faint aperture-grille, and
// a rim-light bezel) — never a geometry distortion or live filter.
export default function BakedCrt({ suspended }: { suspended?: boolean }) {
  if (suspended) return null;

  return (
    <div className={styles.crt}>
      <div className={styles.tubeInset}>
        <div className={styles.vignette} />
        <div className={styles.edges} />
        <div className={styles.corner} />
        <div className={styles.sheen} />
        <div className={styles.scanlines} />
        <div className={styles.grille} />
        <div className={styles.fringe} />
        <div className={styles.bezel} />
        <div className={styles.glass} />
      </div>
    </div>
  );
}
