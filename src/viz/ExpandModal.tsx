import type { RefObject } from "react";
import { NtMarble } from "./Marble";

/**
 * Shared click-to-expand modal SHELL (the JSX tree + structural contract) used
 * by both Dashboard and Positions. It mirrors EXACTLY the markup both screens
 * shipped: the scrim, the marble-bordered .expFrame (z100, ABOVE the CRT at z90,
 * overflow:visible so the title/close tags are never sliced, NO clip-path on the
 * frame), the PERFORMANCE-TRUTH / POSITION-DETAIL tag, the ✕ CLOSE button, and
 * the two-pane .expInner (viz canvas + numbers list).
 *
 * Everything that differs per screen is passed in:
 *  - `cls`  : the host screen's CSS-module class map (the per-screen accent /
 *             marble tokens live in that module, so the modal re-skins for free)
 *  - `cfg`  : the resolved EXP config for the open key (head / sub / rows)
 *  - `tag`  : the frame tag text ("PERFORMANCE TRUTH" / per-cfg tag)
 *  - `edh`  : the NUMBERS-panel heading text
 *  - `foot` : the data-panel footer line
 *  - `dialogProps` : extra props on the outer .expand element (Positions adds
 *             role="dialog" / aria-modal / onKeyDown focus-trap; Dashboard none)
 *
 * The open/close state, Esc handling, ?expand deep-link round-trip, focus return
 * and the modal-canvas draw effect STAY in each screen — those behaviours genuinely
 * differ between the two screens, so the shell is intentionally presentational.
 */

export type Kind = "plain" | "gain" | "loss";
export type Row = [string, string, Kind] | ["hero", string, string, Kind];

export type ExpandCfg = {
  head: string;
  sub: string;
  rows: Row[];
};

/* Each screen's CSS-module class map. Typed as an index signature so a
   `*.module.css` import (CSSModuleClasses) assigns cleanly. The shell reads:
   expand, scrim, expFrame, frmarble, frhalf, frhatch, frtag, expClose, expInner,
   expViz, evbody, expData, edlist, edrow, edFoot — plus ntMarble / marbleDrift
   for the embedded <NtMarble/>. */
export type ExpandCls = Record<string, string>;

type ExpandModalProps = {
  cls: ExpandCls;
  open: boolean;
  cfg: ExpandCfg | null;
  tag: string;
  edh: string;
  foot: string;
  onClose: () => void;
  expandRef: RefObject<HTMLDivElement | null>;
  expCanvasRef: RefObject<HTMLCanvasElement | null>;
  dialogProps?: React.HTMLAttributes<HTMLDivElement>;
};

export function ExpandModal({
  cls,
  open,
  cfg,
  tag,
  edh,
  foot,
  onClose,
  expandRef,
  expCanvasRef,
  dialogProps,
}: ExpandModalProps) {
  return (
    <div className={`${cls.expand} ${open ? "on" : ""}`} ref={expandRef} {...dialogProps}>
      <div className={cls.scrim} onClick={onClose} />
      <div className={cls.expFrame}>
        <NtMarble cls={cls} className={cls.frmarble} />
        <div className={cls.frhalf} />
        <div className={`${cls.frhatch} t`} />
        <div className={`${cls.frhatch} b`} />
        <div className={cls.frtag}>
          <NtMarble cls={cls} />
          <span className="txt">{tag}</span>
        </div>
        <button className={cls.expClose} onClick={onClose}>
          ✕ CLOSE
        </button>
        <div className={cls.expInner}>
          <div className={cls.expViz}>
            <div className="evh">{cfg?.head ?? "—"}</div>
            <div className="evs">{cfg?.sub ?? "—"}</div>
            <div className={cls.evbody}>
              <canvas id="cv-exp" ref={expCanvasRef} />
            </div>
          </div>
          <div className={cls.expData}>
            <div className="edh">{edh}</div>
            <div className={cls.edlist}>
              {cfg?.rows.map((r, i) => {
                const hero = r[0] === "hero";
                const lbl = hero ? (r[1] as string) : (r[0] as string);
                const val = hero ? (r[2] as string) : (r[1] as string);
                const kind = (hero ? r[3] : r[2]) as Kind;
                return (
                  <div className={`${cls.edrow} ${hero ? "hero" : ""}`} key={i}>
                    <div className="lbl">{lbl}</div>
                    <div className={`val ${kind === "gain" ? "gain" : kind === "loss" ? "loss" : ""}`}>{val}</div>
                  </div>
                );
              })}
            </div>
            <div className={cls.edFoot}>{foot}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
