import { useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SpikePhase } from "./driver";

// ---------------------------------------------------------------------------
// Deterministic per-instance hash (NOT Math.random) so layout is stable
// across remounts / hot-reloads and reads as intentional, not noisy.
// ---------------------------------------------------------------------------
function hash(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x); // 0..1
}

const COUNT = 160;
const STACKS = 7;
const PER_STACK = Math.ceil(COUNT / STACKS); // ~23

type InstanceLayout = {
  positions: Float32Array; // xyz per instance
  rotations: Float32Array; // y-rotation per instance
  scales: Float32Array; // uniform scale per instance
  brightness: Float32Array; // 0..1 per instance
};

function buildLayout(): InstanceLayout {
  const positions = new Float32Array(COUNT * 3);
  const rotations = new Float32Array(COUNT);
  const scales = new Float32Array(COUNT);
  const brightness = new Float32Array(COUNT);

  let i = 0;
  for (let s = 0; s < STACKS && i < COUNT; s++) {
    // Stacks spread in X, receding into -Z (one-point perspective).
    const stackX = (s - (STACKS - 1) / 2) * 1.9;
    const stackZ = -2.5 - s * 2.1;
    const waferCount = Math.min(PER_STACK, COUNT - i);
    for (let w = 0; w < waferCount; w++, i++) {
      const jx = (hash(i, 1.0) - 0.5) * 0.35;
      const jy = (hash(i, 2.0) - 0.5) * 0.2;
      const jz = (hash(i, 3.0) - 0.5) * 0.6;
      const jr = (hash(i, 4.0) - 0.5) * 0.12;
      const js = 0.85 + hash(i, 5.0) * 0.3;
      const jb = 0.35 + hash(i, 6.0) * 0.65;

      positions[i * 3 + 0] = stackX + jx;
      positions[i * 3 + 1] = (w - waferCount / 2) * 0.62 + jy;
      positions[i * 3 + 2] = stackZ + jz;
      rotations[i] = jr;
      scales[i] = js;
      brightness[i] = jb;
    }
  }

  return { positions, rotations, scales, brightness };
}

function Strata() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const layout = useMemo(buildLayout, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const color = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      dummy.position.set(
        layout.positions[i * 3 + 0],
        layout.positions[i * 3 + 1],
        layout.positions[i * 3 + 2],
      );
      dummy.rotation.set(0, layout.rotations[i], 0);
      dummy.scale.setScalar(layout.scales[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const b = layout.brightness[i];
      color.setRGB(b, b, b * 0.98);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [dummy, layout]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <planeGeometry args={[2.2, 1.3]} />
      <meshBasicMaterial
        transparent
        opacity={0.16}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        color={"#e8e6e2"}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Camera dolly + idle-breathe. Demand-frameloop self-perpetuation lives here.
// ---------------------------------------------------------------------------

const WIDE_POS = new THREE.Vector3(0, 1.1, 9);
const DOLLY_POS = new THREE.Vector3(1.4, 1.1, 5.5);
const WIDE_TARGET = new THREE.Vector3(0, 0.4, 0);
const DOLLY_TARGET = new THREE.Vector3(1.6, 0.2, -4.5);

function Dolly({ phase, strataRef }: { phase: SpikePhase; strataRef: React.RefObject<THREE.Group | null> }) {
  const invalidate = useThree((s) => s.invalidate);
  const dollyAmount = useRef(0); // 0 = wide, 1 = dolly-in
  const clock = useRef(0);
  const currentPos = useRef(WIDE_POS.clone());
  const currentTarget = useRef(WIDE_TARGET.clone());

  // Kick a render whenever phase changes, even from idle.
  useLayoutEffect(() => {
    invalidate();
  }, [phase, invalidate]);

  useFrame((state, delta) => {
    const advancing = phase !== "idle";
    const goingIn = phase === "dolly" || phase === "wipe";

    const target = goingIn ? 1 : 0;
    const lerpSpeed = 1 - Math.pow(0.001, delta); // frame-rate independent ease
    dollyAmount.current += (target - dollyAmount.current) * lerpSpeed;

    currentPos.current.lerpVectors(WIDE_POS, DOLLY_POS, dollyAmount.current);
    currentTarget.current.lerpVectors(WIDE_TARGET, DOLLY_TARGET, dollyAmount.current);

    state.camera.position.copy(currentPos.current);
    state.camera.lookAt(currentTarget.current);

    if (advancing) {
      clock.current += delta;
      if (strataRef.current) {
        const bob = Math.sin(clock.current * 0.6) * 0.04;
        strataRef.current.position.y = bob;
      }
    }

    if (advancing) {
      invalidate();
    }
    // phase === 'idle': do NOT call invalidate() — scene goes fully still.
  });

  return null;
}

export default function SpikeScene({ phase }: { phase: SpikePhase }) {
  const strataGroupRef = useRef<THREE.Group>(null);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 1.1, 9], fov: 42 }}
      style={{ position: "fixed", inset: 0, zIndex: 0 }}
    >
      <group ref={strataGroupRef}>
        <Strata />
      </group>
      <Dolly phase={phase} strataRef={strataGroupRef} />
    </Canvas>
  );
}
