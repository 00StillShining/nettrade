import c from "./Crt.module.css";

/**
 * Shared CRT overlay (z90, BELOW the expand modal at z100; pointer-events:none).
 * The element tree + its CSS were byte-identical across Dashboard and Positions;
 * extracted here so both screens render the same <Crt/>.
 */
export function Crt() {
  return (
    <div className={c.crt}>
      <div className="bulge" />
      <div className="scan" />
      <div className="grille" />
      <div className="sheen" />
      <div className="vig" />
      <div className="corners" />
      <div className="bezel" />
      <div className="glassmask" />
    </div>
  );
}
