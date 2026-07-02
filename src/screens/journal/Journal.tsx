import { useMemo, useState } from "react";
import Chrome from "../../shell/Chrome";
import { MOCK_JOURNAL } from "../../data/mockJournal";
import {
  JOURNAL_TAGS,
  type JournalEntry,
  type JournalTag,
} from "./journalTypes";
import s from "./Journal.module.css";

/**
 * Journal — the SDN "written-content" surface (VISUAL_DIRECTION.md §5
 * "Journal"; SCREEN_PATTERNS.md §7 the locked cream-paper recipe). This is
 * the CALMEST, most "paper," LEAST kinetic data screen — where the humanist
 * body type tier (Public Sans) shines and there is deliberately NO gain/loss
 * glow (a journal entry has no P/L to colour; colour here would be noise).
 *
 * Function-first (actuality-ui skill §1-2): answers ONE question — "what have
 * I written down about my trading, and what's the shape of it?" — via a
 * scrollable collection of ink-outlined note cards, each with a neutral date
 * caption ribbon + optional ink-outline tag pills + an optional ticker chip.
 * ONE hero: the amber "JOURNAL" ribbon + a calm summary (entry count, the tag
 * filter, an Add-entry affordance).
 *
 * Same shell/data-wiring pattern as Positions/Watchlist: Chrome owns the dark
 * frame + telemetry/status bars; this screen owns only the cream content
 * between them. Mock builds (VITE_MOCK) render placeholder entries; the live
 * container renders an honest empty state because journal persistence to
 * SQLite is a LATER task — this screen never touches src/db this sprint.
 */

/** DD MMM YYYY from an ISO date, for the neutral caption ribbon. Mono, so it
 * reads as a machine-stamped timestamp (actuality-ui skill §3: mono is the
 * shorthand for "machine-generated"), never P/L-coloured. */
function fmtEntryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** One ink-outline tag pill. Text pills (not emoji) keep the "one icon voice"
 * the design direction asks for — WIN/MISTAKE carry a drawn ★/☠-style mark as
 * a bracketed glyph in PLAIN text so it renders identically everywhere and
 * never pulls in an emoji font. All pills are the SAME neutral ink-outline on
 * cream: this screen has no gain/loss palette, so a WIN is not green and a
 * MISTAKE is not red — the words carry the meaning, calmly. */
const TAG_LABEL: Record<JournalTag, string> = {
  WIN: "★ WIN",
  MISTAKE: "✕ MISTAKE",
  LESSON: "LESSON",
  WATCHING: "WATCHING",
};

function TagPill({ tag }: { tag: JournalTag }) {
  return <span className={s.tagPill}>{TAG_LABEL[tag]}</span>;
}

/** One journal note card — the cream recipe (SCREEN_PATTERNS §7) applied per
 * entry, kept as quiet as possible: cream fill + paper-grain + ink outline, a
 * NEUTRAL date caption ribbon (paper-2 tan, never a coloured/P-L ribbon), a
 * humanist-type title + body, then the tag pills + optional ticker chip. */
function EntryCard({ entry }: { entry: JournalEntry }) {
  return (
    <article className={s.card}>
      <div className={s.captionRibbon}>
        <span className={s.captionDate}>{fmtEntryDate(entry.dateISO)}</span>
        {entry.ticker && <span className={s.tickerChip}>{entry.ticker}</span>}
      </div>

      <div className={s.cardBody}>
        <h3 className={s.entryTitle}>{entry.title}</h3>
        <p className={s.entryText}>{entry.body}</p>

        {entry.tags.length > 0 && (
          <div className={s.tagRow}>
            {entry.tags.map((t) => (
              <TagPill key={t} tag={t} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

/** The Add-entry composer — a small in-panel form that appends to LOCAL
 * component state only. Persistence to SQLite is a LATER task (this sprint
 * must not touch src/db), so an appended entry lives only for the session;
 * the composer says so honestly rather than implying it's saved forever. */
function Composer({ onAdd }: { onAdd: (title: string, body: string, tags: JournalTag[]) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<JournalTag[]>([]);

  const canSave = title.trim().length > 0 && body.trim().length > 0;

  function reset() {
    setTitle("");
    setBody("");
    setTags([]);
    setOpen(false);
  }

  function toggleTag(t: JournalTag) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function save() {
    if (!canSave) return;
    onAdd(title.trim(), body.trim(), tags);
    reset();
  }

  if (!open) {
    return (
      <button type="button" className={s.addBtn} onClick={() => setOpen(true)}>
        + Add entry
      </button>
    );
  }

  return (
    <div className={s.composer}>
      <input
        className={s.composerTitle}
        type="text"
        placeholder="Title — what happened?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Entry title"
        autoFocus
      />
      <textarea
        className={s.composerBody}
        placeholder="A sentence or two, in your own words…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Entry body"
        rows={3}
      />
      <div className={s.composerTags} role="group" aria-label="Tags">
        {JOURNAL_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            className={`${s.tagToggle} ${tags.includes(t) ? s.tagToggleOn : ""}`}
            aria-pressed={tags.includes(t)}
            onClick={() => toggleTag(t)}
          >
            {TAG_LABEL[t]}
          </button>
        ))}
      </div>
      <div className={s.composerFoot}>
        {/* Honest about what "save" means right now — session-only until the
            SQLite journal store lands (a later task). */}
        <span className={s.composerNote}>Kept for this session only — local storage arrives later.</span>
        <div className={s.composerActions}>
          <button type="button" className={s.composerCancel} onClick={reset}>
            Cancel
          </button>
          <button type="button" className={s.composerSave} onClick={save} disabled={!canSave}>
            Save entry
          </button>
        </div>
      </div>
    </div>
  );
}

interface JournalData {
  /** Seed entries to start from (mock placeholder set, or empty for live). */
  seed: JournalEntry[];
  /** Whether journal persistence is actually wired (it isn't yet — the live
   * path passes false and shows the honest empty state). */
  persisted: boolean;
  /** Honest connection state for Chrome — the Trading 212 link is unverified
   * on this screen (nothing is probed and no key is checked), so both
   * containers pass "no-key" rather than fabricate a CONNECTED pill. */
  connection: "ok" | "loading" | "no-key" | "error";
  lastSyncISO: string | null;
}

function JournalView({ seed, persisted, connection, lastSyncISO }: JournalData) {
  // Local session state — seeded from the incoming set. New entries append
  // here only (no SQLite this sprint — see Composer's doc comment).
  const [entries, setEntries] = useState<JournalEntry[]>(seed);
  // null = "All"; otherwise filter to a single tag.
  const [filter, setFilter] = useState<JournalTag | null>(null);

  function addEntry(title: string, body: string, tags: JournalTag[]) {
    const now = new Date();
    // Stamp the writer's LOCAL date — an entry written after 11pm UK (or any
    // TZ offset) should carry today's local day, not the UTC day. fmtEntryDate
    // uses timeZone: "UTC", so it renders this date-only string verbatim.
    const dateISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    setEntries((prev) => [
      { id: `local-${now.getTime()}`, dateISO, title, body, tags },
      ...prev,
    ]);
  }

  // Newest first (by date), then apply the tag filter. Sort is stable on the
  // ISO date string; session-added entries carry today's date so they land at
  // the top naturally.
  const sorted = useMemo(
    () => [...entries].sort((a, b) => (a.dateISO < b.dateISO ? 1 : a.dateISO > b.dateISO ? -1 : 0)),
    [entries],
  );
  const visible = useMemo(
    () => (filter === null ? sorted : sorted.filter((e) => e.tags.includes(filter))),
    [sorted, filter],
  );

  // Live builds with no persistence show the honest empty state instead of
  // fabricating entries. Mock builds always have the seed.
  const showEmpty = !persisted && entries.length === 0;

  return (
    <Chrome
      title="JOURNAL"
      env="live"
      accountLabel="DEFAULT"
      connection={connection}
      lastSyncISO={lastSyncISO}
      positionsCount={null}
      rateLimitNote="local"
    >
      <div className={s.screen}>
        {/* ============================== HERO — the calm summary ============================== */}
        <section className={s.hero} aria-label="Journal summary">
          <div className={s.heroRibbon}>Journal</div>
          <div className={s.heroRow}>
            <div className={s.heroStat}>
              <div className={s.heroLabel}>Entries</div>
              <div className={s.heroValue}>{entries.length}</div>
            </div>
            <div className={s.heroCopy}>
              <p className={s.heroNote}>
                Your private trading log — wins, mistakes, lessons and what you&rsquo;re watching, in your own
                words. Private to this Mac and never uploaded — local storage is being wired, so entries are kept
                for this session.
              </p>
            </div>
            <div className={s.heroAction}>
              <Composer onAdd={addEntry} />
            </div>
          </div>

          {/* Tag filter — calm ink-outline keycaps, active = amber (the ONE
              accent). Scopes the collection below without any P/L colour. */}
          {entries.length > 0 && (
            <div className={s.filterRow} role="group" aria-label="Filter by tag">
              <span className={s.filterLabel}>Filter</span>
              <button
                type="button"
                className={`${s.filterBtn} ${filter === null ? s.filterBtnActive : ""}`}
                aria-pressed={filter === null}
                onClick={() => setFilter(null)}
              >
                All
              </button>
              {JOURNAL_TAGS.map((t) => {
                const count = entries.filter((e) => e.tags.includes(t)).length;
                return (
                  <button
                    key={t}
                    type="button"
                    className={`${s.filterBtn} ${filter === t ? s.filterBtnActive : ""}`}
                    aria-pressed={filter === t}
                    onClick={() => setFilter(filter === t ? null : t)}
                  >
                    {TAG_LABEL[t]} <span className={s.filterCount}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ============================== EMPTY (live, no persistence yet) ============================== */}
        {showEmpty && (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>No entries yet</div>
            <p>
              Your journal is private and stored locally. Start writing with &ldquo;Add entry&rdquo; above — local
              storage is being wired now, so entries you add are kept for this session until it lands.
            </p>
          </div>
        )}

        {/* ============================== ENTRIES PANEL ============================== */}
        {!showEmpty && (
          <section className={s.panel} aria-label="Journal entries">
            <div className={s.panelHead}>
              <span className={s.panelTitle}>Entries</span>
              <span className={s.panelMeta}>
                {filter === null
                  ? `${visible.length} ${visible.length === 1 ? "entry" : "entries"}`
                  : `${visible.length} tagged ${TAG_LABEL[filter]}`}
              </span>
            </div>
            <div className={s.listScroll}>
              {visible.length === 0 ? (
                <div className={s.filterEmpty}>
                  Nothing tagged {filter ? TAG_LABEL[filter] : ""} yet.
                </div>
              ) : (
                <div className={s.list}>
                  {visible.map((e) => (
                    <EntryCard key={e.id} entry={e} />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </Chrome>
  );
}

/** Live container — journal persistence (SQLite) is a LATER task, so this
 * honestly starts EMPTY rather than fabricate entries. Session-added entries
 * are kept in component state only until the store is wired. */
function LiveJournal() {
  // "no-key" — the Trading 212 link is unverified on this screen (nothing is
  // probed, no key checked), matching Settings' no-fake-Connected rule.
  return <JournalView seed={[]} persisted={false} connection="no-key" lastSyncISO={null} />;
}

/** Mock container — placeholder entries for design iteration (VITE_MOCK
 * builds). Never touches persistence, so no storage layer is needed while we
 * tune the paper layout. */
function MockJournal() {
  // "no-key" too — even the mock build must not fabricate a CONNECTED pill on
  // the Journal screen (this screen never probes the live link). lastSyncISO is
  // null to match: a sync can't have happened with no key (LiveJournal pairs
  // no-key with null too), so the chrome tells one consistent story.
  return <JournalView seed={MOCK_JOURNAL} persisted={false} connection="no-key" lastSyncISO={null} />;
}

/** Build-time switch: VITE_MOCK => placeholder entries; else the honest
 * empty live container. The unused branch is tree-shaken since VITE_MOCK is a
 * compile-time constant (same pattern as Positions/Watchlist/Performance). */
export default function Journal() {
  return import.meta.env.VITE_MOCK ? <MockJournal /> : <LiveJournal />;
}
