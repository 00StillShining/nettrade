import { useMemo, useState, useEffect, type ReactNode } from "react";
import Chrome from "../../shell/Chrome";
import { usePositions, type UsePositionsResult } from "../../state/usePositions";
import type { Position } from "../../adapters/trading212";
import { MOCK_POSITIONS } from "../../data/mockPositions";
import { fmtMinor, fmtQty, fmtPct, Triangle } from "../shared/format";
import { computeCompareShape, type CompareShape } from "./compareAxes";
import { HoldingRadar } from "./HoldingRadar";
import s from "./Compare.module.css";

/**
 * Compare — the SDN "head-to-head" screen (VISUAL_DIRECTION.md §5 "Compare":
 * "two dossier/roster cards side by side, each with its own radar/pentagon…
 * amber marks the winner/selected axis; a lateral wipe swaps candidates").
 * Function-first (actuality-ui skill §1-2): answers ONE question — "which of
 * these two holdings is doing better, and by what?" — via a hero verdict line
 * + two cream dossier cards, each with an honest per-holding pentagon whose
 * axes are normalised PAIRWISE so the two silhouettes read against each other.
 *
 * Same shell/data-wiring pattern as Positions: Chrome owns the dark frame +
 * telemetry/status bars; this screen owns only the cream content, wired to the
 * SAME usePositions hook (live) or MOCK_POSITIONS (VITE_MOCK) — no fetch/parse
 * of its own. Defaults to comparing the two LARGEST holdings by value.
 */

const symbolOf = (p: Position) => p.ticker.split("_")[0];

/** Native <select> picker for one side — obviously interactive, amber focus. */
function HoldingPicker({
  side,
  positions,
  selectedTicker,
  otherTicker,
  onPick,
}: {
  side: "A" | "B";
  positions: Position[];
  selectedTicker: string;
  otherTicker: string;
  onPick: (ticker: string) => void;
}) {
  return (
    <label className={s.picker}>
      <span className={s.pickerLabel}>Side {side}</span>
      <select
        className={s.pickerSelect}
        value={selectedTicker}
        onChange={(e) => onPick(e.target.value)}
        aria-label={`Choose holding for side ${side}`}
      >
        {positions.map((p) => (
          <option key={p.ticker} value={p.ticker} disabled={p.ticker === otherTicker}>
            {symbolOf(p)} — {p.name ?? p.ticker}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One dossier stat row: bold display label + right-aligned mono value. */
function StatRow({
  label,
  children,
  tone,
}: {
  label: string;
  children: ReactNode;
  tone?: "gain" | "loss" | "flat";
}) {
  const toneCls = tone === "gain" ? s.gain : tone === "loss" ? s.loss : "";
  return (
    <div className={s.statRow}>
      <span className={s.statLabel}>{label}</span>
      <span className={`${s.statValue} ${toneCls}`}>{children}</span>
    </div>
  );
}

/** Signed £ P/L with sign + drawn ▲/▼ + colour (never colour alone; zero = neutral). */
function SignedMoney({ minor, ccy }: { minor: number; ccy: string | null }) {
  const zero = minor === 0;
  const up = minor > 0;
  if (zero) return <>{fmtMinor(0, ccy)}</>;
  return (
    <>
      <Triangle up={up} className={s.inlineTri} />
      {up ? "+" : "−"}
      {fmtMinor(Math.abs(minor), ccy)}
    </>
  );
}

/** One holding's dossier card — cream recipe + its pentagon + honest stats. */
function DossierCard({
  side,
  position,
  totalValue,
  axes,
  accentVar,
  winners,
  isVerdictWinner,
}: {
  side: "A" | "B";
  position: Position;
  totalValue: number;
  axes: CompareShape["axesA"];
  accentVar: string;
  winners: boolean[];
  isVerdictWinner: boolean;
}) {
  const ccy = position.accountCurrency;
  const instCcy = position.instrumentCurrency;
  const plZero = position.unrealizedPlMinor === 0;
  const plUp = position.unrealizedPlMinor > 0;
  const plTone = plZero ? "flat" : plUp ? "gain" : "loss";
  const plPct = position.totalCostMinor > 0 ? position.unrealizedPlMinor / position.totalCostMinor : null;
  const alloc = totalValue > 0 ? position.currentValueMinor / totalValue : null;
  const priceFlat = position.currentPriceMinor === position.avgPriceMinor;
  const priceUp = position.currentPriceMinor > position.avgPriceMinor;

  return (
    <article
      className={`${s.card} ${isVerdictWinner ? s.cardWinner : ""}`}
      aria-label={`Side ${side}: ${position.name ?? symbolOf(position)}`}
    >
      <div className={s.cardRibbon}>
        <span className={s.cardSide}>{side}</span>
        <span className={s.cardSym}>{symbolOf(position)}</span>
        {isVerdictWinner && <span className={s.leadTag}>LEADS</span>}
      </div>

      <div className={s.cardBody}>
        <div className={s.cardName}>{position.name ?? position.ticker}</div>

        {/* Pentagon — the honest per-holding shape (pairwise-normalised). */}
        <div className={s.radarBox}>
          {axes.length >= 3 ? (
            <HoldingRadar axes={axes} accentVar={accentVar} winners={winners} label={`${symbolOf(position)} shape`} />
          ) : (
            <div className={s.radarThin}>Not enough shared metrics to draw a pentagon for this pair.</div>
          )}
        </div>

        {/* Dossier stats — bold-label / mono-value pairs. */}
        <div className={s.statList}>
          <StatRow label="Market Value">{fmtMinor(position.currentValueMinor, ccy)}</StatRow>
          <StatRow label="Unrealised" tone={plTone}>
            <SignedMoney minor={position.unrealizedPlMinor} ccy={ccy} />
            {plPct !== null && !plZero && (
              <span className={s.subPct}>
                ({plUp ? "+" : "−"}
                {fmtPct(plPct)})
              </span>
            )}
          </StatRow>
          <StatRow label="Allocation">{alloc !== null ? fmtPct(alloc) : "—"}</StatRow>
          <StatRow label="Avg / Current">
            {fmtMinor(position.avgPriceMinor, instCcy)}
            <span className={s.sep}> → </span>
            {/* Direction by sign + drawn ▲/▼ + colour (never colour alone; a
                flat price is neutral — no tint, no triangle). */}
            <span className={priceFlat ? "" : priceUp ? s.gain : s.loss}>
              {!priceFlat && <Triangle up={priceUp} className={s.inlineTri} />}
              {fmtMinor(position.currentPriceMinor, instCcy)}
            </span>
          </StatRow>
          <StatRow label="Quantity">
            {fmtQty(position.quantity)} <span className={s.subUnit}>sh</span>
          </StatRow>
        </div>
      </div>
    </article>
  );
}

function CompareView({ positions, status, error, lastSync, refresh }: UsePositionsResult) {
  // Sorted by value — the picker order + "two largest" default both use it.
  const sorted = useMemo(
    () => [...positions].sort((a, b) => b.currentValueMinor - a.currentValueMinor),
    [positions],
  );

  const totalValue = useMemo(() => positions.reduce((sum, p) => sum + p.currentValueMinor, 0), [positions]);

  // Default: the two LARGEST holdings. Kept by ticker so re-sorts don't reset.
  const [tickerA, setTickerA] = useState<string | null>(null);
  const [tickerB, setTickerB] = useState<string | null>(null);

  useEffect(() => {
    if (sorted.length < 2) {
      setTickerA(sorted[0]?.ticker ?? null);
      setTickerB(null);
      return;
    }
    // Only seed defaults when unset or a pick fell out of the data. Seed both
    // sides in one pass so B is reset ONLY when it collides with A or falls out
    // of the data — never just because it became the largest holding.
    const nextA = tickerA && sorted.some((p) => p.ticker === tickerA) ? tickerA : sorted[0].ticker;
    setTickerA(nextA);
    setTickerB((prev) => {
      if (prev && prev !== nextA && sorted.some((p) => p.ticker === prev)) return prev;
      return (sorted.find((p) => p.ticker !== nextA) ?? sorted[1]).ticker;
    });
  }, [sorted, tickerA]);

  const posA = useMemo(() => positions.find((p) => p.ticker === tickerA) ?? null, [positions, tickerA]);
  const posB = useMemo(() => positions.find((p) => p.ticker === tickerB) ?? null, [positions, tickerB]);

  // Lateral wipe key — bump on ANY pick change so the pair re-mounts and runs
  // the one-shot clip-path wipe (anti-brick: transform/opacity/clip-path only).
  const [wipeKey, setWipeKey] = useState(0);
  const pickA = (t: string) => {
    setTickerA(t);
    setWipeKey((k) => k + 1);
  };
  const pickB = (t: string) => {
    setTickerB(t);
    setWipeKey((k) => k + 1);
  };

  const shape = useMemo(
    () => (posA && posB ? computeCompareShape(posA, posB, totalValue) : null),
    [posA, posB, totalValue],
  );
  // Memoise the per-side winner arrays so HoldingRadar's effect deps are stable
  // across unrelated parent re-renders (e.g. a SYNC status flip) — otherwise a
  // fresh array each render redraws the canvas needlessly, undercutting the
  // "draw once per data change" contract.
  const winnersA = useMemo(() => shape?.axes.map((ax) => ax.winner === "a") ?? [], [shape]);
  const winnersB = useMemo(() => shape?.axes.map((ax) => ax.winner === "b") ?? [], [shape]);

  const connection: "ok" | "loading" | "no-key" | "error" =
    status === "ok"
      ? "ok"
      : status === "loading" || status === "idle"
        ? "loading"
        : status === "no-key"
          ? "no-key"
          : "error";

  const showNoKey = status === "no-key";
  const canCompare = posA && posB && shape;

  // Hero verdict — computed from RAW P/L (the headline "doing better" question):
  // whichever holding's unrealised return % is higher leads; ties are honest.
  const verdict = useMemo(() => {
    if (!posA || !posB) return null;
    const rA = posA.totalCostMinor > 0 ? posA.unrealizedPlMinor / posA.totalCostMinor : null;
    const rB = posB.totalCostMinor > 0 ? posB.unrealizedPlMinor / posB.totalCostMinor : null;
    if (rA === null || rB === null) return null;
    const diff = rA - rB;
    if (Math.abs(diff) < 1e-6) return { side: "tie" as const, diffPct: 0, leader: null as Position | null };
    const leader = diff > 0 ? posA : posB;
    return { side: diff > 0 ? ("A" as const) : ("B" as const), diffPct: Math.abs(diff), leader };
  }, [posA, posB]);

  return (
    <Chrome
      title="COMPARE"
      env={import.meta.env.VITE_MOCK ? "demo" : "live"}
      accountLabel="DEFAULT"
      connection={connection}
      lastSyncISO={lastSync}
      positionsCount={positions.length}
      rateLimitNote="1 req/s"
    >
      <div className={s.screen}>
        {/* ============================== HERO ============================== */}
        <section className={s.hero} aria-label="Head-to-head verdict">
          <div className={s.heroRibbon}>Head to Head</div>
          <div className={s.heroBody}>
            <p className={s.heroLine}>
              {!canCompare ? (
                "Pick two holdings to compare them side by side."
              ) : verdict === null ? (
                <>
                  Return % can’t be compared — one holding has no cost basis, so no honest verdict.
                </>
              ) : verdict.side === "tie" ? (
                <>The two are running dead level on return.</>
              ) : (
                <>
                  <b className={s.heroWinner}>{symbolOf(verdict.leader!)}</b> is doing better —{" "}
                  <b>{fmtPct(verdict.diffPct)}</b> points more unrealised return than{" "}
                  {symbolOf(verdict.side === "A" ? posB! : posA!)}.
                </>
              )}
            </p>
            {canCompare && (
              <div className={s.heroTally} aria-label="Per-axis lead tally">
                <span className={`${s.tally} ${shape!.aWins > shape!.bWins ? s.tallyLead : ""}`}>
                  A {shape!.aWins}
                </span>
                <span className={s.tallySep}>·</span>
                <span className={`${s.tally} ${shape!.bWins > shape!.aWins ? s.tallyLead : ""}`}>
                  {shape!.bWins} B
                </span>
                <span className={s.tallyNote}>axes led</span>
              </div>
            )}
          </div>

          {/* Pickers — swapping either runs the lateral wipe on the pair. */}
          <div className={s.pickerRow}>
            {tickerA && (
              <HoldingPicker
                side="A"
                positions={sorted}
                selectedTicker={tickerA}
                otherTicker={tickerB ?? ""}
                onPick={pickA}
              />
            )}
            {tickerB && (
              <HoldingPicker
                side="B"
                positions={sorted}
                selectedTicker={tickerB}
                otherTicker={tickerA ?? ""}
                onPick={pickB}
              />
            )}
            <button type="button" className={s.syncBtn} onClick={() => void refresh()} disabled={status === "loading"}>
              {status === "loading" ? "SYNCING…" : "SYNC"}
            </button>
          </div>
        </section>

        {status === "error" && error && (
          <div className={s.stateNote}>Live sync failed — showing last known data. ({error})</div>
        )}

        {/* ============================== STATES ============================== */}
        {showNoKey && (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>No Trading 212 key found</div>
            <p>Connect one in Settings to compare your live holdings here.</p>
          </div>
        )}

        {/* While the live path is still settling (idle/loading with nothing
            fetched yet), show a calm SYNCING note — never claim "you hold 0"
            before the snapshot has actually arrived. */}
        {!showNoKey && (status === "loading" || status === "idle") && positions.length === 0 && (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>Syncing…</div>
            <p>Reading your open positions.</p>
          </div>
        )}

        {/* Only claim a holdings count once the snapshot has SETTLED. */}
        {!showNoKey && status === "ok" && positions.length < 2 && (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>Need two holdings to compare</div>
            <p>Compare needs at least two open positions. You currently hold {positions.length}.</p>
          </div>
        )}

        {/* ============================== ARENA ============================== */}
        {!showNoKey && canCompare && (
          <section className={s.arena} aria-label="Holdings comparison">
            {/* key=wipeKey re-mounts the pair → one-shot lateral clip-path wipe. */}
            <div className={s.pair} key={wipeKey}>
              <div className={`${s.slot} ${s.slotA}`}>
                <DossierCard
                  side="A"
                  position={posA!}
                  totalValue={totalValue}
                  axes={shape!.axesA}
                  accentVar="--shape-a"
                  winners={winnersA}
                  isVerdictWinner={verdict?.side === "A"}
                />
              </div>

              <div className={s.divider} aria-hidden="true">
                <span className={s.vs}>VS</span>
              </div>

              <div className={`${s.slot} ${s.slotB}`}>
                <DossierCard
                  side="B"
                  position={posB!}
                  totalValue={totalValue}
                  axes={shape!.axesB}
                  accentVar="--shape-b"
                  winners={winnersB}
                  isVerdictWinner={verdict?.side === "B"}
                />
              </div>
            </div>

            {/* Honest footnote — the normalisation is relative, not a score. */}
            <p className={s.arenaNote}>
              Pentagon axes are normalised across ONLY these two holdings, so a bigger shape means it leads THIS pair on
              those axes — not that it’s “better” outright. Amber vertices mark the per-axis leader. Axes that can’t be
              computed for a holding are dropped, never faked.
            </p>
          </section>
        )}
      </div>
    </Chrome>
  );
}

/** Live container — the real Trading 212 data path (Keychain + native HTTP). */
function LiveCompare() {
  return <CompareView {...usePositions("default", "live")} />;
}

/** Mock container — placeholder data for design iteration (VITE_MOCK builds).
 * Never touches the Keychain/API, so no password prompts while we tune the UI. */
function MockCompare() {
  const [lastSync] = useState(() => new Date(Date.now() - 90_000).toISOString());
  const data: UsePositionsResult = {
    positions: MOCK_POSITIONS,
    status: "ok",
    error: null,
    lastSync,
    refresh: async () => {},
  };
  return <CompareView {...data} />;
}

/** Build-time switch: VITE_MOCK => placeholder data (no Keychain); else live.
 * The unused branch is tree-shaken since VITE_MOCK is a compile-time constant. */
export default function Compare() {
  return import.meta.env.VITE_MOCK ? <MockCompare /> : <LiveCompare />;
}
