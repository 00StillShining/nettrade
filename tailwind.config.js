/** @type {import('tailwindcss').Config} */
// Theme extends the CSS variables defined in src/styles/tokens.css.
// Tune palette/skew/glow there; this file just exposes them to Tailwind utilities.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        paper: "var(--paper)",
        orange: {
          DEFAULT: "var(--orange)",
          deep: "var(--orange-deep)",
          bright: "var(--orange-bright)",
        },
        red: { DEFAULT: "var(--red)" },
        cyan: { DEFAULT: "var(--cyan)" },
        teal: { DEFAULT: "var(--teal)" },
        peri: "var(--peri)",
        rust: "var(--rust)",
      },
      fontFamily: {
        bangers: ['"Bangers"', '"Anton"', '"Archivo Black"', "system-ui", "sans-serif"],
        display: ['"Unbounded"', "sans-serif"],
        chakra: ['"Chakra Petch"', "sans-serif"],
        mono: ['"Space Mono"', "monospace"],
        led: ['"Share Tech Mono"', "monospace"],
      },
      boxShadow: {
        glow: "var(--glow-box)",
        "glow-cyan": "var(--glow-box-cyan)",
      },
      dropShadow: {
        neon: "0 0 6px rgba(255,90,0,.6)",
        "neon-hot": "0 0 10px rgba(255,120,30,.85)",
      },
      transitionTimingFunction: {
        snap: "cubic-bezier(.16,1.2,.3,1)",
      },
    },
  },
  plugins: [],
};
