import styles from "./MenuWipe.module.css";

// Dive transition wipe (menu → screen). Adapted VERBATIM in spirit from the
// Phase-0 spike's Wipe: a Persona-5 "deeper" clip-path sweep that animates
// ONLY clip-path + transform + opacity (anti-brick #4). It is ONE full-screen
// effect (#5) — run alongside the camera dolly, with the CRT suspended.
//
// WKWebView clip-path staleness (VISUAL_DIRECTION §4): the caller passes a
// fresh `runId` each dive and keys the node on it, so the GPU clip-path layer
// is a brand-new node every time and never reused stale.
export default function MenuWipe({ active, runId }: { active: boolean; runId: number }) {
  if (!active) return null;
  return <div key={runId} className={styles.wipe} />;
}
