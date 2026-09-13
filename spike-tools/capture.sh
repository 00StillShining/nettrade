#!/usr/bin/env bash
# capture.sh - grab consecutive full-screen PNG frames as fast as possible
#
# Usage: capture.sh OUT_DIR DURATION_SEC
#
# Loops `screencapture -x -t png "$OUT_DIR/frame_%05d.png"` for DURATION_SEC
# seconds. Expect roughly 15-20 fps depending on machine/display.

set -u

OUT_DIR="${1:-}"
DURATION_SEC="${2:-}"

if [[ -z "$OUT_DIR" || -z "$DURATION_SEC" ]]; then
  echo "Usage: $0 OUT_DIR DURATION_SEC" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

frame_path() {
  printf "%s/frame_%05d.png" "$OUT_DIR" "$1"
}

# First capture: sanity check that Screen Recording permission is granted.
first_frame="$(frame_path 0)"
screencapture -x -t png "$first_frame"
first_status=$?

if [[ $first_status -ne 0 || ! -s "$first_frame" ]]; then
  echo "" >&2
  echo "ERROR: screencapture failed (exit $first_status) or produced an empty file." >&2
  echo "This almost always means Screen Recording permission is not granted." >&2
  echo "" >&2
  echo "To fix:" >&2
  echo "  1. Open System Settings > Privacy & Security > Screen & System Audio Recording" >&2
  echo "     (older macOS: Privacy & Security > Screen Recording)" >&2
  echo "  2. Enable the terminal app (or host app) you are running this script from" >&2
  echo "     e.g. Terminal.app, iTerm.app, or your IDE's integrated terminal" >&2
  echo "  3. You may need to quit and reopen that terminal app for the permission to take effect" >&2
  echo "  4. Re-run this script" >&2
  echo "" >&2
  rm -f "$first_frame"
  exit 1
fi

count=1
start_ts=$(date +%s)
end_ts=$(( start_ts + DURATION_SEC ))

while [[ $(date +%s) -lt $end_ts ]]; do
  out="$(frame_path "$count")"
  screencapture -x -t png "$out" 2>/dev/null
  if [[ -s "$out" ]]; then
    count=$(( count + 1 ))
  else
    rm -f "$out"
  fi
done

elapsed=$(( $(date +%s) - start_ts ))
if [[ $elapsed -le 0 ]]; then
  elapsed=1
fi

echo "Captured $count frames in ${elapsed}s (~$(( count / elapsed )) fps) -> $OUT_DIR"
