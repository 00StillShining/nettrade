import { useLayoutEffect, useMemo, useRef, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  buildWaferLayout,
  TOTAL_WAFERS,
  WAFERS_PER_STACK,
  WAFER_GAP,
  WAFER_W,
  WAFER_H,
  WAFER_D,
} from "./waferLayout";
import { STACK_COUNT } from "./destinations";
import {
  buildSmokeField,
  makeSmokeTexture,
  SMOKE_COUNT,
  SMOKE_SPAN_Y,
} from "./smoke";
import { useAnimus, type AnimusMode } from "./animusStore";

// ---------------------------------------------------------------------------
// AnimusScene — the contents of the ONE persistent <Canvas> (mounted once at
// App root, never per-route). Phase 3b turns the flat wafer planes into a real
// 3D atmosphere: slab wafers (boxes) lit by Lambert, a cool smokey void
// (FogExp2 tinted to the background so the rack dissolves into haze), drifting
// canvas-sprite smoke, and a PERPETUAL FALL — the strata + smoke drift steadily
// downward, wrapping, so the Animus feels alive rather than a frozen diorama.
//
// AMENDED ANTI-BRICK DISCIPLINE (RUNTIME_AND_STACK §5, skill §7):
//   • The perpetual loop is allowed ONLY while mode!=="screen". The
//     mode==="screen" path early-returns BEFORE any invalidate — a DOM screen
//     showing ⇒ ZERO invalidates, dead-still GPU (law #2 preserved).
//   • prefers-reduced-motion FREEZES the fall + smoke drift and restores the
//     dead-still at-rest behaviour (settle → stop invalidating), so the scene
//     never perpetually renders for a motion-averse user.
//   • No drei / <Html>; no postprocessing; no live whole-screen filter. Labels
//     are projected onto plain DOM the overlay owns (this file only WRITES
//     screen coords). Deterministic layout (hashed, no Math.random). dpr capped
//     on the Canvas wrapper.
//   • KEEP ALL 7 STACKS IN FRAME: there is NO rack-slide recentring. Every
//     stack holds its fixed base-X; the camera is pulled back + widened so the
//     full rack is inside the frustum at BOTH end selections (frustum verified
//     — see FRAMING below). The chosen stack is emphasised by pulling ITSELF
//     forward/up + tinting, not by sliding the whole rack off-centre.
// ---------------------------------------------------------------------------

/** Selection reshuffle / dolly settle threshold — below this we stop easing. */
const EPS = 0.0006;

// FRAMING (keep-all-7-in-frame, no rack slide) --------------------------------
// Camera sits back + slightly above, looking across the receding rack. At this
// z/fov the outermost stack's far edge (|stackBaseX[0..6]| + WAFER_W/2 = 6.90)
// stays inside the horizontal half-width even for an END selection (its stack
// pulled forward to the nearest plane) down to a narrow ~1.25 aspect. Verified:
//   dist = CAM z − selectedEndPlaneZ ≈ 13.5 − (−0.9) = 14.4
//   halfW(1.333) ≈ tan(47°/2)·1.333·14.4 ≈ 8.35  ≥ 6.90  → comfortable margin.
// The camera never moves between selections; only the chosen stack dollies.
const CAM_POS = new THREE.Vector3(0, 1.15, 13.5);
const CAM_TARGET = new THREE.Vector3(0, -0.1, -3);

// Per-stack resting recession: stacks step back by distance from the SELECTED
// stack so the chosen one is nearest and the rack reads focused.
const REST_Z = -2.5; // z of the selected stack's neighbours' baseline
const Z_PER_STEP = -0.5; // extra recession per step away from the selected stack

// How far forward (+Z, toward camera) and up the SELECTED stack pulls.
const SELECT_Z_PULL = 1.6;
const SELECT_Y_LIFT = 0.22;
const SELECT_SCALE = 1.12;
const FAR_SCALE = 0.82;

// Extra forward dolly of the SELECTED stack during a dive (pull it to the lens).
const DIVE_Z_PULL = 5.4;

// PERPETUAL FALL --------------------------------------------------------------
// The whole rack + smoke drift steadily downward and wrap, so the Animus is a
// living column of falling strata. Wrap span keeps a wafer's world Y bounded.
const FALL_SPEED = 0.34; // world units / sec the rack strata fall
const RACK_WRAP_Y = 9.0; // wrap the rack offset within ±RACK_WRAP_Y/2
// Smoke lateral-sway frequency: exactly one cycle per rack-wrap span, so the
// sway phase is continuous when the shared fall accumulator resets by that span.
const SWAY_FREQ = (2 * Math.PI) / RACK_WRAP_Y;

// Animus red gradient across the selected stack (dark base → hot leading edge),
// from tokens.css. Cool bone strata for every unselected wafer.
const RED_BASE = new THREE.Color("#b01f1f"); // --animus-red
const RED_HOT = new THREE.Color("#e0453a"); // --animus-red-hot
const BONE = new THREE.Color("#e8e6e2"); // --animus-field

// The void / fog / background colour — the smoke, fog, and <color> background
// are ALL this one hex so the rack dissolves into the haze with no visible edge.
const VOID_HEX = "#e8e6e2"; // --animus-field
const VOID_COLOR = new THREE.Color(VOID_HEX);
const SMOKE_TINT = new THREE.Color("#dfe3ea"); // cool-white smoke, faintly blue

/** Per-stack animated state (all eased toward a target each active frame). */
interface StackAnim {
  /** 0 = fully unselected, 1 = fully selected (drives z-pull / lift / tint). */
  sel: number;
  /** 0 = menu at rest, 1 = fully dived (extra forward pull on the selected). */
  dive: number;
}

/** Shared per-stack pose — the ONE copy of the dolly maths, used by BOTH
 * writeInstances and projectLabels so the label anchors can never silently
 * drift from the instanced strata when these constants are retuned. */
function stackPose(s: number, sel: number, a: StackAnim) {
  const dist = Math.abs(s - sel);
  const z = REST_Z + dist * Z_PER_STEP + a.sel * SELECT_Z_PULL + a.sel * a.dive * DIVE_Z_PULL;
  const lift = a.sel * SELECT_Y_LIFT;
  const stackScale = FAR_SCALE + a.sel * (SELECT_SCALE - FAR_SCALE);
  return { dist, z, lift, stackScale };
}

/** Read prefers-reduced-motion once + subscribe to changes (freezes the fall). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export default function AnimusScene() {
  const { selected, mode, labelSlots, registerInvalidate, setSelected, requestDive } =
    useAnimus();
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const reducedMotion = usePrefersReducedMotion();
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  const layout = useMemo(buildWaferLayout, []);
  const smokeField = useMemo(buildSmokeField, []);
  const smokeTexture = useMemo(() => makeSmokeTexture(), []);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const smokeRef = useRef<THREE.InstancedMesh>(null);
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

  // The perpetual-fall clock: a single monotonically-advancing offset (world Y)
  // the rack + smoke share, wrapped into a bounded range. Frozen when reduced.
  const fallY = useRef(0);

  // Scratch vector for label projection (reused; no per-frame allocation).
  const projVec = useMemo(() => new THREE.Vector3(), []);

  // Dispose the generated smoke texture on unmount (it owns a canvas + GPU tex).
  useEffect(() => () => smokeTexture.dispose(), [smokeTexture]);

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

  // Kick once when reduced-motion toggles so the (now frozen or now-living)
  // state paints immediately.
  useLayoutEffect(() => {
    invalidate();
  }, [reducedMotion, invalidate]);

  // Point the camera once (it never moves between selections; the chosen stack
  // pulls forward instead). Set position + lookAt imperatively so the framing is
  // guaranteed regardless of the Canvas's default target.
  useLayoutEffect(() => {
    camera.position.copy(CAM_POS);
    camera.lookAt(CAM_TARGET);
    camera.updateMatrixWorld();
  }, [camera]);

  // Seed the instance matrices/colours once so the very first (pre-animation)
  // frame is already laid out (avoids a one-frame flash of stacked-at-origin).
  useLayoutEffect(() => {
    writeInstances();
    writeSmoke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Write every wafer's matrix + colour from the current eased stackAnim + the
   * shared fall offset. Pure function of stackAnim + layout + selectedRef +
   * fallY — no easing here (that's in useFrame). NO rack-X slide: each stack
   * keeps its fixed stackBaseX so all 7 stay framed (keep-all-7-in-frame law).
   */
  function writeInstances() {
    const mesh = meshRef.current;
    if (!mesh) return;
    const anim = stackAnim.current;
    const sel = selectedRef.current;
    const fy = fallY.current;

    for (let s = 0; s < STACK_COUNT; s++) {
      const a = anim[s];
      // Shared dolly maths (stackPose): selected nearest, neighbours recede,
      // dive pulls the chosen stack to the lens. ONE copy, shared with labels.
      const { z, lift, stackScale } = stackPose(s, sel, a);

      // Fixed base-X — NO rack recentring. All stacks live at their index X.
      const originX = layout.stackBaseX[s];

      for (let w = 0; w < WAFERS_PER_STACK; w++) {
        const id = s * WAFERS_PER_STACK + w;
        const wf = layout.wafers[id];

        // Perpetual fall: shift each wafer's world Y down by the shared offset,
        // wrapped so a wafer that falls off the bottom re-enters at the top.
        const wy = wrap(wf.local[1] + lift - fy, RACK_WRAP_Y);

        // Fade the recycle: scale to zero across a ~1-unit band at the wrap
        // edges (transform-only) — otherwise opaque slabs visibly POP out at
        // the bottom / in at the top, worst on the near red selected stack.
        const edgeFade = Math.max(0, Math.min(1, (RACK_WRAP_Y / 2 - Math.abs(wy)) / 1.0));

        dummy.position.set(originX + wf.local[0], wy, z + wf.local[2]);
        dummy.rotation.set(0, wf.rot, 0);
        dummy.scale.setScalar(wf.scale * stackScale * edgeFade);
        dummy.updateMatrix();
        mesh.setMatrixAt(id, dummy.matrix);

        // Colour: cool bone-slate strata for unselected; on the selected stack a
        // dark→hot red gradient up the stack (the red band travels it, §5). Lit
        // by Lambert now, so these are base albedos the lights shade.
        if (a.sel > 0.001) {
          const grad = w / (WAFERS_PER_STACK - 1); // 0 bottom → 1 top
          color.copy(RED_BASE).lerp(RED_HOT, grad);
          color.lerp(BONE, 1 - a.sel); // fade in the red as the stack is chosen
        } else {
          // Unselected wafers = muted cool-grey glass strata; brightness k
          // spreads them so each stack has internal depth.
          const k = wf.brightness;
          color.setRGB(0.32 + k * 0.2, 0.35 + k * 0.2, 0.44 + k * 0.2);
        }
        mesh.setColorAt(id, color);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Write the drifting smoke billboards from the shared fall offset. */
  function writeSmoke() {
    const mesh = smokeRef.current;
    if (!mesh) return;
    const fy = fallY.current;
    const sprites = smokeField.sprites;

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const sp = sprites[i];
      // Smoke falls with the rack at the SAME uniform base rate and wraps within
      // its (rack-span-multiple) vertical span, so when the shared accumulator is
      // reset by one rack span the smoke also lands on a whole span — seamless.
      const y = wrap(sp.base[1] - fy, SMOKE_SPAN_Y);
      // Fade a sprite toward the void near its own wrap edges so a large near
      // blob doesn't pop in/out in one frame as its centre crosses ±span/2.
      const smokeEdge = Math.max(0, Math.min(1, (SMOKE_SPAN_Y / 2 - Math.abs(y)) / 3));
      // A tiny lateral sway driven by the same fall clock — transform-only,
      // cheap, and keeps sprites from reading as a rigid falling grid. Its
      // frequency is a whole cycle per rack-wrap span (2π / RACK_WRAP_Y) so the
      // sway is ALSO continuous when the accumulator resets by that span.
      const swayX = Math.sin(fy * SWAY_FREQ + sp.swayPhase) * 0.4;

      dummy.position.set(sp.base[0] + swayX, y, sp.base[2]);
      dummy.rotation.set(0, 0, sp.swayPhase); // fixed per-sprite roll (variety)
      dummy.scale.setScalar(sp.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // "Opacity" via colour must be a LERP TOWARD THE VOID colour, not a darkening
      // multiply: instanceColor scales RGB only (alpha stays the texture's ~0.9
      // core), so multiplyScalar turned the faintest sprites into huge near-BLACK
      // blobs over the pale void. Lerping to the void hex is correct compositing
      // against a fog==background scene.
      color.copy(VOID_COLOR).lerp(SMOKE_TINT, Math.min(1, sp.opacity * 6) * smokeEdge);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Project each stack's world anchor to screen px and write onto the labels. */
  function projectLabels(cam: THREE.Camera, w: number, h: number) {
    const anim = stackAnim.current;
    const sel = selectedRef.current;
    const slots = labelSlots.current;

    for (let s = 0; s < STACK_COUNT; s++) {
      const a = anim[s];
      // Same shared dolly maths as the instances (stackPose) — labels can't drift.
      const { dist, z, lift } = stackPose(s, sel, a);
      // Anchor at the column's FIXED CROWN: the falling strata recycle beneath
      // it, but the column's visible extent is stationary — riding the fall wrap
      // would bury the label mid-column for ~72% of every cycle and sweep it
      // down the screen. Navigation labels must sit clear and still.
      const topY = ((WAFERS_PER_STACK - 1) / 2) * WAFER_GAP + 0.55 + lift;

      // Fixed base-X (no rack slide) so labels track their stacks exactly.
      projVec.set(layout.stackBaseX[s], topY, z);
      projVec.project(cam); // → NDC (-1..1), z>1 means behind camera

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
    const reduced = reducedRef.current;

    // Frame-rate-independent ease toward each target. Clamp the per-frame delta:
    // in frameloop="demand" the r3f clock keeps real time while idle, so the
    // FIRST frame after a demand-idle carries the whole idle gap as delta — which
    // would drive k≈1 and teleport every eased value.
    const dt = Math.min(delta, 1 / 30);
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

    // Snap eased selection/dive to exact targets once settled so residual
    // sub-EPS drift can't keep the loop alive by a hair.
    if (!moving) {
      for (let s = 0; s < STACK_COUNT; s++) {
        anim[s].sel = s === sel ? 1 : 0;
        anim[s].dive = diving && s === sel ? 1 : 0;
      }
    }

    // PERPETUAL FALL — advance the shared fall clock every frame, UNLESS
    // prefers-reduced-motion is set (then the fall + smoke freeze dead-still and
    // the scene falls back to invalidating only while a selection is easing).
    if (!reduced) {
      fallY.current += FALL_SPEED * dt;
      // Bound the accumulator so it never loses float precision over a long
      // session. The reset step must be a whole multiple of EVERY wrap span
      // (not vice-versa!): SMOKE_SPAN_Y=18 = 2×RACK_WRAP_Y (rack lands on a
      // whole span), 1×its own span, and 2 full sway cycles (2π/RACK_WRAP_Y).
      // Resetting by only RACK_WRAP_Y (9) would jump the smoke by HALF its
      // span every ~26.5s — a visible field teleport.
      if (fallY.current > SMOKE_SPAN_Y) fallY.current -= SMOKE_SPAN_Y;
    }

    writeInstances();
    writeSmoke();

    const size = state.size;
    projectLabels(state.camera, size.width, size.height);

    // Re-invalidate to keep the perpetual loop alive — but ONLY while NOT
    // reduced-motion. Under reduced-motion we invalidate only while a selection
    // is still easing, then go idle (dead-still at-rest) exactly like Phase 3a.
    if (!reduced || moving) invalidate();
  });

  // Click-to-RAYCAST selection (anti-brick #3: raycast the canvas, never DOM
  // buttons over the 3D). Clicking an unselected stack selects it; clicking the
  // selected stack dives. Only active in menu mode.
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
      {/* Pale --animus-field data-void as the scene background, and a matching
          FogExp2 so the rack + smoke DISSOLVE into the haze at depth with no
          visible edge (cool smokey void, §5). Fog colour === background hex. */}
      <color attach="background" args={[VOID_HEX]} />
      <fogExp2 attach="fog" args={[VOID_HEX, 0.052]} />

      {/* Lambert needs light. A cool hemisphere fill (sky = void, ground a touch
          warmer) plus a soft key from front-above give the slabs real shaded
          depth without any post-pass. */}
      <hemisphereLight args={["#eef0f4", "#c9c4bb", 1.15]} />
      <directionalLight position={[2.5, 6, 8]} intensity={0.9} color="#ffffff" />

      {/* The 7 wafer-stacks as ONE InstancedMesh of lit SLABS (boxes, not
          planes) — real 3D strata the fog + lights model. */}
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
        <boxGeometry args={[WAFER_W, WAFER_H, WAFER_D]} />
        <meshLambertMaterial toneMapped={false} />
      </instancedMesh>

      {/* Drifting canvas-sprite smoke — a second InstancedMesh of camera-facing
          billboards sampling the generated puff texture. Non-interactive
          (raycast disabled). Per-sprite "opacity" is carried by LERPING the
          instance colour toward the void hex (see writeSmoke); depth-TESTED so
          sprites behind the rack are properly occluded (depthWrite stays off —
          soft transparencies shouldn't punch holes in each other). */}
      <instancedMesh
        ref={smokeRef}
        args={[undefined, undefined, SMOKE_COUNT]}
        frustumCulled={false}
        raycast={() => null}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={smokeTexture}
          transparent
          opacity={1}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.NormalBlending}
          fog={false}
        />
      </instancedMesh>
    </>
  );
}

/**
 * Wrap a value into the symmetric range (-span/2, +span/2]. Used by the fall so
 * a wafer/sprite that drifts off the bottom re-enters at the top seamlessly.
 */
function wrap(v: number, span: number): number {
  const half = span / 2;
  let x = v;
  while (x > half) x -= span;
  while (x < -half) x += span;
  return x;
}
