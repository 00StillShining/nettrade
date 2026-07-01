import { useEffect, useRef } from "react";
import styles from "./Telemetry.module.css";
import type { SpikePhase } from "./driver";

// Live mono DOM readout representing the SDN telemetry ticker running
// concurrently with the WebGL layer. Ticks via requestAnimationFrame,
// throttled to ~50ms, and ONLY ever writes textContent (plus, at most,
// a transform on a small element) — never layout properties.
export default function Telemetry({ phase }: { phase: SpikePhase }) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const signalRef = useRef<HTMLSpanElement>(null);
  const coordsRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  const barPhaseRef = useRef<HTMLSpanElement>(null);
  const blipRef = useRef<HTMLSpanElement>(null);

  const phaseLive = useRef(phase);
  phaseLive.current = phase;

  useEffect(() => {
    let raf = 0;
    let frame = 0;
    let last = 0;
    const start = performance.now();
    const INTERVAL_MS = 50;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < INTERVAL_MS) return;
      last = now;
      frame++;

      const elapsedS = (now - start) / 1000;
      const signal = Math.sin(elapsedS * 1.7) * 0.5 + 0.5;
      const x = (Math.sin(elapsedS * 0.9) * 42).toFixed(2);
      const y = (Math.cos(elapsedS * 0.6) * 17).toFixed(2);

      if (frameRef.current) frameRef.current.textContent = `FRAME ${String(frame).padStart(6, "0")}`;
      if (elapsedRef.current) elapsedRef.current.textContent = `T+${elapsedS.toFixed(2)}s`;
      if (signalRef.current) signalRef.current.textContent = `SIGNAL ${signal.toFixed(3)}`;
      if (coordsRef.current) coordsRef.current.textContent = `POS ${x}, ${y}`;
      if (phaseRef.current) phaseRef.current.textContent = `PHASE ${phaseLive.current.toUpperCase()}`;
      if (barPhaseRef.current) barPhaseRef.current.textContent = phaseLive.current.toUpperCase();
      if (blipRef.current) {
        blipRef.current.style.transform = `translateX(${signal * 10}px)`;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.topLeft}>
        <span className={styles.row} ref={frameRef}>
          FRAME 000000
        </span>
        <span className={styles.row} ref={elapsedRef}>
          T+0.00s
        </span>
        <span className={styles.row}>
          <span className={styles.signal} ref={signalRef}>
            SIGNAL 0.000
          </span>{" "}
          <span ref={blipRef} style={{ display: "inline-block" }}>
            *
          </span>
        </span>
        <span className={styles.row} ref={coordsRef}>
          POS 0.00, 0.00
        </span>
        <span className={styles.row} ref={phaseRef}>
          PHASE IDLE
        </span>
      </div>
      <div className={styles.statusBar}>
        <span>ACTUALITY // SDN LINK</span>
        <span ref={barPhaseRef}>IDLE</span>
      </div>
    </div>
  );
}
