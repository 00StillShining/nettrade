#!/usr/bin/env python3
"""
measure.py - pixel-diff measurement harness for the Phase-0 Tauri spike.

Usage:
    python3 measure.py FRAMES_DIR [--crop-top 0.03] [--out HEATMAP.png]

What it does
------------
Loads all frame_*.png images in FRAMES_DIR (sorted), downscales each to a
manageable width for speed, crops off the top crop-top fraction (macOS menu
bar), and computes the mean-abs pixel diff (0-255 scale) between every
consecutive pair of frames -- both a single GLOBAL number and an 8x8 GRID of
per-cell numbers (for localizing where on screen the change happened).

It then classifies pairs as QUIET (near-static) or ACTIVE (scene moving),
and reports:
  - idle_baseline: how close to zero the screen gets when nothing should be
    animating (proves demand-frameloop + baked CRT overlay are inert at rest)
  - motion stats: how big the diffs are during intentional camera/wipe motion
  - flash_spikes: whole-screen recomposite/flatten events (the v1 "brick"
    signature) -- large diff AND spread across most of the screen
  - stalls: frozen frames in the middle of motion (compositor stalls)
  - localization of the single worst pair, saved as a heatmap PNG

This is a heuristic report to inform a human go/no-go call, not a hard
pass/fail test gate. It always exits 0.
"""

import argparse
import glob
import os
import sys

try:
    from PIL import Image, ImageChops, ImageDraw
except ImportError:
    print("ERROR: Pillow (PIL) is required. Install with: pip3 install Pillow", file=sys.stderr)
    sys.exit(1)

try:
    import numpy as np  # type: ignore
    HAVE_NUMPY = True
except ImportError:
    np = None
    HAVE_NUMPY = False

GRID_N = 8               # 8x8 grid -> 64 cells
TARGET_WIDTH = 480        # downscale width for speed
QUIET_THRESHOLD = 0.15    # global diff below this = QUIET pair
IDLE_BASELINE_PASS = 0.5  # PASS if idle_baseline <= this
MAX_STALLS_PASS = 2       # PASS if stalls <= this


# ----------------------------------------------------------------------
# Frame loading / preprocessing
# ----------------------------------------------------------------------

def load_frames(frames_dir, crop_top_frac, target_width=TARGET_WIDTH):
    paths = sorted(glob.glob(os.path.join(frames_dir, "frame_*.png")))
    if len(paths) < 2:
        print(f"ERROR: need at least 2 frames in {frames_dir}, found {len(paths)}", file=sys.stderr)
        sys.exit(1)

    frames = []
    for p in paths:
        img = Image.open(p).convert("RGB")
        w, h = img.size
        if w > target_width:
            scale = target_width / float(w)
            new_size = (target_width, max(1, int(round(h * scale))))
            img = img.resize(new_size, Image.BILINEAR)
        w2, h2 = img.size
        crop_px = int(round(h2 * crop_top_frac))
        if crop_px > 0 and crop_px < h2:
            img = img.crop((0, crop_px, w2, h2))
        frames.append(img)

    return paths, frames


# ----------------------------------------------------------------------
# Diff computation (numpy path + pure-PIL fallback)
# ----------------------------------------------------------------------

def grid_cell_bounds(width, height, grid_n):
    """Return list of (x0, y0, x1, y1) for an grid_n x grid_n grid over width x height."""
    bounds = []
    for gy in range(grid_n):
        y0 = int(round(height * gy / grid_n))
        y1 = int(round(height * (gy + 1) / grid_n))
        for gx in range(grid_n):
            x0 = int(round(width * gx / grid_n))
            x1 = int(round(width * (gx + 1) / grid_n))
            bounds.append((x0, y0, max(x1, x0 + 1), max(y1, y0 + 1)))
    return bounds


def diff_pair(img_a, img_b, grid_n=GRID_N):
    """
    Compute global mean-abs diff (0-255) and an grid_n x grid_n list of
    per-cell mean-abs diffs between img_a and img_b (same size, RGB).

    Returns (global_diff, grid_diffs) where grid_diffs is a flat list of
    length grid_n*grid_n in row-major (gy then gx) order.
    """
    diff_img = ImageChops.difference(img_a, img_b)
    w, h = diff_img.size

    if HAVE_NUMPY:
        arr = np.asarray(diff_img, dtype=np.float32)  # (h, w, 3)
        global_diff = float(arr.mean())
        grid_diffs = []
        for gy in range(grid_n):
            y0 = int(round(h * gy / grid_n))
            y1 = int(round(h * (gy + 1) / grid_n))
            y1 = max(y1, y0 + 1)
            for gx in range(grid_n):
                x0 = int(round(w * gx / grid_n))
                x1 = int(round(w * (gx + 1) / grid_n))
                x1 = max(x1, x0 + 1)
                cell = arr[y0:y1, x0:x1, :]
                grid_diffs.append(float(cell.mean()))
        return global_diff, grid_diffs

    # Pure-PIL fallback: use ImageStat for global, and per-cell via crop+ImageStat.
    from PIL import ImageStat
    global_stat = ImageStat.Stat(diff_img)
    global_diff = sum(global_stat.mean) / len(global_stat.mean)

    grid_diffs = []
    bounds = grid_cell_bounds(w, h, grid_n)
    for (x0, y0, x1, y1) in bounds:
        cell_img = diff_img.crop((x0, y0, x1, y1))
        cell_stat = ImageStat.Stat(cell_img)
        cell_diff = sum(cell_stat.mean) / len(cell_stat.mean)
        grid_diffs.append(cell_diff)

    return global_diff, grid_diffs


# ----------------------------------------------------------------------
# Analysis
# ----------------------------------------------------------------------

def longest_quiet_run(labels):
    """labels: list of 'QUIET'/'ACTIVE' per pair index. Returns (start, end) inclusive
    indices of the longest consecutive run of QUIET, or None if no QUIET pairs."""
    best_start, best_len = None, 0
    cur_start, cur_len = None, 0
    for i, lab in enumerate(labels):
        if lab == "QUIET":
            if cur_start is None:
                cur_start = i
            cur_len += 1
            if cur_len > best_len:
                best_len = cur_len
                best_start = cur_start
        else:
            cur_start, cur_len = None, 0
    if best_start is None:
        return None
    return (best_start, best_start + best_len - 1)


def find_stalls(labels):
    """QUIET pairs immediately preceded AND followed by ACTIVE pairs -> frozen mid-motion."""
    stalls = []
    n = len(labels)
    for i, lab in enumerate(labels):
        if lab != "QUIET":
            continue
        prev_active = (i - 1 >= 0) and (labels[i - 1] == "ACTIVE")
        next_active = (i + 1 < n) and (labels[i + 1] == "ACTIVE")
        if prev_active and next_active:
            stalls.append(i)
    return stalls


def median(values):
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2.0


def percentile(values, pct):
    if not values:
        return 0.0
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * (pct / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def hot_cell_stats(grid_diffs):
    """Given a flat list of per-cell diffs for one pair, return (hot_count, hot_pct, max_cell)."""
    if not grid_diffs:
        return 0, 0.0, 0.0
    max_cell = max(grid_diffs)
    if max_cell <= 0:
        return 0, 0.0, 0.0
    half = max_cell / 2.0
    hot = [v for v in grid_diffs if v > half]
    hot_count = len(hot)
    hot_pct = 100.0 * hot_count / len(grid_diffs)
    return hot_count, hot_pct, max_cell


def find_flash_spikes(pairs_info, active_indices, median_active):
    """
    pairs_info[i] = dict with 'global', 'grid' for pair i.
    A flash spike = ACTIVE pair whose global diff exceeds
    max(3.0, 6*median_active) AND whose diff is spread across many grid
    cells (>60% of cells above half that pair's max cell value) --
    i.e. a whole-screen flatten, not a localized wipe/dolly band.
    """
    threshold = max(3.0, 6.0 * median_active) if median_active > 0 else 3.0
    spikes = []
    for i in active_indices:
        g = pairs_info[i]["global"]
        if g <= threshold:
            continue
        hot_count, hot_pct, max_cell = hot_cell_stats(pairs_info[i]["grid"])
        if hot_pct > 60.0:
            spikes.append({
                "index": i,
                "global": g,
                "hot_pct": hot_pct,
                "hot_count": hot_count,
            })
    spikes.sort(key=lambda s: s["global"], reverse=True)
    return threshold, spikes


# ----------------------------------------------------------------------
# Heatmap rendering
# ----------------------------------------------------------------------

def save_heatmap(worst_frame_img, grid_diffs, grid_n, out_path):
    """
    Render an upscaled grid heatmap overlaid on the worst frame.
    Red intensity scales with that cell's diff relative to the max cell
    in this grid.
    """
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    base = worst_frame_img.convert("RGBA")
    w, h = base.size
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    max_cell = max(grid_diffs) if grid_diffs else 1.0
    max_cell = max(max_cell, 1e-6)

    bounds = grid_cell_bounds(w, h, grid_n)
    for idx, (x0, y0, x1, y1) in enumerate(bounds):
        v = grid_diffs[idx]
        intensity = min(1.0, v / max_cell)
        alpha = int(180 * intensity)
        draw.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(255, 0, 0, alpha))
        draw.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 255, 255, 60))

    composite = Image.alpha_composite(base, overlay).convert("RGB")
    composite.save(out_path)


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Pixel-diff measurement harness for the Phase-0 spike.")
    parser.add_argument("frames_dir", help="Directory containing frame_*.png captures")
    parser.add_argument("--crop-top", type=float, default=0.03,
                         help="Fraction of image height to crop off the top (menu bar). Default 0.03")
    parser.add_argument("--out", type=str, default=None,
                         help="Path to save the worst-pair heatmap PNG. Default spike-tools/_out/worst_heatmap.png")
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.join(script_dir, "_out", "worst_heatmap.png")
    out_path = args.out or default_out

    print(f"Backend: {'numpy' if HAVE_NUMPY else 'pure-PIL (numpy not found, using ImageStat fallback)'}")
    print(f"Loading frames from: {args.frames_dir}")

    paths, frames = load_frames(args.frames_dir, args.crop_top)
    n_frames = len(frames)
    n_pairs = n_frames - 1
    print(f"Loaded {n_frames} frames -> {n_pairs} consecutive pairs")

    pairs_info = []
    for i in range(n_pairs):
        g, grid = diff_pair(frames[i], frames[i + 1])
        pairs_info.append({"global": g, "grid": grid, "i": i})

    globals_all = [p["global"] for p in pairs_info]

    labels = ["QUIET" if g < QUIET_THRESHOLD else "ACTIVE" for g in globals_all]
    quiet_indices = [i for i, lab in enumerate(labels) if lab == "QUIET"]
    active_indices = [i for i, lab in enumerate(labels) if lab == "ACTIVE"]

    # --- idle baseline: median of the longest run of consecutive QUIET pairs
    run = longest_quiet_run(labels)
    if run is not None:
        r0, r1 = run
        idle_run_values = [globals_all[i] for i in range(r0, r1 + 1)]
        idle_baseline = median(idle_run_values)
        idle_run_len = r1 - r0 + 1
    else:
        idle_baseline = None
        idle_run_len = 0

    overall_min = min(globals_all) if globals_all else 0.0

    # --- motion stats (ACTIVE pairs)
    active_values = [globals_all[i] for i in active_indices]
    motion_median = median(active_values) if active_values else 0.0
    motion_p95 = percentile(active_values, 95) if active_values else 0.0
    motion_max = max(active_values) if active_values else 0.0

    # --- flash spikes
    flash_threshold, flash_spikes = find_flash_spikes(pairs_info, active_indices, motion_median)

    # --- stalls
    stall_indices = find_stalls(labels)

    # --- worst pair overall (for heatmap)
    worst_idx = max(range(n_pairs), key=lambda i: globals_all[i]) if n_pairs else None
    worst_hot_count, worst_hot_pct, worst_max_cell = (0, 0.0, 0.0)
    if worst_idx is not None:
        worst_hot_count, worst_hot_pct, worst_max_cell = hot_cell_stats(pairs_info[worst_idx]["grid"])
        save_heatmap(frames[worst_idx], pairs_info[worst_idx]["grid"], GRID_N, out_path)

    # ------------------------------------------------------------------
    # Report
    # ------------------------------------------------------------------
    print()
    print("=" * 72)
    print("PIXEL-DIFF MEASUREMENT REPORT")
    print("=" * 72)
    print(f"{'Frames analyzed:':32s} {n_frames}")
    print(f"{'Consecutive pairs:':32s} {n_pairs}")
    print(f"{'QUIET pairs (<{:.2f}):'.format(QUIET_THRESHOLD):32s} {len(quiet_indices)}")
    print(f"{'ACTIVE pairs (>={:.2f}):'.format(QUIET_THRESHOLD):32s} {len(active_indices)}")
    print(f"{'Overall min pair diff:':32s} {overall_min:.4f}")
    print()
    print("-- Idle baseline (scene at rest) --")
    if idle_baseline is not None:
        print(f"{'Longest QUIET run length:':32s} {idle_run_len} pairs")
        print(f"{'idle_baseline (median of run):':32s} {idle_baseline:.4f}")
    else:
        print("  No QUIET run found -- the scene never rests during capture.")
        idle_baseline = float("inf")
    print()
    print("-- Motion (ACTIVE pairs: camera dolly / wipe) --")
    print(f"{'median:':32s} {motion_median:.4f}")
    print(f"{'p95:':32s} {motion_p95:.4f}")
    print(f"{'max:':32s} {motion_max:.4f}")
    print()
    print("-- Flash spikes (whole-screen recomposite/flatten, v1 brick signature) --")
    print(f"{'threshold used:':32s} {flash_threshold:.4f} (max(3.0, 6*median_active))")
    print(f"{'flash_spikes found:':32s} {len(flash_spikes)}")
    if flash_spikes:
        worst_spike = flash_spikes[0]
        print(f"  worst spike: pair #{worst_spike['index']} global={worst_spike['global']:.4f} "
              f"hot_cells={worst_spike['hot_count']}/{GRID_N*GRID_N} ({worst_spike['hot_pct']:.1f}% of screen)")
    print()
    print("-- Stalls (frozen frame isolated between ACTIVE pairs) --")
    print(f"{'stalls found:':32s} {len(stall_indices)}")
    if stall_indices:
        print(f"  stall pair indices: {stall_indices}")
    print()
    print("-- Worst single pair (used for heatmap) --")
    if worst_idx is not None:
        print(f"{'pair index:':32s} {worst_idx}  ({os.path.basename(paths[worst_idx])} -> {os.path.basename(paths[worst_idx+1])})")
        print(f"{'global diff:':32s} {globals_all[worst_idx]:.4f}")
        print(f"{'hot cells:':32s} {worst_hot_count}/{GRID_N*GRID_N} ({worst_hot_pct:.1f}% of screen above half max-cell)")
        print(f"{'heatmap saved to:':32s} {out_path}")
    print("=" * 72)

    # ------------------------------------------------------------------
    # Verdict
    # ------------------------------------------------------------------
    idle_ok = idle_baseline <= IDLE_BASELINE_PASS
    no_flash = len(flash_spikes) == 0
    stalls_ok = len(stall_indices) <= MAX_STALLS_PASS

    verdict_pass = idle_ok and no_flash and stalls_ok

    print()
    print("#" * 72)
    if verdict_pass:
        print("# VERDICT: PASS (heuristic)")
        print("#   idle_baseline is low, zero whole-screen flash spikes, stalls are few.")
        print("#   -> Consistent with smooth, localized motion. No v1 'brick' signature.")
    else:
        reasons = []
        if not idle_ok:
            reasons.append(f"idle_baseline={idle_baseline:.4f} > {IDLE_BASELINE_PASS} (scene never truly rests -- something may be repainting at rest)")
        if not no_flash:
            reasons.append(f"{len(flash_spikes)} whole-screen flash_spike(s) detected (v1 brick signature: full recomposite/flatten)")
        if not stalls_ok:
            reasons.append(f"{len(stall_indices)} stall(s) detected (compositor freezing mid-motion)")
        print("# VERDICT: FAIL / INVESTIGATE (heuristic)")
        for r in reasons:
            print(f"#   - {r}")
    print("#")
    print("# This is a HEURISTIC to inform a human go/no-go call, not a hard test gate.")
    print(f"# Eyeball the saved heatmap: {out_path}")
    print("#   localized band (few hot cells, e.g. a wipe edge) = healthy motion = PASS signal")
    print("#   whole-screen hot (most of 64 cells lit up)        = recompose/flatten = FAIL signal")
    print("#" * 72)

    sys.exit(0)


if __name__ == "__main__":
    main()
