import { useEffect } from "react";
import Labels from "./Labels";
import { useAnimus } from "./animusStore";
import { DESTINATIONS, moveLeft, moveRight } from "./destinations";
import styles from "./AnimusMenu.module.css";

// ---------------------------------------------------------------------------
// AnimusMenu — the routed element at "/" (the Animus IS home). It is NOT a
// screen: it's a transparent HUD + label overlay over the persistent canvas
// (which shows through because this route renders NO opaque <Frame>). It owns:
//   - keyboard input (←/→ select, Enter dive),
//   - the minimal, obviously-operable HUD (wordmark + selected name + prompts).
//
// The dive orchestrator itself lives in the provider (animusStore) so the wipe
// + its teardown survive this route unmounting at the cover point — AnimusMenu
// only REQUESTS a dive here.
//
// Anti-brick: input is keyboard + canvas raycast only (no DOM buttons over the
// 3D, #3). The dive is ONE effect (#5) — dolly + wipe, CRT suspended by the
// App while mode === "diving" || wipeActive.
// ---------------------------------------------------------------------------
export default function AnimusMenu() {
  const { selected, setSelected, mode, setMode, requestDive } = useAnimus();

  // Entering the menu route: make sure the canvas is in interactive "menu" mode
  // (e.g. after returning from a screen via Esc / the ◄ ANIMUS control).
  useEffect(() => {
    setMode("menu");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: ←/→ move selection, Enter dives. Ignored while a dive is running.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === "diving") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelected(moveLeft);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelected(moveRight);
      } else if (e.key === "Enter") {
        e.preventDefault();
        requestDive(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, requestDive, selected, setSelected]);

  const activeName = DESTINATIONS[selected]?.label ?? "";

  return (
    <div className={styles.menu}>
      <Labels />

      {/* ---- Minimal HUD (obviously-operable, usability law) ---- */}
      <div className={styles.hud}>
        <div className={styles.wordmarkRow}>
          <span className={styles.diamond}>◆</span>
          <span className={styles.wordmark}>ACTUALITY</span>
          <span className={styles.animusTag}>ANIMUS</span>
        </div>
      </div>

      <div className={styles.selectedBanner}>
        <div className={styles.selectedName}>{activeName}</div>
        <div className={styles.selectedIndex}>
          {String(selected + 1).padStart(2, "0")} / {String(DESTINATIONS.length).padStart(2, "0")}
        </div>
      </div>

      <div className={styles.prompts}>
        <span className={styles.prompt}>
          <kbd className={styles.key}>◄</kbd>
          <kbd className={styles.key}>►</kbd>
          SELECT
        </span>
        <span className={styles.promptSep}>·</span>
        <span className={styles.prompt}>
          <kbd className={styles.key}>ENTER</kbd>
          DIVE
        </span>
        <span className={styles.promptSep}>·</span>
        <span className={styles.prompt}>CLICK A STACK</span>
      </div>

      {/* Hidden but honest: announce the menu + selection to assistive tech.
          The visual selection is the canvas + projected labels (aria-hidden). */}
      <p className={styles.srOnly} role="status" aria-live="polite">
        Animus menu. {activeName} selected, item {selected + 1} of {DESTINATIONS.length}.
        Press Enter to dive. {mode === "diving" ? "Diving." : ""}
      </p>
    </div>
  );
}
