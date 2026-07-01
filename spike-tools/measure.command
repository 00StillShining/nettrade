#!/usr/bin/env bash
# measure.command - double-clickable version of run_measure.sh for Finder.
#
# Same steps as run_measure.sh, but cd's into the repo first and pauses at
# the end (read -n1) so the Terminal window stays open showing the verdict
# instead of closing immediately when the script finishes.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT" || { echo "Could not cd to repo root: $REPO_ROOT"; read -n1 -r -p "Press any key to close..."; exit 1; }

BUNDLE_DIR="$REPO_ROOT/src-tauri/target/release/bundle/macos"
OUT_DIR="$SCRIPT_DIR/_out"
FRAMES_DIR="$OUT_DIR/frames"
HEATMAP_PATH="$OUT_DIR/worst_heatmap.png"
CAPTURE_SECONDS=9

echo "==> (a) Locating newest built app bundle in: $BUNDLE_DIR"
if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "build first: SPIKE=1 npm run tauri build"
  read -n1 -r -p "Press any key to close..."
  exit 1
fi

APP_PATH=""
if [[ -d "$BUNDLE_DIR/Actuality.app" ]]; then
  APP_PATH="$BUNDLE_DIR/Actuality.app"
else
  APP_PATH="$(find "$BUNDLE_DIR" -maxdepth 1 -name '*.app' -print0 2>/dev/null \
    | xargs -0 -I{} stat -f '%m %N' {} 2>/dev/null \
    | sort -rn | head -n1 | cut -d' ' -f2-)"
fi

if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "build first: SPIKE=1 npm run tauri build"
  read -n1 -r -p "Press any key to close..."
  exit 1
fi

echo "    Using app bundle: $APP_PATH"

echo "==> (b) Opening app"
open "$APP_PATH"

echo "==> (c) Waiting ~4s for the window to appear and go fullscreen"
sleep 4

echo "==> (d) Preparing fresh frames directory: $FRAMES_DIR"
rm -rf "$FRAMES_DIR"
mkdir -p "$FRAMES_DIR"

echo "==> (e) Capturing frames for ${CAPTURE_SECONDS}s (covers ~2 auto-loop cycles: idle+dolly+wipe+settle ~3.7s/cycle)"
"$SCRIPT_DIR/capture.sh" "$FRAMES_DIR" "$CAPTURE_SECONDS"
capture_status=$?
if [[ $capture_status -ne 0 ]]; then
  echo "Capture failed (see message above). Aborting."
  read -n1 -r -p "Press any key to close..."
  exit 1
fi

echo "==> (f) Running measure.py on captured frames"
mkdir -p "$OUT_DIR"
python3 "$SCRIPT_DIR/measure.py" "$FRAMES_DIR" --out "$HEATMAP_PATH"

echo "==> (g) Heatmap saved to: $HEATMAP_PATH"
echo "    (App left open for manual inspection.)"
echo ""
read -n1 -r -p "Press any key to close this window..."
