// Placeholder journal entries (MOCK_JOURNAL) for DESIGN ITERATION only
// (VITE_MOCK builds). Lets us build/run the real .app and tune the Journal
// screen's paper layout without any persistence layer (SQLite journal storage
// is a LATER task — this file never touches src/db). The MOCK_JOURNAL sample
// tree below tree-shakes out of production builds (the Journal screen only
// mounts the mock container when import.meta.env.VITE_MOCK is set); the shared
// vocabulary (JournalTag/JOURNAL_TAGS/JournalEntry) lives in journalTypes.ts
// so the live path never pulls this sample data in.
//
// Every entry below is INVENTED — a plausible personal trading-journal voice,
// never real advice and never presented as real anywhere in the UI. The live
// path shows an honest empty state instead of this data.

import type { JournalEntry } from "../screens/journal/journalTypes";

export const MOCK_JOURNAL: JournalEntry[] = [
  {
    id: "j-2026-06-28",
    dateISO: "2026-06-28",
    title: "Trimmed NVDA after the run-up",
    body: "Sold a third of the position into strength rather than trying to time the exact top. Sleeping better already — the point was never to be a hero, it was to keep the gain honest.",
    tags: ["WIN", "LESSON"],
    ticker: "NVDA",
  },
  {
    id: "j-2026-06-21",
    dateISO: "2026-06-21",
    title: "Chased Meta on a green candle",
    body: "Bought into the spike on FOMO, no plan, no level in mind. Down 4% by close and I have nobody to blame but the part of me that hates missing out.",
    tags: ["MISTAKE"],
    ticker: "META",
  },
  {
    id: "j-2026-06-14",
    dateISO: "2026-06-14",
    title: "Rule: size the position before I click buy",
    body: "Twice this month I've worked out the risk after the fact. From now on the position size and the invalidation level get written here before the order goes in, not after.",
    tags: ["LESSON"],
  },
  {
    id: "j-2026-06-09",
    dateISO: "2026-06-09",
    title: "Watching ASML into earnings",
    body: "Not touching it yet — I want to see whether the order backlog commentary holds up. If it dips on a good print that's my signal, not the headline number.",
    tags: ["WATCHING"],
    ticker: "ASML",
  },
  {
    id: "j-2026-05-30",
    dateISO: "2026-05-30",
    title: "Held through the drawdown and it paid",
    body: "Palantir was down 9% mid-month and I did nothing, because nothing about the thesis had changed. Recovered and then some. The discipline was the trade.",
    tags: ["WIN"],
    ticker: "PLTR",
  },
  {
    id: "j-2026-05-22",
    dateISO: "2026-05-22",
    title: "Averaged down without a reason",
    body: "Added to Intel purely because it was cheaper than my entry, which is not a thesis — it's hope wearing a thesis costume. Flagging it so I catch myself next time.",
    tags: ["MISTAKE", "LESSON"],
    ticker: "INTC",
  },
  {
    id: "j-2026-05-11",
    dateISO: "2026-05-11",
    title: "Cash is a position too",
    body: "Sat on my hands for a whole week and it felt wrong the entire time. Reminding myself that not trading is a decision, and this week it was the right one.",
    tags: ["LESSON"],
  },
  {
    id: "j-2026-04-27",
    dateISO: "2026-04-27",
    title: "Took profit on TSM, maybe too early",
    body: "Closed the whole thing at +12% and it kept running another 6% without me. Slightly annoyed, but a booked gain never went to zero. Filing under win with an asterisk.",
    tags: ["WIN"],
    ticker: "TSM",
  },
  {
    id: "j-2026-04-15",
    dateISO: "2026-04-15",
    title: "Watching the whole semi space cool off",
    body: "The names I follow are all rolling over together, which tells me it's sector-wide rotation rather than anything company-specific. No action — just noting the mood.",
    tags: ["WATCHING"],
  },
  {
    id: "j-2026-04-02",
    dateISO: "2026-04-02",
    title: "Started the journal",
    body: "First entry. The plan is simple: every trade I make, and every one I deliberately don't, gets a line here — win, mistake, or lesson. If I can't explain it to this page, I shouldn't be doing it.",
    tags: ["LESSON"],
  },
];
