import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * useScreenNav — app-wide keyboard navigation for the data screens.
 *
 * Hub-and-spoke shortcuts that work from any screen:
 *   1..7  → jump straight to a screen (menu order)
 *   0 / M → back to the main menu ("/")
 *
 * Guards: ignores the keys while the user is typing in a form field
 * (input / textarea / select / contentEditable) and when a modifier
 * (⌘/Ctrl/Alt) is held, so it never fights real text entry or browser
 * shortcuts. Esc is intentionally left alone — each screen uses it to
 * close an expanded chart.
 */
export const SCREEN_ROUTES: { key: string; label: string; route: string }[] = [
  { key: "1", label: "Dashboard", route: "/dashboard" },
  { key: "2", label: "Positions", route: "/positions" },
  { key: "3", label: "Watchlist", route: "/watchlist" },
  { key: "4", label: "Performance", route: "/performance" },
  { key: "5", label: "Compare", route: "/compare" },
  { key: "6", label: "Journal", route: "/journal" },
  { key: "7", label: "Settings", route: "/settings" },
];

export function useScreenNav(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;

      if (e.key >= "1" && e.key <= "7") {
        e.preventDefault();
        navigate(SCREEN_ROUTES[Number(e.key) - 1].route);
      } else if (e.key === "0" || e.key === "m" || e.key === "M") {
        e.preventDefault();
        navigate("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
