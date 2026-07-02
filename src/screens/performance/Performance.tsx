import { useMemo } from "react";
import Chrome from "../../shell/Chrome";
import { useMockPerformance, useLivePerformance, type UsePerformanceResult } from "../../state/usePerformance";
import { fmtMinor, fmtPct, Triangle } from "../shared/format";
import { ValueChart } from "./ValueChart";
import type { Period } from "../../engine/types";
import s from "./Performance.module.css";

/**
 * Performance — the SDN "dossier" screen (VISUAL_DIRECTION.md §5
 * "Performance"; SCREEN_PATTERNS.md §7 the locked cream recipe). Function
 * first (actuality-ui skill §1): answers ONE question — "am I ACTUALLY up,
 * once you separate what I DEPOSITED from what I EARNED?" The naive
 * "current value minus net deposits" reading is misleading (it ignores
 * dividends taken out, realised gains banked, idle cash); the HONEST answer
 * is computeTruth's component sum. This screen leads with that honest
 * answer, then shows every component it's built from — never hiding the gap
 * between the naive and honest readings.
 *
 * Wired to the Performance-Truth ENGINE (src/engine/**, untouched, 36 tests
 * passing) via usePerformance — this screen owns no truth/series maths of
 * its own, only formatting + layout.
 */

const PERIODS: Period[] = ["1M", "3M", "6M", "YTD", "1Y", "ALL"];

function PeriodSelector({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className={s.periodRow} role="group" aria-label="Chart period">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          className={`${s.periodBtn} ${p === period ? s.periodBtnActive : ""}`}
          aria-pressed={p === period}
          onClick={() => onChange(p)}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

/** One bold-label/mono-value dossier row. `confirm` renders an em-dash +
 * "metric to confirm" note instead of a fabricated number (honest-data
 * rule — CHART_CRAFT §9 / actuality-ui skill "honest data is a usability
 * rule"). `tone` colours the MAIN value (sign + drawn ▲/▼ + colour, never
 * colour alone) — used when `value` itself is the signed £/% figure
 * (Realised, Unrealised, True Gain, Return %). `subTone` instead colours the
 * `sub` line — used for Best/Worst Holding, where `value` is just the
 * ticker label and `sub` carries the actual signed P/L figure; the colour
 * must mark the NUMBER that has a direction, never an identifier. */
function DossierRow({
  label,
  value,
  sub,
  tone,
  subTone,
  confirm,
}: {
  label: string;
  value: string | null;
  sub?: string;
  tone?: "gain" | "loss" | "neutral";
  subTone?: "gain" | "loss" | "neutral";
  confirm?: boolean;
}) {
  const showConfirm = confirm || value === null;
  return (
    <div className={s.row}>
      <span className={s.rowLabel}>{label}</span>
      <span className={s.rowValueCol}>
        {showConfirm ? (
          <span className={s.confirmTag}>
            <span className={s.emdash}>&mdash;</span> metric to confirm
          </span>
        ) : (
          <span
            className={`${s.rowValue} ${tone === "gain" ? s.gain : tone === "loss" ? s.loss : ""}`}
          >
            {(tone === "gain" || tone === "loss") && <Triangle up={tone === "gain"} className={s.rowTri} />}
            {value}
          </span>
        )}
        {sub && (
          <span className={`${s.rowSub} ${subTone === "gain" ? s.gain : subTone === "loss" ? s.loss : ""}`}>
            {(subTone === "gain" || subTone === "loss") && <Triangle up={subTone === "gain"} className={s.rowTri} />}
            {sub}
          </span>
        )}
      </span>
    </div>
  );
}

function PerformanceView({ truth, series, status, error, lastSync, period, setPeriod, refresh, historyPending }: UsePerformanceResult) {
  const currency = truth?.currency ?? "GBP";

  const trueGainMinor = truth?.totalGainMinor ?? null;
  const trueGainZero = trueGainMinor === 0;
  const trueGainUp = trueGainMinor !== null && trueGainMinor >= 0;

  const chartStats = useMemo(
    () => ({
      currentValueMinor: truth?.currentValueMinor ?? null,
      netContributionsMinor: truth?.netContributionsMinor ?? null,
      trueGainMinor: truth?.totalGainMinor ?? null,
      trueGainPct: truth?.totalReturnPct ?? null,
      periodHighMinor: series.value.length > 0 ? Math.max(...series.value.map((p) => p.valueMinor)) : null,
      periodLowMinor: series.value.length > 0 ? Math.min(...series.value.map((p) => p.valueMinor)) : null,
    }),
    [truth, series.value],
  );

  const chartState: "loading" | "error" | "empty" | "ready" =
    status === "loading" || status === "idle"
      ? "loading"
      : status === "error"
        ? "error"
        : historyPending
          ? "empty"
          : series.value.length === 0
            ? "empty"
            : "ready";

  // ---- Honest reconciliation note: only shown where the naive
  // (currentValue - netContributions) reading meaningfully diverges from the
  // honest component-sum true gain — this is the gap the whole screen exists
  // to explain, per computeTruth's reconciliation-caveat doc comment.
  const reconciliation = useMemo(() => {
    if (!truth) return null;
    const naiveGap = truth.currentValueMinor - truth.netContributionsMinor;
    const drift = Math.abs(naiveGap - truth.totalGainMinor);
    // Only worth a callout when the drift is non-trivial (>= £1) — a
    // perfectly reconciled account has nothing to explain.
    if (drift < 100) return null;
    return { naiveGap, drift };
  }, [truth]);

  const connection: "ok" | "loading" | "no-key" | "error" =
    status === "ok" || status === "history-pending"
      ? "ok"
      : status === "loading" || status === "idle"
        ? "loading"
        : status === "no-key"
          ? "no-key"
          : "error";

  const showNoKey = status === "no-key";
  const showSkeleton = (status === "loading" || status === "idle") && !truth;

  return (
    <Chrome
      title="PERFORMANCE"
      env="live"
      accountLabel="DEFAULT"
      connection={connection}
      lastSyncISO={lastSync}
      positionsCount={null}
      rateLimitNote="1 req/s"
    >
      <div className={s.screen}>
        {/* ============================== HERO — the honest answer ============================== */}
        <section className={s.hero} aria-label="True gain — the honest performance answer">
          <div className={s.heroRibbon}>Performance</div>

          {showSkeleton ? (
            <>
              <div className={s.skeletonBar} style={{ width: "60%", height: 40 }} />
              <div className={s.skeletonBar} style={{ width: "40%", height: 18, marginTop: 10 }} />
            </>
          ) : (
            <>
              <div className={s.heroTop}>
                <div className={s.heroMain}>
                  <div className={s.heroLabel}>True Gain</div>
                  <div className={trueGainZero ? s.heroValue : `${s.heroValue} ${trueGainUp ? s.gain : s.loss}`}>
                    {trueGainMinor !== null && !trueGainZero && (
                      <Triangle up={trueGainUp} className={s.heroTri} />
                    )}
                    {trueGainMinor !== null ? (
                      <>
                        {!trueGainZero && (trueGainUp ? "+" : "−")}
                        {fmtMinor(Math.abs(trueGainMinor), currency)}
                      </>
                    ) : (
                      <span className={s.confirmTag}>
                        <span className={s.emdash}>&mdash;</span> metric to confirm
                      </span>
                    )}
                  </div>
                </div>
                <div className={s.heroMain}>
                  <div className={s.heroLabel}>Return</div>
                  <div
                    className={
                      truth?.totalReturnPct == null
                        ? s.heroValueSm
                        : `${s.heroValueSm} ${truth.totalReturnPct >= 0 ? s.gain : s.loss}`
                    }
                  >
                    {truth?.totalReturnPct != null ? (
                      <>
                        {truth.totalReturnPct !== 0 && (
                          <Triangle up={truth.totalReturnPct >= 0} className={s.heroTriSm} />
                        )}
                        {truth.totalReturnPct !== 0 && (truth.totalReturnPct >= 0 ? "+" : "−")}
                        {fmtPct(truth.totalReturnPct)}
                      </>
                    ) : (
                      <span className={s.confirmTag}>
                        <span className={s.emdash}>&mdash;</span> metric to confirm
                      </span>
                    )}
                  </div>
                  <div className={s.heroSubLabel}>of net contributions</div>
                </div>
              </div>

              <p className={s.heroNote}>
                What you&rsquo;ve actually earned — realised + unrealised + dividends − fees + interest — versus
                the {truth ? fmtMinor(truth.netContributionsMinor, currency) : "—"} you put in.
              </p>
            </>
          )}
        </section>

        {/* ============================== STATE NOTES ============================== */}
        {showNoKey && (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>No Trading 212 key found</div>
            <p>Connect one in Settings to see your live performance here.</p>
          </div>
        )}

        {status === "error" && error && (
          <div className={s.stateNote}>Live sync failed — showing last known data. ({error})</div>
        )}

        {historyPending && !showNoKey && status !== "loading" && status !== "idle" && (
          <div className={s.pendingNote}>
            <strong>Connect and sync to build your performance history.</strong> Actuality shows unrealised P/L and
            current value from your live positions now; deposits, realised P/L, dividends, fees, interest and your
            equity curve arrive once history sync and per-sync snapshots are wired (a later task) — never fabricated
            in the meantime.
          </div>
        )}

        {/* ============================== MAIN DOSSIER ROW ============================== */}
        {!showNoKey && (
          <div className={s.mainRow}>
            {/* ---- LEFT: the equity curve "splash" panel ---- */}
            <section className={s.chartPanel} aria-label="Equity curve">
              <div className={s.chartHead}>
                <span className={s.chartTitle}>Equity Curve</span>
                <div className={s.legend}>
                  <span className={s.legendItem}>
                    <span className={s.legendSwatchLime} /> Your value
                  </span>
                  <span className={s.legendItem}>
                    <span className={s.legendSwatchPurple} /> Merely deposited
                  </span>
                </div>
              </div>
              <div className={s.chartBody}>
                <ValueChart
                  value={series.value}
                  netDeposits={series.netDeposits}
                  stats={chartStats}
                  state={chartState}
                  onRetry={() => void refresh()}
                  accent="lime"
                  currency={currency}
                />
              </div>
              <div className={s.chartFoot}>
                <PeriodSelector period={period} onChange={setPeriod} />
              </div>
            </section>

            {/* ---- RIGHT: the dossier key/value rail ---- */}
            <aside className={s.rail} aria-label="Performance dossier">
              <div className={s.railPanel}>
                <div className={s.railHead}>Contributions</div>
                <DossierRow
                  label="Deposited"
                  value={truth ? fmtMinor(truth.netContributionsMinor, currency) : null}
                  sub={
                    truth
                      ? `${fmtMinor(truth.depositsMinor, currency)} in · ${fmtMinor(truth.withdrawalsMinor, currency)} out`
                      : undefined
                  }
                />
              </div>

              <div className={s.railPanel}>
                <div className={s.railHead}>Truth Components</div>
                <DossierRow
                  label="Realised"
                  value={truth ? fmtMinor(truth.realisedPlMinor, currency) : null}
                  tone={truth ? (truth.realisedPlMinor >= 0 ? "gain" : "loss") : undefined}
                />
                <DossierRow
                  label="Unrealised"
                  value={truth ? fmtMinor(truth.unrealisedPlMinor, currency) : null}
                  tone={truth ? (truth.unrealisedPlMinor >= 0 ? "gain" : "loss") : undefined}
                />
                <DossierRow label="Dividends" value={truth ? fmtMinor(truth.dividendsMinor, currency) : null} />
                <DossierRow label="Fees" value={truth ? fmtMinor(truth.feesMinor, currency) : null} />
                <DossierRow label="Interest" value={truth ? fmtMinor(truth.interestMinor, currency) : null} />
                <DossierRow
                  label="Current Value"
                  value={truth ? fmtMinor(truth.currentValueMinor, currency) : null}
                />
              </div>

              <div className={`${s.railPanel} ${s.railHero}`}>
                <div className={s.railHead}>The Honest Answer</div>
                <DossierRow
                  label="True Gain"
                  value={trueGainMinor !== null ? fmtMinor(Math.abs(trueGainMinor), currency) : null}
                  tone={trueGainMinor !== null ? (trueGainZero ? "neutral" : trueGainUp ? "gain" : "loss") : undefined}
                />
                <DossierRow
                  label="Return %"
                  value={truth?.totalReturnPct != null ? fmtPct(truth.totalReturnPct) : null}
                  tone={
                    truth?.totalReturnPct != null
                      ? truth.totalReturnPct === 0
                        ? "neutral"
                        : truth.totalReturnPct >= 0
                          ? "gain"
                          : "loss"
                      : undefined
                  }
                  confirm={truth?.totalReturnPct == null}
                />
                <DossierRow
                  label="Best Holding"
                  value={truth?.best ? `${truth.best.ticker.split("_")[0]}` : null}
                  sub={truth?.best ? fmtMinor(truth.best.unrealizedPlMinor, currency) : undefined}
                  subTone={truth?.best ? (truth.best.unrealizedPlMinor >= 0 ? "gain" : "loss") : undefined}
                  confirm={!truth?.best}
                />
                <DossierRow
                  label="Worst Holding"
                  value={truth?.worst ? `${truth.worst.ticker.split("_")[0]}` : null}
                  sub={truth?.worst ? fmtMinor(truth.worst.unrealizedPlMinor, currency) : undefined}
                  subTone={truth?.worst ? (truth.worst.unrealizedPlMinor >= 0 ? "gain" : "loss") : undefined}
                  confirm={!truth?.worst}
                />
              </div>

              {reconciliation && truth && (
                <div className={s.reconPanel}>
                  <div className={s.reconTitle}>Reconciliation</div>
                  <p className={s.reconNote}>
                    Your holdings are worth {fmtMinor(truth.currentValueMinor, currency)}; you&rsquo;ve put in{" "}
                    {fmtMinor(truth.netContributionsMinor, currency)} net. The{" "}
                    {fmtMinor(Math.abs(reconciliation.naiveGap), currency)}{" "}
                    {reconciliation.naiveGap >= 0 ? "surplus" : "shortfall"} plus what you took out as
                    dividends/withdrawals is reconciled by your true gain above — not a raw balance check, but the
                    honest sum of realised, unrealised, dividends, fees and interest.
                  </p>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </Chrome>
  );
}

/** Live container — the real Trading 212 data path, honest partial state
 * until history endpoints + snapshot persistence are wired (see
 * usePerformance.ts's doc comment). */
function LivePerformance() {
  return <PerformanceView {...useLivePerformance()} />;
}

/** Mock container — placeholder Performance-Truth data for design iteration
 * (VITE_MOCK builds). Never touches the Keychain/API. */
function MockPerformance() {
  return <PerformanceView {...useMockPerformance()} />;
}

/** Build-time switch: VITE_MOCK => placeholder data (no Keychain); else live.
 * The unused branch is tree-shaken since VITE_MOCK is a compile-time constant. */
export default function Performance() {
  return import.meta.env.VITE_MOCK ? <MockPerformance /> : <LivePerformance />;
}
