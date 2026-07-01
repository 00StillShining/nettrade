import ReactDOM from "react-dom/client";

// NOTE: no <React.StrictMode> — it double-invokes effects in dev, which made the
// Dashboard's 16 canvases re-init/flicker on load. Prod builds are unaffected either way.
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (import.meta.env.VITE_SPIKE) {
  const { default: Spike } = await import("./spike/Spike");
  root.render(<Spike />);
} else {
  // index.css is imported statically inside App.tsx (not dynamically here):
  // a dynamic `await import("./index.css")` hangs in the packaged WKWebView
  // asset protocol, which blocked render entirely (Chromium hid the bug).
  const { default: App } = await import("./App");
  root.render(<App />);
}
