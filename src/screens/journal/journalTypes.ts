// journalTypes — the Journal screen's real vocabulary (tags + entry shape).
// These types are used on the LIVE path, so they live here (in the screen dir)
// rather than in the mock-data file — keeping mockJournal.ts (and its
// MOCK_JOURNAL sample tree) fully tree-shakeable out of production builds.

/** The small, fixed tag vocabulary — kept deliberately tiny so the chip row
 * stays a legible "one icon voice" (VISUAL_DIRECTION §5: ink-outline text
 * pills on cream, calmest screen). WIN/MISTAKE are the emphatic pair; LESSON
 * and WATCHING are the reflective ones. */
export type JournalTag = "WIN" | "MISTAKE" | "LESSON" | "WATCHING";

export const JOURNAL_TAGS: JournalTag[] = ["WIN", "MISTAKE", "LESSON", "WATCHING"];

export interface JournalEntry {
  id: string;
  /** ISO date (no time needed — the caption ribbon shows the day). */
  dateISO: string;
  title: string;
  /** Natural personal voice, 1–3 sentences. */
  body: string;
  tags: JournalTag[];
  /** Optional instrument this entry is about (ticker symbol, not the full
   * Trading 212 "_US_EQ" form — a journal is written in human shorthand). */
  ticker?: string;
}
