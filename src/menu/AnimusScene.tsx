import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  buildWaferLayout,
  TOTAL_WAFERS,
  WAFERS_PER_STACK,
  WAFER_W,
  WAFER_H,
} from "./waferLayout";
import { STACK_COUNT } from "./destinations";
import { useAnimus, type AnimusMode } from "./animusStore";

// ---------------------------------------------------------------------------
// AnimusScene — the contents of the ONE persistent <Canvas> (mounted once at
// App root, never per-route). Renders the 7 wafer-stacks as a single
// InstancedMesh, a selection/dolly controller, and a label projector.
//
// ANTI-BRICK invariants enforced here (RUNTIME_AND_STACK §5, skill §7):
//   #2  frameloop="demand": invalidate() is called ONLY while a value is still
//       easing toward its target (selection reshuffle / dive dolly). Once every
//       eased value has settled within EPS the frame does NOT invalidate — the
//       scene goes fully still, 0 idle frames. The `mode==="screen"` path early-
//       returns before any invalidate, so a DOM screen showing = dead-still GPU.
//   #3  No drei / no <Html>. Labels are projected onto plain DOM the overlay
//       owns; this file only WRITES screen coords onto the registered nodes.
//   one InstancedMesh, additive blending, capped dpr (on the Canvas wrapper).
// ---------------------------------------------------------------------------

/** Selection reshuffle / dolly settle threshold — below this we stop rendering. */
const EPS = 0.0006;

// Camera framing: slightly above, looking across the receding rack (§5 "camera
// slightly above looking across"). The camera does not move between stacks;
// the SELECTED stack dollies toward the camera instead (cheaper + reads as the
// rack presenting the choice).
const CAM_POS = new THREE.Vector3(0, 1.05, 11.5);
const CAM_TARGET = new THREE.Vector3(0, 0.1, -3);

// Per-stack resting recession: stacks sit on a shallow arc receding into -Z so
// the outer stacks compress + soften (one-point perspective, real depth).
const REST_Z = -3.0; // z of the centre stack at rest
const Z_PER_STEP = -0.55; // extra recession per step away from centre… but we
// actually recede by distance-from-SELECTED so the chosen one is nearest.

// How far forward (+Z, toward camera) and up the SELECTED stack pulls.
const SELECT_Z_PULL = 1.7;
const SELECT_Y_LIFT = 0.22;
const SELECT_SCALE = 1.12;
const FAR_SCALE = 0.8;

// Extra downward dolly of the WHOLE rack during a dive (the camera pushes in;
// we fake it by pulling the selected stack right up to the lens, §5 dive).
const DIVE_Z_PULL = 5.4;

// Animus red gradient across the selected stack's wafers (dark base → hot
// leading edge), from tokens.css. Bone-white for every unselected wafer.
const RED_BASE = new THREE.Color("#b01f1f"); // --animus-red
const RED_HOT = new THREE.Color("#e0453a"); // --animus-red-hot
const BONE = new THREE.Color("#e8e6e2"); // --animus-field

/** Per-stack animated state (all eased toward a target each active frame). */
interface StackAnim {
  /** 0 = fully unselected, 1 = fully selected (drives z-pull / lift / tint). */
  sel: number;
  /** 0 = menu at rest, 1 = fully dived (extra forward pull on the selected). */
  dive: number;
}

export default function AnimusScene() {
  const { selected, mode, labelSlots, registerInvalidate, setSelected, requestDive } =
    useAnimus();
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const layout = useMemo(buildWaferLayout, []);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  // Live refs (NOT React state) so easing never triggers a re-render.
  const stackAnim = useRef<StackAnim[]>(
    Array.from({ length: STACK_COUNT }, () => ({ sel: 0, dive: 0 })),
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const modeRef = useRef<AnimusMode>(mode);
  modeRef.current = mode;

  // Scratch vectors for projection (reused; no per-frame allocation).
  const projVec = useMemo(() => new THREE.Vector3(), []);

  // Eased rack-wide X offset that RECENTRES the selected stack to screen centre.
  // Each stack keeps its fixed base-X; the whole rack slides so the chosen stack
  // is centred + prominent instead of stranded at its index position (an end
  // selection like DASHBOARD would otherwise sit off the screen edge). NaN =
  // uninitialised → snapped to target on first use so there's no mount slide.
  const rackX = useRef(NaN);

  // Bridge invalidate() out to the store so React (selection / dive) can kick
  // the demand-frameloop from idle. Registered once.
  useLayoutEffect(() => {
    registerInvalidate(invalidate);
    invalidate(); // first paint
  }, [registerInvalidate, invalidate]);

  // Kick a render whenever selection or mode changes (even from dead-still idle).
  useLayoutEffect(() => {
    invalidate();
  }, [selected, mode, invalidate]);

  // Point the camera once (it never moves between selections; the rack pulls
  // the chosen stack forward instead). Set position + lookAt imperatively so
  // the framing is guaranteed regardless of the Canvas's default target.
  useLayoutEffect(() => {
    camera.position.copy(CAM_POS);
    camera.lookAt(CAM_TARGET);
    camera.updateMatrixWorld();
  }, [camera]);

  // Seed the instance matrices/colours once so the very first (pre-animation)
  // frame is already laid out (avoids a one-frame flash of stacked-at-origin).
  useLayoutEffect(() => {
    writeInstances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Write every wafer's matrix + colour from the current eased stackAnim.
   * Called each active frame AND once on mount. Pure function of stackAnim +
   * layout + selectedRef — no easing here (that's in useFrame).
   */
  function writeInstances() {
    const mesh = meshRef.current;
    if (!mesh) return;
    const anim = stackAnim.current;
    const sel = selectedRef.current;
    // Recentre-on-selected offset (snapped on the very first write).
    if (Number.isNaN(rackX.current)) rackX.current = -layout.stackBaseX[sel];

    for (let s = 0; s < STACK_COUNT; s++) {
      const a = anim[s];
      // Resting recession by distance from the SELECTED stack: the selected
      // one is nearest; neighbours step back, so the rack reads as focused.
      const dist = Math.abs(s - sel);
      const baseZ = REST_Z + dist * Z_PER_STEP;
      // Selected pulls forward (+Z) and up; dive pulls it further to the lens.
      const z = baseZ + a.sel * SELECT_Z_PULL + a.sel * a.dive * DIVE_Z_PULL;
      const lift = a.sel * SELECT_Y_LIFT;
      const stackScale = FAR_SCALE + a.sel * (SELECT_SCALE - FAR_SCALE);

      const originX = layout.stackBaseX[s] + rackX.current;

      for (let w = 0; w < WAFERS_PER_STACK; w++) {
        const id = s * WAFERS_PER_STACK + w;
        const wf = layout.wafers[id];

        dummy.position.set(
          originX + wf.local[0],
          wf.local[1] + lift,
          z + wf.local[2],
        );
        dummy.rotation.set(0, wf.rot, 0);
        dummy.scale.setScalar(wf.scale * stackScale);
        dummy.updateMatrix();
        mesh.setMatrixAt(id, dummy.matrix);

        // Colour: strata-bone for unselected; on the selected stack lerp toward
        // a dark→hot red gradient up the stack (the red band travels it, §5).
        // Normal alpha blending now (not additive), so ink darker than the pale
        // field renders as true colour — no per-wafer dimming needed.
        const b = wf.brightness;
        if (a.sel > 0.001) {
          const grad = w / (WAFERS_PER_STACK - 1); // 0 bottom → 1 top
          color.copy(RED_BASE).lerp(RED_HOT, grad);
          color.lerp(BONE, 1 - a.sel); // fade in the red as the stack is chosen
        } else {
          // Unselected wafers = muted cool-grey glass strata. The earlier
          // ~0.75 grey at opacity 0.5 gave only ~8% per-wafer contrast against
          // the pale --animus-field (0.91) void and washed out entirely in the
          // real .app; a cooler, darker slate reads clearly as receding strata.
          // brightness k spreads them so each stack has internal depth.
          const k = b;
          color.setRGB(0.28 + k * 0.18, 0.3 + k * 0.18, 0.4 + k * 0.19);
        }
        mesh.setColorAt(id, color);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Project each stack's world anchor to screen px and write onto the labels. */
  function projectLabels(camera: THREE.Camera, w: number, h: number) {
    const anim = stackAnim.current;
    const sel = selectedRef.current;
    const slots = labelSlots.current;

    for (let s = 0; s < STACK_COUNT; s++) {
      const a = anim[s];
      const dist = Math.abs(s - sel);
      const baseZ = REST_Z + dist * Z_PER_STEP;
      const z = baseZ + a.sel * SELECT_Z_PULL + a.sel * a.dive * DIVE_Z_PULL;
      const lift = a.sel * SELECT_Y_LIFT;
      // Anchor slightly above the stack's top wafer so the label floats clear.
      const topY = ((WAFERS_PER_STACK - 1) / 2) * 0.5 + 0.55 + lift;

      // Same rack-recentre offset as writeInstances so labels track their stacks.
      projVec.set(layout.stackBaseX[s] + (Number.isNaN(rackX.current) ? -layout.stackBaseX[sel] : rackX.current), topY, z);
      projVec.project(camera); // → NDC (-1..1), z>1 means behind camera

      const slot = slots[s];
      if (!slot) continue;
      const behind = projVec.z > 1;
      slot.visible = !behind;
      slot.x = (projVec.x * 0.5 + 0.5) * w;
      slot.y = (-projVec.y * 0.5 + 0.5) * h;

      const el = slot.el;
      if (el) {
        if (behind) {
          el.style.opacity = "0";
        } else {
          // transform + opacity ONLY (anti-brick §4). translate(-50%,0) centres.
          el.style.transform = `translate(-50%, 0) translate(${slot.x.toFixed(1)}px, ${slot.y.toFixed(1)}px)`;
          // Selected label is prominent; far labels soften with recession.
          const near = 1 - Math.min(dist, 3) / 4;
          el.style.opacity = (0.35 + near * 0.5 + a.sel * 0.15).toFixed(3);
        }
      }
    }
  }

  useFrame((state, delta) => {
    const m = modeRef.current;
    // A DOM screen is showing (opaque Frame covers us) → do NOTHING, no
    // invalidate: the persistent GPU layer is dead-still (anti-brick law #2).
    if (m === "screen") return;

    const sel = selectedRef.current;
    const anim = stackAnim.current;
    const diving = m === "diving";
    // Frame-rate-independent ease toward each target (spike's technique).
    // Clamp the per-frame delta: in frameloop="demand" the r3f clock keeps real
    // time while idle, so the FIRST frame after a demand-idle carries the whole
    // idle gap as delta — which would drive k≈1 and teleport every eased value.
    const dt = Math.min(delta, 1 / 30); // first frame after demand-idle carries the whole idle gap
    const k = 1 - Math.pow(0.0016, dt);

    let moving = false;
    for (let s = 0; s < STACK_COUNT; s++) {
      const a = anim[s];
      const selTarget = s === sel ? 1 : 0;
      const diveTarget = diving && s === sel ? 1 : 0;

      const dSel = selTarget - a.sel;
      const dDive = diveTarget - a.dive;
      a.sel += dSel * k;
      a.dive += dDive * k;

      if (Math.abs(dSel) > EPS || Math.abs(dDive) > EPS) moving = true;
    }

    // Ease the rack-recentre offset toward the selected stack's -baseX so the
    // whole rack slides the chosen stack to centre (transform only, in-canvas).
    const rackTarget = -layout.stackBaseX[sel];
    const dRack = rackTarget - rackX.current;
    rackX.current += dRack * k;
    if (Math.abs(dRack) > EPS) moving = true;

    // Snap to exact targets once settled so residual sub-EPS drift can't keep
    // the loop alive by a hair.
    if (!moving) {
      for (let s = 0; s < STACK_COUNT; s++) {
        anim[s].sel = s === sel ? 1 : 0;
        anim[s].dive = diving && s === sel ? 1 : 0;
      }
      rackX.current = rackTarget;
    }

    writeInstances();

    const size = state.size;
    projectLabels(state.camera, size.width, size.height);

    // Re-invalidate ONLY while still moving. Settled → return without kicking:
    // the frameloop goes idle (0 frames) until the next React-driven kick.
    if (moving) invalidate();
  });

  // Click-to-RAYCAST selection (anti-brick #3: raycast the canvas, never DOM
  // buttons over the 3D). r3f's built-in raycaster gives us the instanceId;
  // clicking an unselected stack selects it, clicking the selected stack dives.
  // Only active in menu mode — stray events during a dive / screen are ignored.
  const stackFromInstance = (instanceId: number | undefined): number | null => {
    if (instanceId == null) return null;
    return Math.floor(instanceId / WAFERS_PER_STACK);
  };

  const handleClick = (instanceId: number | undefined) => {
    if (modeRef.current !== "menu") return;
    const stack = stackFromInstance(instanceId);
    if (stack == null) return;
    if (stack === selectedRef.current) requestDive(stack);
    else setSelected(stack);
  };

  return (
    <>
      {/* Pale --animus-field data-void as the scene background (no skybox/floor
          — depth is entirely the wafer geometry, §5 build discipline). */}
      <color attach="background" args={["#e8e6e2"]} />
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, TOTAL_WAFERS]}
        frustumCulled={false}
        onClick={(e) => {
          e.stopPropagation();
          handleClick(e.instanceId);
        }}
        onPointerOver={() => {
          if (modeRef.current === "menu") gl.domElement.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          gl.domElement.style.cursor = "";
        }}
      >
        <planeGeometry args={[WAFER_W, WAFER_H]} />
        <meshBasicMaterial
          transparent
          opacity={0.62}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </>
  );
}
