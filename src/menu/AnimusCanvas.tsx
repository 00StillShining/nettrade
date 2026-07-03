import { Canvas } from "@react-three/fiber";
import AnimusScene from "./AnimusScene";
import { useAnimus } from "./animusStore";

// ---------------------------------------------------------------------------
// AnimusCanvas — the ONE persistent r3f <Canvas>, mounted ONCE at the App root
// and NEVER unmounted per route (anti-brick law #1). It sits at z-index 0,
// position:fixed, behind every DOM layer; when a screen is showing, the opaque
// <Frame> covers it AND AnimusScene's useFrame early-returns (mode==="screen"),
// so the GPU layer is dead-still.
//
// Structure + gl config are copied VERBATIM from the Phase-0 spike's SpikeScene
// (the config that passed the real-.app pacing gate, idle pixel-diff 0.003):
// the position:fixed/inset:0/zIndex goes ON THE CANVAS itself (no wrapper div —
// a wrapper broke r3f's parent-measurement and pinned the drawing buffer at the
// 300×150 default). frameloop="demand", dpr [1,1.5], antialias:false, alpha,
// high-performance.
//
// pointerEvents is toggled inline: interactive only while in the menu, so
// clicks during a dive / on a screen can't reach the canvas raycaster.
// ---------------------------------------------------------------------------
export default function AnimusCanvas() {
  const { mode } = useAnimus();
  const interactive = mode === "menu";

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 1.15, 13.5], fov: 47 }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: interactive ? "auto" : "none",
      }}
    >
      <AnimusScene />
    </Canvas>
  );
}
