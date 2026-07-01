/**
 * Shared animated liquid-marble — the <NtMarble/> element + the once-per-screen
 * <MarbleDefs/> (#ntMarble SVG <symbol> + animated warp filters + dot pattern).
 *
 * These were byte-identical in Dashboard.tsx and Positions.tsx; the only thing
 * that re-skins them per screen is the six --mrb-* CSS vars on the host .screen,
 * so the components stay generic and read those vars directly.
 *
 * They are passed the host screen's CSS-module class map (`cls`) rather than
 * owning their own CSS module. This is deliberate and load-bearing for a
 * byte-identical render: each screen's *.module.css keeps the `.ntMarble` /
 * `.marbleDrift` rules AND the descendant selectors that depend on them being
 * locally scoped (`.rhead .ntMarble`, `.frtag .ntMarble`,
 * `.deckHead .dh-tag .ntMarble`). Handing in `cls` keeps those scoped names
 * intact so nothing about the painted output changes.
 */

/* The host screen's CSS-module class map. Typed as an index signature so a
   `*.module.css` import (CSSModuleClasses) assigns cleanly; the only keys read
   here are `ntMarble` and `marbleDrift`. */
type Cls = Record<string, string>;

/* Reusable animated liquid-marble. Renders a <use> of the shared #ntMarble
   symbol. Drives ALL its colour from the --mrb-* palette on the nearest ancestor
   that defines it (the host .screen). Pass an extra class to tweak z-index per
   host (frmarble / screenmarble). */
export function NtMarble({ cls, className }: { cls: Cls; className?: string }) {
  return (
    <div className={[cls.ntMarble, className].filter(Boolean).join(" ")}>
      <svg>
        <use href="#ntMarble" />
      </svg>
    </div>
  );
}

/* The shared SVG <symbol> + animated filters, defined ONCE per screen. */
export function MarbleDefs({ cls }: { cls: Cls }) {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="ntWarp" x="-15%" y="-15%" width="130%" height="130%">
          {/* Static turbulence — the SMIL baseFrequency morph was re-rasterizing
              this displacement filter every frame and caused screen-wide flicker.
              The marble still drifts via a GPU-composited transform on `.ntMarble > svg`. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.0085 0.0052" numOctaves={3} seed={11} result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale={240} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="ntWarp2" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.013 0.020" numOctaves={2} seed={4} result="w2" />
          <feDisplacementMap in="SourceGraphic" in2="w2" scale={90} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <pattern id="ntDots" width={14} height={14} patternUnits="userSpaceOnUse">
          <circle cx={3} cy={3} r={1.5} fill="#0c1012" />
        </pattern>
        <symbol id="ntMarble" viewBox="0 0 1300 760" preserveAspectRatio="xMidYMid slice">
          <g className={cls.marbleDrift}>
            <rect x={-120} y={-120} width={1540} height={1000} fill="var(--mrb-base)" />
            <g filter="url(#ntWarp)">
              <path d="M-120,80 C300,10 360,320 200,520 C40,700 380,720 300,980 L-160,980 Z" fill="var(--mrb-veil)" />
              <path d="M1300,-60 C1120,180 1240,400 980,560 C720,720 980,940 820,1080 L1360,1080 L1360,-80 Z" fill="var(--mrb-veil)" />
              <path d="M-100,300 C260,220 360,480 200,620 C80,730 360,740 300,940 L120,1000 L-120,1000 Z" fill="var(--mrb-mid)" />
              <path d="M620,-60 C840,120 660,360 900,500 C1140,640 980,860 1240,960 L1360,1000 L1360,-80 Z" fill="var(--mrb-bright)" opacity={0.55} />
              <path d="M-60,480 C220,420 280,640 160,740 C60,820 280,860 260,1000 L120,1040 L-100,1040 Z" fill="var(--mrb-core)" />
              <path d="M860,540 C940,660 840,800 980,880 C1120,960 1020,1060 1180,1120 L1360,1160 L1360,560 Z" fill="var(--mrb-base)" />
              <path d="M220,560 C360,520 400,760 280,840 C170,910 280,640 220,680 C340,600 140,600 220,560 Z" fill="var(--mrb-bright)" />
              <path d="M640,700 C740,660 780,860 680,920 C600,960 660,760 600,780 Z" fill="var(--mrb-mid)" opacity={0.92} />
              <path d="M-120,860 C200,820 300,1000 180,1080 L-120,1120 Z" fill="var(--mrb-deep)" />
              <ellipse cx={430} cy={140} rx={110} ry={150} fill="var(--mrb-deep)" />
              <ellipse cx={1080} cy={240} rx={120} ry={160} fill="var(--mrb-bright)" opacity={0.35} />
            </g>
            <g filter="url(#ntWarp2)" opacity={0.7}>
              <path d="M-120,150 C300,120 600,260 980,320" fill="none" stroke="var(--mrb-deep)" strokeWidth={34} />
              <path d="M-120,260 C320,230 600,360 980,420" fill="none" stroke="var(--mrb-bright)" strokeWidth={18} opacity={0.7} />
              <path d="M-120,560 C320,530 600,660 980,720" fill="none" stroke="var(--mrb-bright)" strokeWidth={22} opacity={0.85} />
              <path d="M-120,680 C300,650 560,760 940,840" fill="none" stroke="var(--mrb-veil)" strokeWidth={26} />
              <path d="M-120,860 C300,830 560,920 940,1000" fill="none" stroke="var(--mrb-mid)" strokeWidth={30} />
            </g>
            <rect x={-120} y={-120} width={1540} height={1000} fill="url(#ntDots)" opacity={0.1} />
          </g>
        </symbol>
      </defs>
    </svg>
  );
}
