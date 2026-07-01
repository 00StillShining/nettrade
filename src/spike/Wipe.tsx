import styles from "./Wipe.module.css";

// Clip-path screen-transition (Persona-5-kinetic "deeper" wipe).
// Animates ONLY clip-path + transform + opacity via a CSS @keyframes.
//
// Hard rule #8 (WKWebView clip-path staleness): the caller MUST pass a fresh
// `runId` on every transition and use it to force a brand-new DOM node
// (via `key` at the call site) so the GPU clip-path layer is never reused
// stale between wipes.
export default function Wipe({ active, runId }: { active: boolean; runId: number }) {
  if (!active) return null;
  return <div key={runId} className={styles.wipe} />;
}
