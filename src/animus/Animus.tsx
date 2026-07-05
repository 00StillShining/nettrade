/* eslint-disable */
// Animus.tsx — Actuality's home menu at route "/".
//
// A FAITHFUL React port of "/Users/stillshining/Documents/animus menu/menu.html"
// (a zero-dependency single-file WebGL2 recreation of the AC-II "Animus 2.0"
// menu). The reference's <style> lives in ./animus.css; the reference's <body>
// DOM is this component's JSX; the reference's <script> is the one big
// useEffect below, kept AS CLOSE TO VERBATIM AS TypeScript allows. Loose typing
// (`any`) is intentional inside the port — the goal is fidelity, not type art.
//
// Integration changes (each justified in the orchestrator return / fidelityNotes):
//   · all #ids scoped #animus-* and looked up under the mounted root, not document.
//   · every addEventListener is cleaned up; the rAF loop is cancelled; the
//     AudioContext is closed; the WebGL context is explicitly lost — on unmount.
//   · the #flash element is hoisted to App.tsx (<AnimusFlash/> + ./flash.ts) so
//     the white cover survives the route swap; confirm()'s real leaves navigate
//     under that cover.
//   · titles retitled to Actuality's screens; one JOURNAL stack added to extras;
//     option towers 1-4 are "ready soon" placeholders.
//   · prefers-reduced-motion skips the idle camera sway + ribbon rotation.
//   · reference helpers unused by its own code (lerp/clamp/easeOut/mat4RotY/
//     mat4Translate) dropped — TS noUnusedLocals; zero behaviour change.
//
// Everything else — the math, shaders, geometry builders, scene coordinates,
// colors, fog, boot, synthesized SFX, input grammar, adaptive DPR, 60fps cap,
// document.hidden pause — is the reference's, unchanged.

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./animus.css";
import { registerFlashEl, triggerFlash, bootFlash } from "./flash";
import { getDaySummary } from "./daySummary";

/**
 * AnimusFlash — the persistent white "load memory" cover. Hoisted into App.tsx
 * so it outlives this component during the route swap. Registers its element
 * with the flash singleton; ./flash.ts drives its opacity.
 */
export function AnimusFlash() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    registerFlashEl(ref.current);
    return () => registerFlashEl(null);
  }, []);
  return <div ref={ref} className="animus-flash" aria-hidden="true" />;
}

export default function Animus() {
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // The effect runs once (mount); keep navigate current in a ref so confirm()
  // always calls the live router fn.
  const navRef = useRef(navigate);
  navRef.current = navigate;
  // the WebGL effect installs its guarded dive here so the cog (React JSX, outside
  // the effect closure) can route through the same BUSY-locked path as a menu leaf.
  const loadMemoryRef = useRef<((route: string) => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Scoped element lookup — the reference's document.getElementById("x")
    // becomes $("animus-x"). Same nodes, just namespaced + mount-scoped.
    const $ = (id: string) => root.querySelector<HTMLElement>("#animus-" + id)!;

    /* ═══════════════════════ MATH ═══════════════════════ */
    /*MATH-BEGIN*/
    const V3 = (x = 0, y = 0, z = 0): any => ({ x, y, z });
    const v3set = (o: any, x: number, y: number, z: number) => { o.x = x; o.y = y; o.z = z; return o; };
    const v3copy = (o: any, a: any) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
    const v3sub = (o: any, a: any, b: any) => v3set(o, a.x - b.x, a.y - b.y, a.z - b.z);
    const v3cross = (o: any, a: any, b: any) => { const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; return v3set(o, x, y, z); };
    const v3norm = (o: any) => { const l = Math.hypot(o.x, o.y, o.z) || 1; return v3set(o, o.x / l, o.y / l, o.z / l); };
    const v3lerp = (o: any, a: any, b: any, t: number) => v3set(o, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    const v3dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

    function mat4Perspective(out: any, fovY: number, aspect: number, near: number, far: number) {
      const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
      out.set([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
      return out;
    }
    function mat4LookAt(out: any, eye: any, at: any, up: any) {
      const z = v3norm(v3sub(V3(), eye, at));            // forward = eye - at (right-handed)
      const x = v3norm(v3cross(V3(), up, z));
      const y = v3cross(V3(), z, x);
      out.set([x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0,
        -(x.x * eye.x + x.y * eye.y + x.z * eye.z),
        -(y.x * eye.x + y.y * eye.y + y.z * eye.z),
        -(z.x * eye.x + z.y * eye.y + z.z * eye.z), 1]);
      return out;
    }
    function mat4Multiply(out: any, a: any, b: any) {                   // out = a * b (column-major)
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      out.set(o); return out;
    }
    function mat4Identity(out: any) { out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); return out; }
    /* project world point through viewProj → pixel coords; returns w (>0 = in front) */
    function projectPoint(vp: any, p: any, W: number, H: number, out: any) {
      const x = vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12];
      const y = vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13];
      const w = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
      out.x = (x / w * 0.5 + 0.5) * W; out.y = (1 - (y / w * 0.5 + 0.5)) * H;
      return w;
    }
    /*MATH-END*/
    const easeInOut = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    // prefers-reduced-motion: minimal respect — skip the idle sway + ribbon spin.
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ═══════════════════════ GL SETUP ═══════════════════════ */
    const canvas = $("gl") as HTMLCanvasElement;
    const gl: any = canvas.getContext("webgl2", {
      antialias: true, alpha: false, depth: true, stencil: false,
      powerPreference: "low-power", preserveDrawingBuffer: false, desynchronized: true
    });
    if (!gl) {
      root.innerHTML = "<div style='padding:40px;font-family:sans-serif'>WebGL2 required (macOS 12+ / Safari 15+).</div>";
      return;
    }

    const FOG = [0.961, 0.953, 0.937];                       // the white void
    const FOG_NEAR = 15.0, FOG_FAR = 44.0;
    let DPR_MAX = Math.min(window.devicePixelRatio || 1, 1.5); // retina capped: 3D never needs 2×
    let dpr = DPR_MAX, W = 0, H = 0;

    function makeShader(vs: string, fs: string) {
      const c = (t: number, s: string) => {
        const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h);
        if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(h) + "\n" + s); return h;
      };
      const p = gl.createProgram();
      gl.attachShader(p, c(gl.VERTEX_SHADER, vs)); gl.attachShader(p, c(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    const U = (p: any, n: string) => gl.getUniformLocation(p, n);

    /* ── program 1 · SLICE (instanced slabs — every plate in the scene) ── */
    const sliceProg = makeShader(`#version 300 es
      layout(location=0) in vec3 aPos;
      layout(location=1) in float aShade;
      layout(location=2) in vec4 iA;      // xyz = position, w = rotY
      layout(location=3) in vec3 iS;      // scale
      layout(location=4) in vec3 iC;      // color
      uniform mat4 uVP, uModel; uniform vec3 uCam;
      out vec3 vCol; out float vFog;
      void main(){
        vec3 p=aPos*iS;
        float c=cos(iA.w), s=sin(iA.w);
        p=vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z)+iA.xyz;
        vec4 w=uModel*vec4(p,1.0);
        vCol=min(iC*aShade,vec3(1.0));
        vFog=smoothstep(${FOG_NEAR.toFixed(1)},${FOG_FAR.toFixed(1)},distance(w.xyz,uCam));
        gl_Position=uVP*w;
      }`, `#version 300 es
      precision mediump float;
      in vec3 vCol; in float vFog; out vec4 o;
      void main(){ o=vec4(mix(vCol,vec3(${FOG.join(",")}),vFog),1.0); }`);

    /* ── program 2 · LINE (grid, plexus web, crest) ── */
    const lineProg = makeShader(`#version 300 es
      layout(location=0) in vec3 aPos;
      uniform mat4 uVP,uModel; uniform vec3 uCam;
      out float vFog;
      void main(){ vec4 w=uModel*vec4(aPos,1.0);
        vFog=smoothstep(${FOG_NEAR.toFixed(1)},${FOG_FAR.toFixed(1)},distance(w.xyz,uCam));
        gl_Position=uVP*w; }`, `#version 300 es
      precision mediump float;
      uniform vec4 uColor; in float vFog; out vec4 o;
      void main(){ o=vec4(uColor.rgb, uColor.a*(1.0-vFog)); }`);

    /* ── program 3 · GLOW (instanced billboards; radial or shaft falloff in-shader) ── */
    const glowProg = makeShader(`#version 300 es
      layout(location=0) in vec2 aCorner;
      layout(location=1) in vec3 iPos;
      layout(location=2) in vec2 iSize;
      layout(location=3) in vec4 iColA;   // rgb + alpha
      layout(location=4) in float iShape; // 0 radial · 1 shaft · 2 square mote
      uniform mat4 uVP; uniform vec3 uRight,uUp;
      out vec2 vUV; out vec4 vC; out float vShape;
      void main(){
        vUV=aCorner; vC=iColA; vShape=iShape;
        vec3 w=iPos+uRight*aCorner.x*iSize.x+uUp*aCorner.y*iSize.y;
        gl_Position=uVP*vec4(w,1.0);
      }`, `#version 300 es
      precision mediump float;
      in vec2 vUV; in vec4 vC; in float vShape; out vec4 o;
      void main(){
        float a;
        if(vShape<0.5){ a=pow(max(0.0,1.0-length(vUV)),2.2); }
        else if(vShape<1.5){ a=pow(max(0.0,1.0-abs(vUV.x)),3.0)*(1.0-abs(vUV.y)); }
        else { a=step(abs(vUV.x),0.72)*step(abs(vUV.y),0.72); }
        o=vec4(vC.rgb*vC.a*a,1.0);        // premultiplied-ish, additive blend
      }`);

    /* ── program 4 · BACKDROP (fullscreen gradient — the overexposed sky) ── */
    const bgProg = makeShader(`#version 300 es
      layout(location=0) in vec2 aP; out vec2 vUV;
      void main(){ vUV=aP*0.5+0.5; gl_Position=vec4(aP,0.999,1.0); }`, `#version 300 es
      precision mediump float;
      in vec2 vUV; out vec4 o;
      void main(){
        vec3 top=vec3(0.984,0.980,0.969), bot=vec3(0.906,0.894,0.867);
        vec3 c=mix(bot,top,vUV.y);
        c+=vec3(0.05)*pow(max(0.0,1.0-distance(vUV,vec2(0.62,0.66))*1.35),2.0); // soft center hotspot
        o=vec4(c,1.0);
      }`);

    /* ═══════════════════════ GEOMETRY ═══════════════════════ */
    /* slice slab: 5 faces (no bottom — never seen), baked face shading */
    function buildSlabVerts() {
      const P: number[] = [], S: number[] = []; const x = .5, y = .5, z = .5;
      const quad = (a: any, b: any, c: any, d: any, sh: number) => { P.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) S.push(sh); };
      quad([-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z], 1.16);        // top — catches the "light"
      quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], 0.86);        // front
      quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], 0.74);        // right
      quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], 0.86);    // back
      quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], 0.74);    // left
      return { pos: new Float32Array(P), shade: new Float32Array(S), count: P.length / 3 };
    }
    const slab = buildSlabVerts();

    /* instance pools */
    const FLOATS_PER_INST = 10;                        // iA(4) iS(3) iC(3)
    function makePool(cap: number): any {
      return { data: new Float32Array(cap * FLOATS_PER_INST), n: 0, cap, vao: null, buf: null, dirty: true };
    }
    function poolPush(pool: any, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number, r: number, g: number, b: number) {
      const i = pool.n * FLOATS_PER_INST, d = pool.data;
      d[i] = x; d[i + 1] = y; d[i + 2] = z; d[i + 3] = rotY; d[i + 4] = sx; d[i + 5] = sy; d[i + 6] = sz; d[i + 7] = r; d[i + 8] = g; d[i + 9] = b;
      return pool.n++;
    }
    function poolUpload(pool: any) {
      if (!pool.vao) {
        pool.vao = gl.createVertexArray(); gl.bindVertexArray(pool.vao);
        const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.bufferData(gl.ARRAY_BUFFER, slab.pos, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        const sb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sb);
        gl.bufferData(gl.ARRAY_BUFFER, slab.shade, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
        pool.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pool.buf);
        gl.bufferData(gl.ARRAY_BUFFER, pool.data, gl.DYNAMIC_DRAW);
        const st = FLOATS_PER_INST * 4;
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 0); gl.vertexAttribDivisor(2, 1);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, st, 16); gl.vertexAttribDivisor(3, 1);
        gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, st, 28); gl.vertexAttribDivisor(4, 1);
        gl.bindVertexArray(null);
      } else if (pool.dirty) {
        gl.bindBuffer(gl.ARRAY_BUFFER, pool.buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, pool.data, 0, pool.n * FLOATS_PER_INST);
      }
      pool.dirty = false;
    }
    function poolDraw(pool: any, model: any) {
      if (!pool.n) return;
      gl.uniformMatrix4fv(U(sliceProg, "uModel"), false, model);
      gl.bindVertexArray(pool.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, slab.count, pool.n);
      gl.bindVertexArray(null);
    }

    /* colors — the reference's full palette trio (the whole scheme lives here).
       C_DARK was the reference's "empty session" slice; our saves are all real
       red stacks now, so it is retained for palette fidelity but unused. */
    const C_RED = [0.760, 0.243, 0.157], C_GREY = [0.845, 0.828, 0.796], C_DARK = [0.435, 0.278, 0.243];
    void C_DARK;

    /* the static pool: menu stacks, saves, towers — uploaded once, never touched */
    const staticPool = makePool(560);

    /* stack of thin slices; returns anchor info for the callout layer */
    function addStack(x: number, y: number, z: number, n: number, col: number[], { w = 2.3, d = 0.95, t = 0.055, gap = 0.075, rot = -0.38 }: any = {}) {
      for (let i = 0; i < n; i++) {
        poolPush(staticPool,
          x + rand(-.018, .018), y + i * (t + gap) * 1.0, z + rand(-.018, .018),
          rot + rand(-.02, .02), w, t, d, col[0], col[1], col[2]);
      }
      return { x, y: y + n * (t + gap) / 2, z, topY: y + n * (t + gap) };
    }
    function addTower(x: number, z: number, _h: number, slices: number, redAt: number) {
      const t = 0.06, gap = 0.095, w = 1.55;
      for (let i = 0; i < slices; i++) {
        const red = (i >= redAt && i < redAt + 3);
        const shrink = 1 - 0.25 * (i / slices);                       // gentle taper
        poolPush(staticPool, x + rand(-.02, .02), -3.05 + i * (t + gap), z + rand(-.02, .02),
          -0.45 + rand(-.03, .03), w * shrink, t, w * shrink,
          ...(red ? C_RED : C_GREY) as [number, number, number]);
      }
      return { x, topY: -3.05 + slices * (t + gap), z };
    }

    /* ribbons: the giant background sculptures — one pool per ribbon */
    const ribbons: any[] = [];
    function addRibbon(px: number, py: number, pz: number, scale: number, speed: number, phase: number) {
      const pool = makePool(64);
      const N = 52;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const x = Math.sin(t * Math.PI * 1.35 + phase) * 3.1;
        const y = (t - 0.5) * 6.2;
        const z = Math.cos(t * Math.PI * 0.95 + phase) * 1.4;
        const tap = 0.45 + 0.55 * Math.sin(t * Math.PI);              // taper at both ends
        poolPush(pool, x, y, z, t * 2.6 + phase, 3.3 * tap, 0.05, 1.35 * tap, ...C_GREY as [number, number, number]);
      }
      ribbons.push({
        pool, px, py, pz, scale, speed, rot: rand(0, 6), model: new Float32Array(16),
        tmp: new Float32Array(16), tmp2: new Float32Array(16)
      });
    }
    addRibbon(-7.5, 1.6, -9, 1.35, 0.045, 0.0);
    addRibbon(8.5, -0.6, -12, 1.9, -0.028, 2.1);
    addRibbon(2.0, 4.8, -21, 2.6, 0.018, 4.0);
    addRibbon(13.5, -2.2, -7, 1.05, 0.05, 1.2);
    addRibbon(21.0, 3.2, -15, 1.8, -0.022, 3.1);
    addRibbon(-23.5, 3.6, -17, 2.1, 0.02, 5.2);

    /* ═══════════════ SCENE LAYOUT · menu clusters ═══════════════ */
    const anchors: any = {};   // world-space callout anchors, keyed
    /* root */
    anchors.story = addStack(0.0, 1.05, 0.0, 7, C_RED);
    anchors.extras = addStack(0.18, -0.30, 0.12, 7, C_RED);
    anchors.options = addStack(0.36, -1.65, 0.24, 7, C_RED);
    /* MARKETS (saves) — save0 is the big occupied stack + preview card; save1/
       save2 get proper multi-slice red stacks (9 & 7) so real screens don't read
       as empty saves (reference had 1-slice C_DARK "empty session" stubs). */
    anchors.save0 = addStack(16.0, 0.55, -2.0, 13, C_RED, { w: 2.0, d: 0.85 });
    anchors.save1 = addStack(16.15, -0.55, -2.15, 9, C_RED, { w: 2.0, d: 0.85 });
    anchors.save2 = addStack(16.30, -1.45, -2.30, 7, C_RED, { w: 2.0, d: 0.85 });
    /* ANALYSIS (extras) — gallery + credits, plus one ADDED JOURNAL stack in the
       same grammar/spacing so ANALYSIS has three real leaves. */
    anchors.gallery = addStack(3.5, 0.35, -18.0, 5, C_RED, { w: 1.9, d: 0.8 });
    anchors.credits = addStack(3.72, -0.85, -18.25, 5, C_RED, { w: 1.9, d: 0.8 });
    anchors.journal = addStack(3.94, -2.05, -18.5, 5, C_RED, { w: 1.9, d: 0.8 });
    /* SYSTEM towers */
    const TOWER_N = [36, 30, 24, 19, 15];
    anchors.general = addTower(-16.5, -3.5, 0, TOWER_N[0], 27);
    anchors.controls = addTower(-14.9, -4.9, 0, TOWER_N[1], 22);
    anchors.hud = addTower(-13.3, -6.3, 0, TOWER_N[2], 17);
    anchors.stats = addTower(-11.7, -7.7, 0, TOWER_N[3], 13);
    anchors.creds2 = addTower(-10.1, -9.1, 0, TOWER_N[4], 10);

    /* ═══════════════ LINES · grid, plexus, crest ═══════════════ */
    function makeLineBuf(arr: Float32Array, dynamic: boolean): any {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      return { vao, buf: b, n: arr.length / 3 };
    }
    function drawLines(lb: any, model: any, r: number, g: number, b: number, a: number, count?: number) {
      gl.uniformMatrix4fv(U(lineProg, "uModel"), false, model);
      gl.uniform4f(U(lineProg, "uColor"), r, g, b, a);
      gl.bindVertexArray(lb.vao);
      gl.drawArrays(gl.LINES, 0, count || lb.n);
      gl.bindVertexArray(null);
    }
    const IDENT = new Float32Array(16); mat4Identity(IDENT);

    /* floor + back wall grid */
    let gridBuf: any;
    (function () {
      const v: number[] = [], EXT = 64, STEP = 1.9, Y = -3.12, WZ = -27;
      for (let i = -EXT / 2; i <= EXT / 2; i++) {
        v.push(i * STEP, Y, -EXT, i * STEP, Y, EXT); v.push(-EXT, Y, i * STEP, EXT, Y, i * STEP);       // floor
        v.push(i * STEP, -8, WZ, i * STEP, 22, WZ); v.push(-EXT, i * STEP + 6, WZ, EXT, i * STEP + 6, WZ); // wall
      }
      gridBuf = makeLineBuf(new Float32Array(v), false);
    })();

    /* plexus web (boot screen) — points drift in JS, pairs precomputed once */
    const PLX_N = 64;
    const plxBase: any[] = [], plxPh: number[] = [];
    for (let i = 0; i < PLX_N; i++) { plxBase.push(V3(rand(-7, 7), rand(-2.4, 4.6), rand(-2, 6))); plxPh.push(rand(0, 6.28)); }
    const plxPairs: [number, number][] = [];
    for (let i = 0; i < PLX_N; i++) for (let j = i + 1; j < PLX_N; j++)
      if (v3dist(plxBase[i], plxBase[j]) < 2.5) plxPairs.push([i, j]);
    const plxArr = new Float32Array(plxPairs.length * 6);
    const plxLines = makeLineBuf(plxArr, true);
    const plxNow = plxBase.map((p: any) => V3(p.x, p.y, p.z));

    /* abstract crest — original geometric homage (chevron + brackets), line list */
    const crestLines = (function () {
      const s = 1.5, cx = 0, cy = 1.5, cz = 2.0;
      const pts = [[0, 1.9], [-0.95, -0.55], [-0.62, -0.30], [-0.48, -0.95], [0, -0.62],
      [0.48, -0.95], [0.62, -0.30], [0.95, -0.55], [0, 1.9]];
      const v: number[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        v.push(cx + pts[i][0] * s, cy + pts[i][1] * s, cz, cx + pts[i + 1][0] * s, cy + pts[i + 1][1] * s, cz);
      }
      v.push(cx - 0.62 * s, cy - 0.30 * s, cz, cx + 0 * s, cy - 1.28 * s, cz, cx + 0 * s, cy - 1.28 * s, cz, cx + 0.62 * s, cy - 0.30 * s, cz);
      v.push(cx - 0.3 * s, cy + 0.5 * s, cz - 0.4, cx + 0.3 * s, cy + 0.5 * s, cz - 0.4);   // depth hint
      return makeLineBuf(new Float32Array(v), false);
    })();

    /* ═══════════════ GLOWS · sprite bloom, shafts, motes ═══════════════ */
    const GLOW_CAP = 128, GF = 10;                       // pos3 size2 colA4 shape1
    const glowData = new Float32Array(GLOW_CAP * GF);
    let glowN = 0;
    const glowVAO = gl.createVertexArray();
    let glowBuf: any;
    (function () {
      gl.bindVertexArray(glowVAO);
      const q = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, q);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      glowBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glowBuf);
      gl.bufferData(gl.ARRAY_BUFFER, glowData, gl.DYNAMIC_DRAW);
      const st = GF * 4;
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 0); gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, st, 12); gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, st, 20); gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, st, 36); gl.vertexAttribDivisor(4, 1);
      gl.bindVertexArray(null);
    })();
    function glowPush(x: number, y: number, z: number, w: number, h: number, r: number, g: number, b: number, a: number, shape: number) {
      const i = glowN * GF;
      glowData[i] = x; glowData[i + 1] = y; glowData[i + 2] = z; glowData[i + 3] = w; glowData[i + 4] = h;
      glowData[i + 5] = r; glowData[i + 6] = g; glowData[i + 7] = b; glowData[i + 8] = a; glowData[i + 9] = shape;
      glowN++;
    }
    /* motes: slow-drifting white glints */
    const motes: any[] = [];
    for (let i = 0; i < 22; i++) motes.push({
      x: rand(-24, 24), y: rand(-3, 7), z: rand(-22, 4),
      s: rand(.05, .12), ph: rand(0, 6.28), sp: rand(.08, .2)
    });

    /* backdrop quad */
    const bgVAO = gl.createVertexArray();
    (function () {
      gl.bindVertexArray(bgVAO);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    })();

    /* ═══════════════ CALLOUT LAYER · chips + hairlines (DOM/SVG) ═══════════════ */
    const labelRoot = $("labels");
    const leadSVG = $("lead");
    const LABELS: any[] = [];
    function addLabel(node: string, idx: number, _key: string, text: string, cls: string, dx: number, dy: number, ax: number, ay: number, az: number) {
      const el = document.createElement("div");
      el.className = "chip " + (cls || "");
      el.textContent = text;
      labelRoot.appendChild(el);
      const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const sq = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      sq.setAttribute("width", "5"); sq.setAttribute("height", "5");
      leadSVG.appendChild(ln); leadSVG.appendChild(sq);
      const L: any = { node, idx, el, ln, sq, anchor: V3(ax, ay, az), dx, dy, visible: false };
      el.addEventListener("mouseenter", () => { if (state === "IDLE" && current === node && sel !== idx) { sel = idx; applySelection(true); } });
      el.addEventListener("click", () => { if (state === "IDLE" && current === node) { sel = idx; applySelection(false); confirm(); } });
      LABELS.push(L); return L;
    }
    const midY = (a: any) => a.y;
    // ── retitled to Actuality's screens ──
    addLabel("root", 0, "story", "MARKETS", "", 46, -14, anchors.story.x + 1.15, midY(anchors.story), anchors.story.z);
    addLabel("root", 1, "extras", "ANALYSIS", "dim", 46, -12, anchors.extras.x + 1.15, midY(anchors.extras), anchors.extras.z);
    addLabel("root", 2, "options", "SYSTEM", "dim", 46, -12, anchors.options.x + 1.15, midY(anchors.options), anchors.options.z);
    // MARKETS cluster — save0 keeps the "name" chip style (was "Edd"); now DASHBOARD.
    addLabel("story", 0, "save0", "DASHBOARD", "name", 44, -14, anchors.save0.x + 1.05, midY(anchors.save0), anchors.save0.z);
    addLabel("story", 1, "save1", "POSITIONS", "", 44, -12, anchors.save1.x + 1.05, midY(anchors.save1), anchors.save1.z);
    addLabel("story", 2, "save2", "WATCHLIST", "", 44, -12, anchors.save2.x + 1.05, midY(anchors.save2), anchors.save2.z);
    // ANALYSIS cluster — gallery/credits/journal.
    addLabel("extras", 0, "gallery", "PERFORMANCE", "", 44, -14, anchors.gallery.x + 1.0, midY(anchors.gallery), anchors.gallery.z);
    addLabel("extras", 1, "credits", "COMPARE", "dim", 44, -12, anchors.credits.x + 1.0, midY(anchors.credits), anchors.credits.z);
    addLabel("extras", 2, "journal", "JOURNAL", "dim", 44, -12, anchors.journal.x + 1.0, midY(anchors.journal), anchors.journal.z);
    // SYSTEM towers — tower0 SETTINGS is real; 1-4 are "ready soon" placeholders.
    addLabel("options", 0, "general", "SETTINGS", "", 34, -46, anchors.general.x, anchors.general.topY + 0.3, anchors.general.z);
    addLabel("options", 1, "controls", "ORDERS", "dim", 34, -44, anchors.controls.x, anchors.controls.topY + 0.3, anchors.controls.z);
    addLabel("options", 2, "hud", "NEWS", "dim", 34, -44, anchors.hud.x, anchors.hud.topY + 0.3, anchors.hud.z);
    addLabel("options", 3, "stats", "ALERTS", "dim", 34, -44, anchors.stats.x, anchors.stats.topY + 0.3, anchors.stats.z);
    addLabel("options", 4, "creds2", "SCANNER", "dim", 34, -44, anchors.creds2.x, anchors.creds2.topY + 0.3, anchors.creds2.z);

    /* glow anchor per selectable item (red halo behind the focused datum) */
    const GLOW_AT: any = {
      root: [anchors.story, anchors.extras, anchors.options],
      story: [anchors.save0, anchors.save1, anchors.save2],
      extras: [anchors.gallery, anchors.credits, anchors.journal],
      options: [anchors.general, anchors.controls, anchors.hud, anchors.stats, anchors.creds2].map((a: any) => ({ x: a.x, y: a.topY - 0.55, z: a.z })),
    };

    /* ═══════════════ NODES · menus are places, camera is navigation ═══════════════ */
    const nodes: any = {
      root: {
        cam: { pos: V3(-4.6, 2.4, 8.8), look: V3(0.9, -0.1, 0) },
        n: 3, crumb: "ANIMUS · ACTUALITY", parent: null,
        legend: [["↑↓", "NAVIGATE"], ["↵", "SELECT"]]
      },
      story: {
        cam: { pos: V3(11.7, 2.2, 5.6), look: V3(16.3, -0.4, -2.2) },
        n: 3, crumb: "MARKETS", parent: "root",
        legend: [["↑↓", "NAVIGATE"], ["↵", "LOAD"], ["⌫", "BACK"]]
      },
      extras: {
        cam: { pos: V3(0.2, 1.7, -10.4), look: V3(3.9, -0.4, -18.2) },
        n: 3, crumb: "ANALYSIS", parent: "root",
        legend: [["↑↓", "NAVIGATE"], ["↵", "SELECT"], ["⌫", "BACK"]]
      },
      options: {
        cam: { pos: V3(-21.6, 2.5, 4.4), look: V3(-16.4, 0.8, -3.6) },
        n: 5, crumb: "SYSTEM", parent: "root", browse: true,
        legend: [["← →", "BROWSE"], ["↵", "SELECT"], ["⌫", "BACK"]]
      },
    };
    function optionsPose(i: number) {                     // browsing strafes the camera along the tower diagonal
      const b = nodes.options.cam;
      return {
        pos: V3(b.pos.x + i * 1.28, b.pos.y, b.pos.z - i * 0.9),
        look: V3(b.look.x + i * 1.55, b.look.y, b.look.z - i * 1.32)
      };
    }

    // Route map for confirm(): which real screen each selectable leaf dives to.
    // Every tower is now live — the ten Terminal-77 screens (MARKETS + ANALYSIS +
    // all five SYSTEM towers). No "ready soon" placeholders remain.
    const ROUTES: any = {
      story: ["/dashboard", "/positions", "/watchlist"],
      extras: ["/performance", "/compare", "/journal"],
      options: ["/settings", "/orders", "/news", "/alerts", "/scanner"],
    };

    /* ═══════════════ CAMERA ═══════════════ */
    const cam: any = {
      pos: V3(0, 1.6, 19), look: V3(0, 1.0, 0),                    // boot pose
      fromP: V3(), toP: V3(), fromL: V3(), toL: V3(),
      t: 1, dur: 1, tweening: false,
    };
    function flyTo(pose: any, dur: number) {
      v3copy(cam.fromP, cam.pos); v3copy(cam.fromL, cam.look);
      v3copy(cam.toP, pose.pos); v3copy(cam.toL, pose.look);
      cam.t = 0; cam.dur = dur; cam.tweening = true;
    }
    function camUpdate(dt: number) {
      if (!cam.tweening) return;
      cam.t = Math.min(1, cam.t + dt / cam.dur);
      const e = easeInOut(cam.t);
      v3lerp(cam.pos, cam.fromP, cam.toP, e);
      v3lerp(cam.look, cam.fromL, cam.toL, e);
      if (cam.t >= 1) cam.tweening = false;
    }

    /* ═══════════════ STATE ═══════════════ */
    let state = "BOOT";          // BOOT → FLYING → IDLE → (BUSY)
    let current = "root", sel = 0;
    let bootAlpha = 1, bootP = 0, bootTarget = 0.18, bootTime = 0, bootDone = false;
    // Pending timeouts, tracked so unmount mid-flight can't fire callbacks into a
    // torn-down GL context.
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id); return id;
    };

    const crumbTxt = $("crumbtxt");
    const legendEl = $("legend");
    const cardEl = $("card");
    const toastEl = $("toast");

    function renderLegend(list: any[]) {
      legendEl.innerHTML = "";
      for (const [k, txt] of list) {
        const s = document.createElement("span");
        const kk = document.createElement("i"); kk.className = "key"; kk.style.fontStyle = "normal"; kk.textContent = k;
        s.appendChild(kk); s.appendChild(document.createTextNode(txt));
        legendEl.appendChild(s);
      }
    }
    function applySelection(sound: boolean) {
      const node = nodes[current];
      for (const L of LABELS) {
        if (L.node !== current) continue;
        L.el.classList.toggle("on", L.idx === sel);
        L.el.classList.toggle("dim", L.idx !== sel && L.idx !== -1 && !L.el.classList.contains("name"));
        if (L.idx === sel) L.el.classList.remove("dim");
      }
      cardEl.classList.toggle("show", current === "story" && sel === 0 && state !== "BOOT");
      if (node.browse && state === "IDLE") flyTo(optionsPose(sel), 0.38);
      if (sound) SFX.tick();
    }
    function setNode(name: string) {
      current = name; sel = 0;
      const node = nodes[name];
      crumbTxt.textContent = node.crumb;
      renderLegend(node.legend);
      for (const L of LABELS) {
        const on = L.node === name;
        L.visible = on;
        if (!on) {
          L.el.style.transform = "translate3d(-3000px,-3000px,0)"; L.ln.setAttribute("x1", -10); L.ln.setAttribute("x2", -10);
          L.sq.setAttribute("x", -10); L.sq.setAttribute("y", -10);
        }
      }
      applySelection(false);
    }
    function confirm() {
      if (state !== "IDLE") return;
      const targets: any = { root: ["story", "extras", "options"] };
      if (current === "root") {
        SFX.thunk(); SFX.whoosh();
        const to = targets.root[sel];
        state = "FLYING";
        flyTo(nodes[to].browse ? optionsPose(0) : nodes[to].cam, 0.72);
        cardEl.classList.remove("show");
        later(() => { setNode(to); state = "IDLE"; }, 730);
      } else {
        // Leaf level (story / extras / options) — dive to the mapped screen. Every
        // leaf maps to a real route now; the deny/toast only guards a malformed index.
        const route = ROUTES[current] ? ROUTES[current][sel] : undefined;
        if (route) { loadMemory(route); }
        else { SFX.deny(); toast("READY SOON"); }
      }
    }
    function back() {
      if (state !== "IDLE") return;
      const p = nodes[current].parent;
      if (!p) return;
      SFX.whooshBack();
      state = "FLYING";
      cardEl.classList.remove("show");
      flyTo(nodes[p].cam, 0.62);
      later(() => { setNode(p); state = "IDLE"; }, 640);
    }
    function toast(txt: string, ms = 1400) {
      toastEl.textContent = txt; toastEl.style.opacity = "1";
      clearTimeout((toast as any)._t); (toast as any)._t = window.setTimeout(() => toastEl.style.opacity = "0", ms);
    }
    // loadMemory — the reference's real-leaf "load" grammar, rewired to navigate.
    // SFX.thunk+whoosh (as the reference), then the hoisted flash covers the route
    // swap and fades over the mounted screen. We hand navigation to ./flash.ts's
    // triggerFlash so the #flash element (in App.tsx) survives Animus unmounting.
    function loadMemory(route: string) {
      if (state === "BUSY") return; // already diving — ignore a second trigger (race guard)
      state = "BUSY"; SFX.thunk(); SFX.whoosh();
      triggerFlash((r) => navRef.current(r), route);
    }
    // expose the guarded dive to the React JSX (the cog) so it goes through the
    // SAME state-machine path as a menu leaf (BUSY lock + SFX), not a raw flash.
    loadMemoryRef.current = loadMemory;
    function finishBoot() {
      if (bootDone) return; bootDone = true;
      $("boot").classList.add("off");
      SFX.whoosh();
      // Reference's boot flash on the shared white element — here the hoisted
      // #flash (App.tsx) via bootFlash(): opacity 0.55 → 0 over 0.5s.
      bootFlash();
      state = "FLYING";
      flyTo(nodes.root.cam, 1.15);
      later(() => { setNode("root"); state = "IDLE"; }, 1170);
    }

    /* ═══════════════ AUDIO · synthesized, zero assets ═══════════════ */
    const SFX = (function () {
      let ctx: any = null, master: any = null, muted = false, humOn = false;
      function ensure() {
        if (ctx) return true;
        try { ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)(); } catch (e) { return false; }
        master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
        return true;
      }
      function hum() {
        if (humOn || !ensure()) return; humOn = true;
        const len = 2 * ctx.sampleRate, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
        let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3; }
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 110;
        const g = ctx.createGain(); g.gain.value = 0.05;
        src.connect(lp).connect(g).connect(master); src.start();
      }
      function blip(freq: number, dur: number, vol: number, type = "square") {
        if (!ensure()) return;
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(master); o.start(t); o.stop(t + dur);
      }
      function noiseSweep(dur: number, f0: number, f1: number, vol: number) {
        if (!ensure()) return;
        const len = dur * ctx.sampleRate | 0, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource(); src.buffer = buf;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.1;
        const t = ctx.currentTime;
        bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(bp).connect(g).connect(master); src.start(t); src.stop(t + dur);
      }
      return {
        unlock() { if (ensure() && ctx.state === "suspended") ctx.resume(); hum(); },
        tick() { blip(1720, 0.045, 0.10); },
        deny() { blip(240, 0.10, 0.09, "sawtooth"); },
        thunk() { blip(180, 0.16, 0.16, "sine"); blip(1400, 0.03, 0.06); },
        whoosh() { noiseSweep(0.62, 420, 3200, 0.16); },
        whooshBack() { noiseSweep(0.5, 2600, 380, 0.13); },
        toggleMute() { if (!ensure()) return; muted = !muted; master.gain.value = muted ? 0 : 0.5; toast(muted ? "AUDIO MUTED" : "AUDIO ON", 900); },
        /* Deferred 700ms so the 0.62s dive whoosh rings out under the flash;
           closing the ctx also stops the hum loop; safe post-unmount (touches
           no DOM/React state). Do NOT "fix" this into an immediate close — it
           would clip the dive sound. */
        close() { if (ctx) { const c = ctx; ctx = null; master = null; window.setTimeout(() => { try { c.close(); } catch (e) { } }, 700); } },
      };
    })();

    /* ═══════════════ INPUT ═══════════════ */
    const onKeyDown = (e: KeyboardEvent) => {
      SFX.unlock();
      const k = e.key;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Backspace"].includes(k)) e.preventDefault();
      if (state === "BOOT") { if (k === "Enter" || k === " ") finishBoot(); return; }
      if (k === "m" || k === "M") return SFX.toggleMute();
      if (k === "d" || k === "D") { const d = $("dbg"); d.style.display = d.style.display === "block" ? "none" : "block"; return; }
      if (state !== "IDLE") return;
      const node = nodes[current];
      const fwd = (k === "ArrowDown") || (node.browse && k === "ArrowRight");
      const bwd = (k === "ArrowUp") || (node.browse && k === "ArrowLeft");
      if (fwd || bwd) { sel = (sel + (fwd ? 1 : -1) + node.n) % node.n; applySelection(true); }
      else if (k === "Enter" || k === " ") confirm();
      else if (k === "Backspace" || k === "Escape") back();
    };
    const onMouseDown = () => SFX.unlock();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown, { once: true });

    /* ═══════════════ RENDER LOOP ═══════════════ */
    const P = new Float32Array(16), Vm = new Float32Array(16), VP = new Float32Array(16);
    const M_TMP = new Float32Array(16);
    const swayP = V3(), swayL = V3(), projTmp = { x: 0, y: 0 };
    let time = 0, lastT = 0, lastRender = 0, emaMs = 16.7, frameCount = 0, drawCalls = 0;
    const dbgEl = $("dbg");
    if (window.location.search.includes("debug")) dbgEl.style.display = "block";

    function composeTRS(out: any, x: number, y: number, z: number, ry: number, s: number) {
      const c = Math.cos(ry) * s, si = Math.sin(ry) * s;
      out.set([c, 0, -si, 0, 0, s, 0, 0, si, 0, c, 0, x, y, z, 1]);
      return out;
    }
    function resize() {
      const w = window.innerWidth, h = window.innerHeight;
      W = w; H = h;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      mat4Perspective(P, 42 * Math.PI / 180, w / h, 0.1, 140);
    }
    window.addEventListener("resize", resize); resize();

    function updateBoot(dt: number) {
      bootTime += dt * 1000;
      const steps: [number, number][] = [[0, 0.18], [420, 0.44], [900, 0.63], [1400, 0.85], [1850, 1.0]];
      for (const [ms, v] of steps) if (bootTime >= ms) bootTarget = v;
      bootP += (bootTarget - bootP) * Math.min(1, dt * 3.2);
      (root!.querySelector("#animus-pbar i") as HTMLElement).style.width = (bootP * 100).toFixed(1) + "%";
      if (bootP > 0.992 && bootTime > 2300) finishBoot();
    }
    function updatePlexus() {
      for (let i = 0; i < PLX_N; i++) {
        const b = plxBase[i], ph = plxPh[i];
        v3set(plxNow[i],
          b.x + Math.sin(time * 0.31 + ph) * 0.34,
          b.y + Math.sin(time * 0.23 + ph * 1.7) * 0.28,
          b.z + Math.sin(time * 0.27 + ph * 0.6) * 0.30);
      }
      let k = 0;
      for (const [i, j] of plxPairs) {
        const a = plxNow[i], b = plxNow[j];
        plxArr[k++] = a.x; plxArr[k++] = a.y; plxArr[k++] = a.z;
        plxArr[k++] = b.x; plxArr[k++] = b.y; plxArr[k++] = b.z;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, plxLines.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, plxArr);
    }
    function buildGlows() {
      glowN = 0;
      /* light shafts, far back — the "overexposed room" */
      const shafts = [[-9, -24], [-2, -27], [4, -22], [11, -26], [18, -23]];
      for (let i = 0; i < shafts.length; i++) {
        const sway = Math.sin(time * 0.11 + i * 1.7) * 0.6;
        glowPush(shafts[i][0] + sway, 6, shafts[i][1], 2.2, 15, 1, 1, 1, 0.10 + 0.03 * Math.sin(time * 0.23 + i), 1);
      }
      glowPush(1.5, 0.5, -16, 15, 9, 1, 1, 1, 0.13, 0);                     // center bloom pool
      /* selection halo */
      if (state !== "BOOT") {
        const g = GLOW_AT[current] && GLOW_AT[current][sel];
        if (g) glowPush(g.x, g.y, g.z, 2.7, 1.5, 1, 0.42, 0.28, 0.30 + 0.09 * Math.sin(time * 3.1), 0);
      }
      /* motes */
      for (const m of motes) {
        const y = m.y + Math.sin(time * m.sp + m.ph) * 0.8;
        glowPush(m.x, y, m.z, m.s, m.s, 1, 1, 1, 0.5 + 0.3 * Math.sin(time * 0.7 + m.ph), 2);
      }
      /* boot constellation dots */
      if (bootAlpha > 0.01) for (let i = 0; i < PLX_N; i++) {
        const p = plxNow[i];
        glowPush(p.x, p.y, p.z, 0.07, 0.07, 1, 1, 1, 0.85 * bootAlpha, 2);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, glowBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, glowData, 0, glowN * GF);
    }
    function updateLabels() {
      for (const L of LABELS) {
        if (!L.visible) continue;
        const w = projectPoint(VP, L.anchor, W, H, projTmp);
        if (w <= 0) {
          L.el.style.transform = "translate3d(-3000px,-3000px,0)";
          L.ln.setAttribute("x1", -10); L.ln.setAttribute("x2", -10); continue;
        }
        const ax = projTmp.x, ay = projTmp.y;
        const cx = ax + L.dx, cy = ay + L.dy;
        L.el.style.transform = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0)`;
        L.ln.setAttribute("x1", ax.toFixed(1)); L.ln.setAttribute("y1", ay.toFixed(1));
        L.ln.setAttribute("x2", (cx - 6).toFixed(1)); L.ln.setAttribute("y2", (cy + 13).toFixed(1));
        L.sq.setAttribute("x", (ax - 2.5).toFixed(1)); L.sq.setAttribute("y", (ay - 2.5).toFixed(1));
      }
    }

    let rafId = 0;
    let alive = true;
    function frame(t: number) {
      if (!alive) return;
      rafId = requestAnimationFrame(frame);
      if (document.hidden) return;
      /* ProMotion cap: hold the menu at ~60 — halves GPU load on 120Hz panels */
      if (t - lastRender < 15.2) return;
      const dt = Math.min(0.05, (t - (lastT || t)) / 1000);
      lastT = t;
      const frameGap = t - lastRender; lastRender = t;
      time += dt;

      /* adaptive resolution: follow measured frame pacing */
      emaMs = emaMs * 0.95 + Math.min(frameGap, 50) * 0.05;
      if (++frameCount % 48 === 0) {
        if (emaMs > 19 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.25); resize(); }
        else if (emaMs < 12 && dpr < DPR_MAX) { dpr = Math.min(DPR_MAX, dpr + 0.25); resize(); }
      }

      if (state === "BOOT") { updateBoot(dt); }
      if (bootDone && bootAlpha > 0) bootAlpha = Math.max(0, bootAlpha - dt * 1.4);
      camUpdate(dt);

      /* idle sway — the Animus is always running (skipped under reduced-motion) */
      const sw = cam.tweening ? 0.35 : 1;
      if (reduceMotion) {
        v3set(swayP, cam.pos.x, cam.pos.y, cam.pos.z);
        v3set(swayL, cam.look.x, cam.look.y, cam.look.z);
      } else {
        v3set(swayP, cam.pos.x + Math.sin(time * 0.13) * 0.10 * sw, cam.pos.y + Math.sin(time * 0.09) * 0.06 * sw, cam.pos.z);
        v3set(swayL, cam.look.x + Math.sin(time * 0.11) * 0.05 * sw, cam.look.y + Math.sin(time * 0.07) * 0.04 * sw, cam.look.z);
      }
      mat4LookAt(Vm, swayP, swayL, V3(0, 1, 0));
      mat4Multiply(VP, P, Vm);
      drawCalls = 0;

      /* ── draw ── */
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(bgProg);
      gl.bindVertexArray(bgVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); drawCalls++;
      gl.bindVertexArray(null);

      gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(sliceProg);
      gl.uniformMatrix4fv(U(sliceProg, "uVP"), false, VP);
      gl.uniform3f(U(sliceProg, "uCam"), swayP.x, swayP.y, swayP.z);
      poolUpload(staticPool);
      poolDraw(staticPool, IDENT); drawCalls++;
      for (const r of ribbons) {
        if (!reduceMotion) r.rot += r.speed * dt * 10;
        composeTRS(r.model, r.px, r.py, r.pz, r.rot, r.scale);
        poolUpload(r.pool); poolDraw(r.pool, r.model); drawCalls++;
      }

      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.useProgram(lineProg);
      gl.uniformMatrix4fv(U(lineProg, "uVP"), false, VP);
      gl.uniform3f(U(lineProg, "uCam"), swayP.x, swayP.y, swayP.z);
      drawLines(gridBuf, IDENT, 1, 1, 1, 0.5); drawCalls++;
      if (bootAlpha > 0.01) {
        updatePlexus();
        drawLines(plxLines, IDENT, 0.72, 0.70, 0.66, 0.34 * bootAlpha); drawCalls++;
        composeTRS(M_TMP, 0, 0, 0, Math.sin(time * 0.4) * 0.18, 1);
        drawLines(crestLines, M_TMP, 0.80, 0.78, 0.74, 0.9 * bootAlpha); drawCalls++;
      }

      gl.blendFunc(gl.ONE, gl.ONE);                          // additive: the "bloom"
      gl.useProgram(glowProg);
      gl.uniformMatrix4fv(U(glowProg, "uVP"), false, VP);
      gl.uniform3f(U(glowProg, "uRight"), Vm[0], Vm[4], Vm[8]);
      gl.uniform3f(U(glowProg, "uUp"), Vm[1], Vm[5], Vm[9]);
      buildGlows();
      gl.bindVertexArray(glowVAO);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, glowN); drawCalls++;
      gl.bindVertexArray(null);
      gl.depthMask(true); gl.disable(gl.BLEND);

      updateLabels();
      if (dbgEl.style.display === "block")
        dbgEl.textContent = `${(1000 / Math.max(1, emaMs)).toFixed(0)}fps · dpr ${dpr} · ${drawCalls} draws · ${glowN} glows`;
    }

    /* boot the legend with a skip hint, then go */
    renderLegend([["↵", "SKIP"]]);
    crumbTxt.textContent = "MEMORY SYNC";
    rafId = requestAnimationFrame(frame);

    /* ═══════════════ TEARDOWN ═══════════════ */
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", resize);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      clearTimeout((toast as any)._t);
      SFX.close();
      // Free the WebGL context — canvas removal (React unmount) usually suffices,
      // but the extension makes the GPU release deterministic.
      try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch (e) { }
    };
  }, []);

  // The DASHBOARD preview card's readout: the user's 24-hour gain/loss.
  // getDaySummary() is pure (placeholder under VITE_MOCK; null live — see
  // ./daySummary.ts). Computed at render; the card's SHOW/HIDE is CSS-driven by
  // applySelection(), so no React state or the once-run effect is involved.
  const day = getDaySummary();
  const dayUp = day ? day.deltaMinor >= 0 : true;
  // Signed money in the account's minor units → "+£2.10" / "−£3.40". mock is
  // GBP; kept local (no dependency on the data screens' formatter) so the Animus
  // world stays self-contained. Percent to 2dp, magnitude only (sign on triangle).
  const dayAmount = day
    ? (dayUp ? "+" : "−") +
      new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 })
        .format(Math.abs(day.deltaMinor) / 100)
    : "—";
  const dayPct = day
    ? new Intl.NumberFormat("en-GB", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(Math.abs(day.pct))
    : "";

  return (
    <div id="animus-root" ref={rootRef}>
      <canvas id="animus-gl" />
      <svg id="animus-lead" />
      <div id="animus-labels" />

      <div id="animus-card">
        <span className="loc">DASHBOARD</span>
        <div className={"day" + (day ? (dayUp ? " up" : " down") : " pending")}>
          <span className="day-lab">24H</span>
          {day ? (
            <div className="day-read">
              {/* drawn ▲/▼ in INK (loss may also read via the world's red) — never an emoji */}
              <svg className="day-tri" viewBox="0 0 10 10" aria-hidden="true">
                {dayUp ? <path d="M5 1 L9 8 L1 8 Z" fill="currentColor" /> : <path d="M5 9 L1 2 L9 2 Z" fill="currentColor" />}
              </svg>
              <span className="day-amt">{dayAmount}</span>
              <span className="day-pct">{dayPct}</span>
            </div>
          ) : (
            <div className="day-read">
              <span className="day-amt">—</span>
            </div>
          )}
        </div>
        <span className="ts">
          {day ? <>LOCAL&nbsp;&nbsp;·&nbsp;&nbsp;24H&nbsp;Δ</> : <>LOCAL&nbsp;&nbsp;·&nbsp;&nbsp;SYNC&nbsp;PENDING</>}
        </span>
      </div>

      <div id="animus-bar">
        <div id="animus-crumb"><span className="dia" /><span id="animus-crumbtxt">ANIMUS · ACTUALITY</span></div>
        <span className="sp" />
        <div id="animus-legend" />
      </div>

      <div id="animus-boot"><div id="animus-pbar"><i /></div><div id="animus-bootlab" className="wm-boot">act<span className="u">ual</span>ity</div></div>
      <div id="animus-toast" />
      <div id="animus-dbg" />
      <div id="animus-hint">ACTUALITY — ANIMUS INTERFACE</div>

      {/* Cog shortcut — top-right of the menu HUD. A one-click jump straight to
          Settings (also reachable from the SYSTEM tower's first leaf). Dives
          under the SAME white flash the menu leaves use (triggerFlash → "/
          settings"). pointer-events:auto + role=button + Enter/Space so it's
          both clickable and keyboard-operable. Lives in the DOM overlay layer
          (a sibling of #animus-hint), never inside the WebGL canvas. */}
      <div
        id="animus-cog"
        role="button"
        tabIndex={0}
        aria-label="Settings"
        title="Settings"
        onClick={() => loadMemoryRef.current?.("/settings")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation(); // don't let the native key ALSO reach the Animus window keydown → confirm() → a second dive
            loadMemoryRef.current?.("/settings");
          }
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
        </svg>
      </div>
    </div>
  );
}
