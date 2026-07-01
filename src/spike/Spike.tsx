import { useEffect, useRef, useState } from "react";
import "./spike.css";
import SpikeScene from "./SpikeScene";
import CrtBaked from "./CrtBaked";
import Telemetry from "./Telemetry";
import Wipe from "./Wipe";
import { type SpikePhase, durationFor, nextPhase } from "./driver";

declare global {
  interface Window {
    __spike?: {
      trigger: () => void;
      pause: () => void;
      resume: () => void;
      getPhase: () => SpikePhase;
    };
  }
}

const hudStyle: React.CSSProperties = {
  position: "fixed",
  left: 14,
  bottom: 34,
  zIndex: 40,
  pointerEvents: "none",
  fontFamily: '"Space Mono", monospace',
  fontSize: 10,
  letterSpacing: "0.06em",
  color: "rgba(232, 230, 226, 0.55)",
};

export default function Spike() {
  const [phase, setPhase] = useState<SpikePhase>("idle");
  const [paused, setPaused] = useState(false);
  const [wipeRunId, setWipeRunId] = useState(0);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const advance = (from: SpikePhase) => {
    const to = nextPhase(from);
    if (to === "wipe") setWipeRunId((n) => n + 1);
    setPhase(to);
  };

  const scheduleNext = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pausedRef.current) return;
    timerRef.current = setTimeout(() => {
      advance(phaseRef.current);
    }, durationFor(phaseRef.current));
  };

  // Re-arm the timer whenever phase or paused changes.
  useEffect(() => {
    scheduleNext();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused]);

  useEffect(() => {
    document.documentElement.dataset.spikePhase = phase;
  }, [phase]);

  useEffect(() => {
    window.__spike = {
      trigger: () => {
        setWipeRunId((n) => n + 1);
        setPhase("wipe");
      },
      pause: () => setPaused(true),
      resume: () => setPaused(false),
      getPhase: () => phaseRef.current,
    };
    return () => {
      delete window.__spike;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setWipeRunId((n) => n + 1);
        setPhase("wipe");
      } else if (e.key === "p" || e.key === "P") {
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Best-effort fullscreen so external capture gets pure app pixels.
  useEffect(() => {
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        await w.setFullscreen(true);
      } catch {
        // no-op in a plain browser / non-Tauri context
      }
    })();
  }, []);

  return (
    <>
      <SpikeScene phase={phase} />
      <CrtBaked suspended={phase === "wipe"} />
      <Telemetry phase={phase} />
      <Wipe active={phase === "wipe"} runId={wipeRunId} />
      <div style={hudStyle}>ACTUALITY · PHASE-0 SPIKE · {phase}</div>
    </>
  );
}
