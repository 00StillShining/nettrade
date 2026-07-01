import Chrome from "../shell/Chrome";
import s from "./Placeholder.module.css";

/**
 * Placeholder — a shared cream-paper stand-in (SCREEN_PATTERNS.md §7 the
 * locked recipe) for the data screens not yet built in Phase 2 (Watchlist,
 * Performance, Compare, Journal, Settings). Honest empty state: names the
 * screen and says plainly it's coming — never fakes data. Rendered inside
 * the same dark <Chrome> shell as every other screen.
 */
export default function Placeholder({ name }: { name: string }) {
  return (
    <Chrome
      title={name.toUpperCase()}
      env="live"
      accountLabel="DEFAULT"
      connection="no-key"
      lastSyncISO={null}
      positionsCount={0}
      rateLimitNote="1 req/s"
    >
      <div className={s.screen}>
        <div className={s.panel}>
          <div className={s.ribbon}>{name}</div>
          <div className={s.title}>{name}</div>
          <p className={s.note}>This screen isn&rsquo;t built yet.</p>
          <span className={s.pill}>Coming in Phase 2</span>
        </div>
      </div>
    </Chrome>
  );
}
