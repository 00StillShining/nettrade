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
 * once you separate what I DEPOSITED from what I EARNED?" — now PERIOD-AWARE:
 * the same question, answered honestly for whichever window (YTD/1M/3M/6M/1Y/
 * ALL) the user has selected, so it can be compared against the broker's own
 * period figure (e.g. Trading 212's "+£59.90 YTD") instead of only ever
 * showing an all-time number that reads as a mismatch.
 *
 * Wired to the Performance-Truth ENGINE (src/engine/**, untouched maths,
 * now period.ts too — see PeriodTruth's doc comment in engine/types.ts for
 * the two-lens model) via usePerformance — this screen owns no truth/series
 * maths of its own, only formatting + layout.
 */

const PERIODS: Period[] = ["1M", "3M", "6M", "YTD", "1Y", "ALL"];

/** DD MMM from an ISO date string, for the snapshot-anchor sub-line. */
function fmtDayMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(d);
}

function PeriodSelector({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className={s.periodRow} role="group" aria-label="Performance window">
      <span className={s.periodLabel}>Window</span>
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

function PerformanceView({
  truth,
  periodTruth,
  series,
  status,
  error,
  lastSync,
  period,
  setPeriod,
  refresh,
  historyPending,
}: UsePerformanceResult) {
  const currency = truth?.currency ?? "GBP";
  const isAllTime = period === "ALL";

  const trueGainMinor = truth?.totalGainMinor ?? null;
  const trueGainZero = trueGainMinor === 0;
  const trueGainUp = trueGainMinor !== null && trueGainMinor >= 0;

  // ---- The period-aware hero figure. See PeriodTruth's doc comment
  // (engine/types.ts) for the two-lens model this reads from.
  //
  // period === "ALL": unchanged — the existing all-time True Gain (the
  // component-sum totalGainMinor) is already a COMPLETE figure (it includes
  // unrealisedPl, which is inherently a "now" mark, no anchor needed).
  //
  // period !== "ALL": the component lens ALONE is never a complete gain —
  // it has no unrealised (mark-to-market) term, so presenting it as "the"
  // gain would silently hide the biggest swing factor for anyone still
  // holding positions. The snapshot lens (holdings growth since the last
  // recorded snapshot at/before the window start) IS a complete figure when
  // an anchor exists — so that is what the hero shows for a period; when no
  // anchor exists yet, the hero honestly shows "metric to confirm" with the
  // engine's own explanatory note, never a partial substitute.
  const periodAnchor = periodTruth?.snapshotGain.anchor ?? null;
  const periodGainMinor = periodTruth?.snapshotGain.gainMinor ?? null;
  const periodGainZero = periodGainMinor === 0;
  const periodGainUp = periodGainMinor !== null && periodGainMinor >= 0;

  // Return % for a period: the engine's snapshot-lens returnPct (gain over
  // "anchor value + everything added since the anchor" — computed in
  // period.ts with decimal.js, guarded to null when the base is <= 0 or no
  // anchor exists; see snapshotGain's doc comment in engine/types.ts). This
  // screen only READS it — the denominator choice is a truth-policy decision
  // that lives in the engine, never re-derived here with float maths.
  const periodReturnPct = periodTruth?.snapshotGain.returnPct ?? null;

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
          <div className={s.heroRibbon}>
            <span>Performance</span>
            {/* Scope the headline explicitly and DYNAMICALLY: the period
                keycaps now scope BOTH the chart AND this headline figure
                together, so the pill names the exact window the number is
                for ("All-time" for ALL, else "YTD"/"1M"/…). This is the
                fix for the real confusion — an all-time headline read as a
                mismatch against the broker's YTD figure. */}
            <span className={s.heroScope}>{isAllTime ? "All-time" : period}</span>
          </div>

          {showSkeleton ? (
            <>
              <div className={s.skeletonBar} style={{ width: "60%", height: 40 }} />
              <div className={s.skeletonBar} style={{ width: "40%", height: 18, marginTop: 10 }} />
            </>
          ) : (
            <>
              <div className={s.heroTop}>
                {isAllTime ? (
                  <>
                    {/* ---- ALL: the all-time True Gain (component-sum) — a
                        COMPLETE figure (includes unrealised, a "now" mark).
                        Unchanged from before. ---- */}
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
                          truth?.totalReturnPct == null || truth.totalReturnPct === 0
                            ? s.heroValueSm
                            : `${s.heroValueSm} ${truth.totalReturnPct > 0 ? s.gain : s.loss}`
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
                  </>
                ) : (
                  <>
                    {/* ---- PERIOD: the SNAPSHOT lens (holdings growth since
                        the last recorded snapshot at/before the window start).
                        This is the only COMPLETE gain figure for a window
                        (it captures unrealised swings, which the component
                        lens cannot); the component lens lives in the rail's
                        THIS PERIOD panel, never summed with this figure. When
                        no anchor snapshot exists yet, the em-dash "metric to
                        confirm" pattern carries the engine's honest note
                        rather than a fabricated or partial number. ---- */}
                    <div className={s.heroMain}>
                      <div className={s.heroLabel}>Holdings growth · {period}</div>
                      <div
                        className={
                          periodGainMinor === null || periodGainZero
                            ? s.heroValue
                            : `${s.heroValue} ${periodGainUp ? s.gain : s.loss}`
                        }
                      >
                        {periodGainMinor !== null ? (
                          <>
                            {!periodGainZero && <Triangle up={periodGainUp} className={s.heroTri} />}
                            {!periodGainZero && (periodGainUp ? "+" : "−")}
                            {fmtMinor(Math.abs(periodGainMinor), currency)}
                          </>
                        ) : (
                          <span className={s.confirmTag}>
                            <span className={s.emdash}>&mdash;</span> metric to confirm
                          </span>
                        )}
                      </div>
                      <div className={s.heroSubLabel}>
                        {periodAnchor
                          ? `value change minus what you added, since the ${fmtDayMonth(periodAnchor.atISO)} snapshot`
                          : "no recorded snapshot at the window start"}
                      </div>
                    </div>
                    <div className={s.heroMain}>
                      <div className={s.heroLabel}>Period Return</div>
                      <div
                        className={
                          periodReturnPct == null || periodReturnPct === 0
                            ? s.heroValueSm
                            : `${s.heroValueSm} ${periodReturnPct > 0 ? s.gain : s.loss}`
                        }
                      >
                        {periodReturnPct != null ? (
                          <>
                            {periodReturnPct !== 0 && (
                              <Triangle up={periodReturnPct >= 0} className={s.heroTriSm} />
                            )}
                            {periodReturnPct !== 0 && (periodReturnPct >= 0 ? "+" : "−")}
                            {fmtPct(periodReturnPct)}
                          </>
                        ) : (
                          <span className={s.confirmTag}>
                            <span className={s.emdash}>&mdash;</span> metric to confirm
                          </span>
                        )}
                      </div>
                      <div className={s.heroSubLabel}>over start value + added</div>
                    </div>
                  </>
                )}
              </div>

              {isAllTime ? (
                <p className={s.heroNote}>
                  Your <strong>all-time</strong> gain since you opened the account — what you&rsquo;ve actually
                  earned (realised + unrealised + dividends − fees + interest) versus the{" "}
                  {truth ? fmtMinor(truth.netContributionsMinor, currency) : "—"} you put in. The buttons below
                  scope both this figure and the chart.
                </p>
              ) : (
                <p className={s.heroNote}>
                  Your <strong>{period}</strong> holdings growth — how much your positions&rsquo; value changed
                  since the snapshot shown under the figure, with what you&rsquo;ve paid in since that snapshot
                  taken out, so fresh deposits can&rsquo;t masquerade as gains. This is a value-change reading; the exactly-banked pieces (realised,
                  dividends, fees, interest) for the same window are itemised separately in the dossier and are
                  never added on top. The buttons below scope both this figure and the chart.
                </p>
              )}
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
                {/* Scope-tag the all-time rail panels whenever a window is
                    active — they sit directly below a "This Period" panel
                    with same-named rows, the exact all-time-vs-window
                    misreading this build exists to prevent. */}
                <div className={s.railHead}>Contributions{!isAllTime ? " · All-time" : ""}</div>
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

              {/* ---- THIS PERIOD: the exactly-computable windowed component
                  lens (period !== ALL). Kept VISUALLY DISTINCT from the
                  all-time "Truth Components" panel below and NEVER summed
                  into a single gain — these are the named, banked pieces that
                  fell inside the window (realised, dividends, fees, interest,
                  in-window deposits), a different reading from the hero's
                  holdings-growth (snapshot) lens. No unrealised term here by
                  construction (see PeriodComponents' doc comment). ---- */}
              {!isAllTime && periodTruth && (
                <div className={`${s.railPanel} ${s.railPeriod}`}>
                  <div className={s.railHead}>This Period · {period}</div>
                  <DossierRow
                    label="Realised"
                    value={fmtMinor(periodTruth.components.realisedInWindowMinor, currency)}
                    tone={
                      periodTruth.components.realisedInWindowMinor === 0
                        ? "neutral"
                        : periodTruth.components.realisedInWindowMinor > 0
                          ? "gain"
                          : "loss"
                    }
                  />
                  <DossierRow
                    label="Dividends"
                    value={fmtMinor(periodTruth.components.dividendsMinor, currency)}
                  />
                  <DossierRow label="Fees" value={fmtMinor(periodTruth.components.feesMinor, currency)} />
                  <DossierRow
                    label="Interest"
                    value={fmtMinor(periodTruth.components.interestMinor, currency)}
                  />
                  <DossierRow
                    label="Deposited in-window"
                    value={fmtMinor(periodTruth.components.netContributionsMinor, currency)}
                    sub={
                      `${fmtMinor(periodTruth.components.depositsMinor, currency)} in · ` +
                      `${fmtMinor(periodTruth.components.withdrawalsMinor, currency)} out`
                    }
                  />
                  <p className={s.railPeriodNote}>
                    Banked pieces inside the window — separate from Holdings growth above, never added to it.
                  </p>
                </div>
              )}

              <div className={s.railPanel}>
                <div className={s.railHead}>Truth Components{!isAllTime ? " · All-time" : ""}</div>
                <DossierRow
                  label="Realised"
                  value={truth ? fmtMinor(truth.realisedPlMinor, currency) : null}
                  tone={
                    truth
                      ? truth.realisedPlMinor === 0
                        ? "neutral"
                        : truth.realisedPlMinor > 0
                          ? "gain"
                          : "loss"
                      : undefined
                  }
                />
                <DossierRow
                  label="Unrealised"
                  value={truth ? fmtMinor(truth.unrealisedPlMinor, currency) : null}
                  tone={
                    truth
                      ? truth.unrealisedPlMinor === 0
                        ? "neutral"
                        : truth.unrealisedPlMinor > 0
                          ? "gain"
                          : "loss"
                      : undefined
                  }
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
                <div className={s.railHead}>The Honest Answer{!isAllTime ? " · All-time" : ""}</div>
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
                  subTone={
                    truth?.best
                      ? truth.best.unrealizedPlMinor === 0
                        ? "neutral"
                        : truth.best.unrealizedPlMinor > 0
                          ? "gain"
                          : "loss"
                      : undefined
                  }
                  confirm={!truth?.best}
                />
                <DossierRow
                  label="Worst Holding"
                  value={truth?.worst ? `${truth.worst.ticker.split("_")[0]}` : null}
                  sub={truth?.worst ? fmtMinor(truth.worst.unrealizedPlMinor, currency) : undefined}
                  subTone={
                    truth?.worst
                      ? truth.worst.unrealizedPlMinor === 0
                        ? "neutral"
                        : truth.worst.unrealizedPlMinor > 0
                          ? "gain"
                          : "loss"
                      : undefined
                  }
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
                    {reconciliation.naiveGap >= 0 ? "surplus" : "shortfall"} is a raw balance check that ignores
                    cash not currently invested — dividends, interest and sale proceeds sitting in the account never
                    show up in holdings value. The honest answer is the component sum above: realised, unrealised,
                    dividends, fees and interest, each named and auditable.
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
