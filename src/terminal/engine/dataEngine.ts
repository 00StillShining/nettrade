/* =========================================================================
   TERMINAL 77 — DATA ENGINE (ported verbatim from prototypes/terminal-77)

   The instrument universe (8 tickers with GBM "personalities" + tired-desk-
   analyst bios), the seeded history generator, the 1–2s mock tick walk, the
   Coinbase LiveProvider handshake, and the synthetic index definitions.

   PURE TS, NO DOM. The prototype's tickLoop() lived in the page script and
   called renderers directly; here the loop is a start()/stop() API owned by
   the shell, and screens re-render through subscribe() — canvases stay
   mounted, only the numbers move.

   HONEST DATA: everything below is MODEL-derived and labelled as such in the
   UI. The ONLY browser-side live fetch in the entire terminal is the Coinbase
   spot endpoint in tryLive() (public, keyless, permissive CORS). Every other
   provider (T212 / FMP / Yahoo / RSS) stays behind a
   "// [LIVE SEAM: Tauri-Rust only]" marker in its own module — no fetch, no
   keys in client JS.

   PARITY: seed 77, mulberry32, identical GBM math. The parity tests pin the
   first closes of the seeded histories to numbers extracted from the
   prototype running under node — if this file drifts, they scream.
   ========================================================================= */

import { mulberry32, seedFromString } from "./prng";

/* ---------------- shared numeric + format utilities ----------------
   These lived at the top of the prototype's script and are consumed by every
   engine sibling (scan/compare/news) and every screen. Exported from here so
   the module layout stays exactly the brief's file list (no stray util.ts). */
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// sign OUTSIDE the $ (never "$-1,234")
export const fmtUSD = (n: number, dp = 2): string =>
  (n < 0 ? "-" : "") + "$" + Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** Currency-aware money format (the live account may be GBP/EUR/…). Falls back to
 *  the ISO code as a prefix for currencies without a common symbol. */
const CCY_SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", GBX: "p" };
export const fmtMoney = (n: number, ccy = "USD", dp = 2): string => {
  const sym = CCY_SYMBOL[ccy.toUpperCase()];
  const body = Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (n < 0 ? "-" : "") + (sym ? sym + body : `${ccy.toUpperCase()} ${body}`);
};
export const fmtNum = (n: number, dp = 2): string =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtPct = (n: number): string => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
export const fmtCompact = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
};
export const arrow = (n: number): string => (n >= 0 ? "▲" : "▼");
export const glClass = (n: number): "gain" | "loss" => (n >= 0 ? "gain" : "loss");

/* ---------------- 2. INSTRUMENT UNIVERSE ----------------
   Each instrument has a personality (base price, drift, vol) that shapes its
   GBM history, plus static "case file" fields and a tired-desk-analyst bio. */
export type Range = "1D" | "1W" | "1M" | "1Y";
export const RANGES: Range[] = ["1D", "1W", "1M", "1Y"];

export interface InstrumentProfile {
  name: string;
  base: number;
  drift: number;
  vol: number;
  sector: string;
  exch: string;
  style: string;
  tags: string[];
  mcap: number;
  pe: number; // NaN for crypto — every consumer must isFinite-guard (they do)
  div: number; // yield %, 0 = pays nothing
  beta: number;
  avgvol: number;
  live: boolean; // true = Coinbase-live-capable (crypto slots only)
  bio: string;
  priors: string;
  _liveHeld?: boolean; // live provider owns this symbol's last; mock walk skips it
}

export const UNIVERSE: Record<string, InstrumentProfile> = {
  "NVDA": { name: "NVIDIA Corp", base: 126.4, drift: 0.00040, vol: 0.030, sector: "SEMICONDUCTOR", exch: "NASDAQ",
    style: "MOMENTUM", tags: ["MEGA CAP", "AI", "CROWDED TRADE"], mcap: 3.11e12, pe: 64.2, div: 0.02, beta: 1.68, avgvol: 2.9e8, live: false,
    bio: "Sells shovels in a gold rush it also started. Priced for perfection since 2023, and perfection keeps showing up to work anyway. Has never heard of gravity.",
    priors: "Every dip is a 'buying opportunity' until the one that isn't. Owns the whole datacenter — chips, network, the coffee machine, probably." },
  "AAPL": { name: "Apple Inc", base: 214.3, drift: 0.00012, vol: 0.014, sector: "CONSUMER TECH", exch: "NASDAQ",
    style: "QUALITY", tags: ["MEGA CAP", "DIVIDEND", "SAFE HAVEN"], mcap: 3.28e12, pe: 33.7, div: 0.44, beta: 1.21, avgvol: 5.4e7, live: false,
    bio: "The stock your uncle owns and won't shut up about. Grows revenue by charging existing customers more for a slightly better rectangle. Boring is a feature here.",
    priors: "Buybacks doing the heavy lifting. Services margin is the real story nobody puts on a T-shirt." },
  "TSLA": { name: "Tesla Inc", base: 248.9, drift: 0.00020, vol: 0.041, sector: "AUTO / ENERGY", exch: "NASDAQ",
    style: "NARRATIVE", tags: ["HIGH BETA", "MEME-ADJACENT", "CULT"], mcap: 7.9e11, pe: 71.4, div: 0, beta: 2.05, avgvol: 9.8e7, live: false,
    bio: "A car company valued as a religion, a robotaxi company with no robotaxis, and an energy company nobody bought it for. Trades on tweets, not earnings.",
    priors: "3 SEC inquiries. 1 settled. Do not read the CEO's feed before market open. Do not read it after, either." },
  "SPY": { name: "S&P 500 ETF", base: 558.2, drift: 0.00015, vol: 0.009, sector: "BROAD INDEX", exch: "NYSE ARCA",
    style: "CORE", tags: ["INDEX", "LOW BETA", "THE MARKET"], mcap: 5.4e11, pe: 26.1, div: 1.29, beta: 1.00, avgvol: 6.1e7, live: false,
    bio: "America, in a wrapper. The default answer to every 'what should I buy' that ends the conversation before it gets interesting. It only goes up, until the decade it doesn't.",
    priors: "If you can't beat this, and you can't, just buy this. The most honest ticker on the desk." },
  "BTC-USD": { name: "Bitcoin", base: 97250, drift: 0.00060, vol: 0.038, sector: "DIGITAL ASSET", exch: "COINBASE",
    style: "MACRO HEDGE", tags: ["CRYPTO", "24/7", "VOLATILE"], mcap: 1.92e12, pe: NaN, div: 0, beta: 2.4, avgvol: 2.4e10, live: true,
    bio: "Digital gold for people who find gold too tactile. Down 60% and up 300% are both Tuesdays. Doesn't sleep, doesn't close, doesn't care about your stop-loss.",
    priors: "'Have fun staying poor' — a technical indicator. Halving cycle theology optional but widely practiced." },
  "ETH-USD": { name: "Ethereum", base: 3420, drift: 0.00050, vol: 0.043, sector: "DIGITAL ASSET", exch: "COINBASE",
    style: "MACRO HEDGE", tags: ["CRYPTO", "SMART CONTRACT", "GAS FEES"], mcap: 4.1e11, pe: NaN, div: 0, beta: 2.6, avgvol: 1.3e10, live: true,
    bio: "Bitcoin's ambitious younger sibling that actually does things — mostly hosting jpegs of monkeys and losing your money in novel, gas-fee-optimized ways.",
    priors: "'Ultrasound money' if the memes are right. Every upgrade is 'the one' until the next one." },
  "AMD": { name: "Adv. Micro Devices", base: 162.7, drift: 0.00028, vol: 0.033, sector: "SEMICONDUCTOR", exch: "NASDAQ",
    style: "MOMENTUM", tags: ["LARGE CAP", "AI", "#2 BY CHOICE"], mcap: 2.6e11, pe: 47.8, div: 0, beta: 1.74, avgvol: 5.2e7, live: false,
    bio: "Perpetually 18 months from taking NVIDIA's lunch, a position it has held with great conviction for eight years. Lisa Su could sell you a fridge and you'd thank her.",
    priors: "The value semiconductor, if 'value' means 47x earnings. Datacenter numbers are the whole thesis." },
  "GME": { name: "GameStop Corp", base: 24.8, drift: -0.00010, vol: 0.055, sector: "SPECIALTY RETAIL", exch: "NYSE",
    style: "CHAOS", tags: ["MEME STOCK", "SHORT SQUEEZE", "APES"], mcap: 1.1e10, pe: NaN, div: 0, beta: 1.9, avgvol: 4.1e7, live: false,
    bio: "A mall video-game store worth eleven billion dollars because the internet decided so in 2021 and never fully changed its mind. Fundamentals are a suggestion here.",
    priors: "DD, diamond hands, and a cat emoji move this more than any earnings call. Cash pile is real; the store is a rounding error." },
};
export const DEFAULT_ROSTER = ["NVDA", "AAPL", "TSLA", "SPY", "BTC-USD", "ETH-USD", "AMD", "GME"];

/* ---------------- 3. DATA ENGINE ---------------- */
export const HIST_POINTS: Record<Range, number> = { "1D": 78, "1W": 120, "1M": 160, "1Y": 240 }; // bars per range
export const DEFAULT_SEED = 77;
// p.vol is a nominal DAILY move. Each range covers a different span, so per-BAR
// volatility must be scaled: intraday bars are tiny fractions of a day; a 1Y bar
// spans ~1.5 trading days. This keeps day-% plausible and the 1Y line readable
// (not the vertical-band chaos of applying full daily vol to every bar).
export const RANGE_VOLSCALE: Record<Range, number> = { "1D": 0.16, "1W": 0.42, "1M": 0.62, "1Y": 1.0 };
export const RANGE_DRIFTSCALE: Record<Range, number> = { "1D": 0.16, "1W": 0.9, "1M": 2.2, "1Y": 7.0 };

// GBM history generator with per-ticker personality, range-aware volatility.
// PARITY-CRITICAL: this exact sequence of rng() draws (one for the start
// factor, then Box–Muller pairs per bar) plus the gentle tail-normalisation
// is what the approved screenshots show. Byte-for-byte port.
export function genHistory(sym: string, points: number, seed: number, range: Range): number[] {
  const p = UNIVERSE[sym];
  const rng = mulberry32(seed);
  const vs = RANGE_VOLSCALE[range] || 1;
  const ds = RANGE_DRIFTSCALE[range] || 1;
  const vol = p.vol * vs;
  const drift = p.drift * ds * 0.5;
  const arr = new Array<number>(points);
  // start below "now" for the longer ranges so it drifts up; near "now" intraday
  const startFactor = range === "1Y" ? 0.62 : range === "1M" ? 0.86 : range === "1W" ? 0.965 : 0.992;
  let price = p.base * startFactor * (0.99 + rng() * 0.02);
  for (let i = 0; i < points; i++) {
    const u1 = rng() || 1e-9, u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const ret = drift + vol * z;
    price = Math.max(price * (1 + ret), p.base * 0.12);
    arr[i] = price;
  }
  // normalise the LAST point toward personality base so "last" is realistic
  const scale = p.base / arr[points - 1];
  // blend the scale in gently so the tail lands on base without flattening the path
  for (let i = 0; i < points; i++) { arr[i] *= lerp(1, scale, Math.pow(i / (points - 1), 0.7)); }
  return arr;
}

export interface Quote {
  sym: string;
  last: number;
  prevClose: number;
  dayPct: number;
  hist: Record<Range, number[]>;
  day: number[];
}

type Listener = () => void;

export const DataEngine = {
  seed: DEFAULT_SEED,
  provider: "MOCK" as "MOCK" | "LIVE", // 'LIVE' segments may coexist; taskbar shows LIVE until a failure
  live: true,                          // overall feed banner state
  quotes: {} as Record<string, Quote>, // sym -> {last, prevClose, dayPct, hist:{range:[...]}, day:[...]}
  latencyMs: 12,

  // --- change-notification plumbing (replaces the prototype's direct render
  // calls from tickLoop). Screens subscribe; the shell owns start()/stop().
  _listeners: new Set<Listener>(),
  _tickTimer: null as ReturnType<typeof setTimeout> | null,
  _liveTimer: null as ReturnType<typeof setInterval> | null,
  _running: false,

  init(): void {
    // seed each instrument deterministically off the base seed + symbol.
    // NOTE the two seeds: `day` uses s DIRECTLY, while hist[r] XORs in the
    // range's first char (all ranges start '1', so hist seeds coincide across
    // ranges — quirky but part of the approved world; hist['1D'] is then
    // overwritten by `day` so chart + roster agree). Verbatim.
    DEFAULT_ROSTER.forEach((sym) => {
      const s = this.seed ^ seedFromString(sym);
      const day = genHistory(sym, HIST_POINTS["1D"], s, "1D");
      const hist = {} as Record<Range, number[]>;
      RANGES.forEach((r) => { hist[r] = genHistory(sym, HIST_POINTS[r], s ^ (r.charCodeAt(0) * 131), r); });
      // make 1D the live day series so chart + roster agree
      hist["1D"] = day;
      const last = day[day.length - 1];
      // prevClose = yesterday's close ≈ the day series' opening print (small span now)
      const prevClose = day[0];
      this.quotes[sym] = { sym, hist, day, last, prevClose, dayPct: (last / prevClose - 1) * 100 };
      // a fresh init() must release any live-hold left by a previous session
      // (module singletons survive HMR / route churn; the mock walk must resume)
      UNIVERSE[sym]._liveHeld = false;
    });
  },

  get(sym: string): Quote { return this.quotes[sym]; },

  // one live-ish tick: random-walk last prices (mock). Small, calm steps.
  tick(): void {
    const rng = Math.random;
    DEFAULT_ROSTER.forEach((sym) => {
      const q = this.quotes[sym]; const p = UNIVERSE[sym];
      if (p._liveHeld) return; // live provider owns this symbol's last; skip mock walk
      // per-tick step ~ a fraction of daily vol so day-% wanders gently
      const step = (rng() - 0.5) * p.vol * 0.10;
      q.last = Math.max(q.last * (1 + step), p.base * 0.2);
      // keep the intraday drift bounded so day-% stays realistic
      q.dayPct = clamp((q.last / q.prevClose - 1) * 100, -9, 9);
      q.last = q.prevClose * (1 + q.dayPct / 100);
      // extend day series (rolling)
      q.day.push(q.last); if (q.day.length > HIST_POINTS["1D"]) q.day.shift();
      q.hist["1D"] = q.day;
    });
  },

  // LiveProvider: try public crypto REST for the crypto slots. 3s timeout, diegetic failover.
  // Coinbase spot is the ONE legal browser-side live fetch (public, keyless,
  // permissive CORS). Everything else lives behind [LIVE SEAM: Tauri-Rust only].
  async tryLive(): Promise<boolean | undefined> {
    const liveSyms = DEFAULT_ROSTER.filter((s) => UNIVERSE[s].live);
    if (!liveSyms.length) { return; }
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 3000);
    try {
      // Coinbase public spot endpoints (no key, permissive CORS). One request per pair.
      const results = await Promise.all(liveSyms.map(async (sym) => {
        const pair = sym; // already the Coinbase pair form, e.g. BTC-USD
        const r = await fetch(`https://api.coinbase.com/v2/prices/${pair}/spot`, { signal: ctrl.signal });
        if (!r.ok) throw new Error("bad status");
        const j = (await r.json()) as { data?: { amount?: string } };
        const price = parseFloat(j.data?.amount ?? "");
        if (!isFinite(price)) throw new Error("bad price");
        return { sym, price };
      }));
      clearTimeout(to);
      // success: fold live prices in, keep mock personality shape (day-% preserved).
      // UNIFORMLY scale the whole series + prevClose so only the price LEVEL moves
      // to the live value — the intraday day-% keeps its plausible mock shape.
      results.forEach(({ sym, price }) => {
        const q = this.quotes[sym]; const p = UNIVERSE[sym];
        const scale = price / q.last;
        q.day = q.day.map((v) => v * scale);
        q.hist["1D"] = q.day;
        q.prevClose *= scale;
        q.last = price;
        (["1W", "1M", "1Y"] as Range[]).forEach((r) => { q.hist[r] = q.hist[r].map((v) => v * scale); });
        q.dayPct = clamp((q.last / q.prevClose - 1) * 100, -9, 9);
        p._liveHeld = true;
      });
      this.live = true; this.provider = "LIVE";
      this.latencyMs = 10 + Math.floor(Math.random() * 30);
      return true;
    } catch {
      clearTimeout(to);
      // DIEGETIC failover — no toast, no console cascade. Taskbar flips to OFFLINE // CACHED.
      // release held flags so the mock walk resumes from the last live level (no freeze).
      liveSyms.forEach((s) => { UNIVERSE[s]._liveHeld = false; });
      this.live = false; this.provider = "MOCK";
      return false;
    }
  },

  /* ---- subscribe/notify: screens re-render on ticks WITHOUT tearing down
     canvases. Returns an unsubscribe closure (call it in the effect cleanup). */
  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => { this._listeners.delete(fn); };
  },
  notify(): void {
    this._listeners.forEach((fn) => { try { fn(); } catch (err) { console.warn("DataEngine subscriber threw (loop kept alive):", err); } });
  },

  /* ---- start/stop: the shell owns the clock. Ports the prototype's
     tickLoop() cadence (1–2s randomised setTimeout chain) and its boot-time
     Coinbase handshake (tryLive once; on success re-poll every 15s).
     DEFENSE-IN-DEPTH: notify() swallows subscriber throws so one screen's
     per-tick exception can never stop the clock. */
  start(): void {
    if (this._running) return;
    this._running = true;
    if (!Object.keys(this.quotes).length) this.init();
    const loop = () => {
      if (!this._running) return;
      this.tick();
      this.notify();
      this._tickTimer = setTimeout(loop, 1000 + Math.random() * 1000); // 1–2s
    };
    this._tickTimer = setTimeout(loop, 1000 + Math.random() * 1000);
    // live handshake: fire-and-forget; failure is the diegetic OFFLINE // CACHED state
    void this.tryLive().then((ok) => {
      this.notify();
      if (ok && this._running) {
        this._liveTimer = setInterval(() => { void this.tryLive().then(() => this.notify()); }, 15000);
      }
    });
  },
  stop(): void {
    this._running = false;
    if (this._tickTimer) { clearTimeout(this._tickTimer); this._tickTimer = null; }
    if (this._liveTimer) { clearInterval(this._liveTimer); this._liveTimer = null; }
  },
};

/* ---------------- 4. RADAR FORMULAS (documented) ----------------
   Pentagon axes each scored 1..10 from the instrument's data. Formulas are
   deliberately simple and legible so the shape is honest, not decorative.

   MOMENTUM   = map dayPct from [-6%,+6%] -> [1,10], nudged by drift personality.
   VALUE      = inverse of P/E: cheaper earnings => higher value. map P/E [10,80]->[10,1].
                (crypto has no P/E -> fixed low-mid 3.)
   VOLATILITY = per-ticker vol mapped [0.008,0.055] -> [1,10], plus staged-size bump.
   LIQUIDITY  = log10(avgVol*price notional) mapped into [1,10].
   SENTIMENT  = blend of beta-scaled momentum + tag heuristics (AI/meme skew hot).
   When an order is staged, VOLATILITY and (exposure->)SENTIMENT shift with size. */
export type RadarAxis = "MOMENTUM" | "VALUE" | "VOLATILITY" | "LIQUIDITY" | "SENTIMENT";
export const RADAR_AXES: RadarAxis[] = ["MOMENTUM", "VALUE", "VOLATILITY", "LIQUIDITY", "SENTIMENT"];

export function radarScores(sym: string, stagedQty = 0): Record<RadarAxis, number> {
  const p = UNIVERSE[sym]; const q = DataEngine.get(sym);
  const m = clamp(((q.dayPct + 6) / 12) * 9 + 1 + p.drift * 2000, 1, 10);
  let val: number;
  if (!isFinite(p.pe)) val = 3;
  else val = clamp(10 - ((p.pe - 10) / (80 - 10)) * 9, 1, 10);
  const notional = Math.abs(stagedQty) * q.last;
  const sizeBump = clamp(notional / 25000, 0, 2.2); // bigger stage => more vol/exposure
  const vol = clamp(((p.vol - 0.008) / (0.055 - 0.008)) * 9 + 1 + sizeBump, 1, 10);
  const liq = clamp(((Math.log10(p.avgvol * q.last) - 8) / (12 - 8)) * 9 + 1, 1, 10);
  const hot = p.tags.some((t) => /AI|MEME|CULT|CRYPTO/.test(t)) ? 1.4 : 0;
  const sen = clamp((q.dayPct / 6) * 4 + 5 + hot + sizeBump * 0.6, 1, 10);
  return { MOMENTUM: m, VALUE: val, VOLATILITY: vol, LIQUIDITY: liq, SENTIMENT: sen };
}

/* ---------------- synthetic index chips (dashboard) ----------------
   Derived deterministically from roster quotes so they feel like a market,
   not roster dupes. The VIX chip inverts + rescales GME's chaos. */
export interface IdxDef { nm: string; sym: string; mult: number; invert?: boolean }
export const IDX_DEFS: IdxDef[] = [
  { nm: "SPX", sym: "SPY", mult: 8.02 },
  { nm: "NDX", sym: "NVDA", mult: 157.5 },
  { nm: "DJI", sym: "AAPL", mult: 197.3 },
  { nm: "VIX", sym: "GME", mult: 0.62, invert: true },
];

/* ---------------- market clock (taskbar + news timing) ----------------
   NYSE hours 09:30–16:00 America/New_York, Mon–Fri. Compute from local via ET offset. */
export function isMarketOpen(now: Date): { open: boolean; et: Date } {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay(); if (day === 0 || day === 6) return { open: false, et };
  const mins = et.getHours() * 60 + et.getMinutes();
  return { open: mins >= 570 && mins < 960, et };
}
