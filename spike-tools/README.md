# Phase-0 spike measurement tools

This folder answers one question with real numbers instead of a vibe check:

**"When the app is on screen, is the picture staying smooth, or is the whole
screen flashing/repainting when it shouldn't?"**

That second thing — a whole-screen flash — is exactly what killed the v1
build (nicknamed "the brick"): the web view's compositor would drop and
redraw the entire screen instead of just the bit that changed, and it showed
up as the whole picture flickering, especially at the edges/corners, even
though the data in the middle wasn't changing.

This spike deliberately includes a moving scene (a camera move + a wipe
effect) so we can check two things at once:

1. **At rest, is it truly still?** When nothing is supposed to be animating,
   the screen should barely change frame to frame (near zero). If it's not
   near zero, something is quietly repainting the whole screen even when
   idle — a bad sign.
2. **During motion, is it smooth or is it flashing?** Camera moves and wipes
   are *supposed* to change the picture. The question is whether that change
   is smooth and localized to where the motion is happening (healthy), or
   whether the entire screen flashes/flattens as one big event (the v1
   "brick" problem), or whether the picture freezes for a beat mid-motion
   (a stutter/stall).

## How it works, in plain terms

We take a rapid burst of full-screen screenshots (roughly 15-20 per second)
while the app is running, and compare every screenshot to the one right
before it. For each pair we measure:

- **A single overall "how much changed" number** for the whole screen.
- **A grid of 64 smaller numbers** (an 8x8 checkerboard over the screen) so
  we can see *where* the change happened, not just how much.

From that we build a report and a **heatmap picture** you can look at with
your own eyes.

## Step 1 — Build the spike

From the repo root:

```
SPIKE=1 npm run tauri build
```

This produces a real, compiled `.app` bundle under
`src-tauri/target/release/bundle/macos/`.

## Step 2 — Run the measurement

You have two options, both do the exact same thing:

### Option A — double-click (no terminal knowledge needed)

In Finder, double-click:

```
spike-tools/measure.command
```

A Terminal window will open, run everything automatically, and stay open at
the end so you can read the result. Press any key to close it when you're
done.

### Option B — run from a terminal

```
cd "spike-tools"
./run_measure.sh
```

Either way, it will:

1. Find the newest built `.app`.
2. Open it.
3. Wait a few seconds for it to appear full-screen.
4. Record ~9 seconds of screenshots (enough to cover about two full loops of
   the demo animation).
5. Analyze those screenshots and save a heatmap image.
6. Print a report and a plain verdict.

The app is left open afterwards so you can look at it yourself too.

## Step 3 — Read the verdict

At the very end of the report you'll see something like:

```
VERDICT: PASS (heuristic)
```

or

```
VERDICT: FAIL / INVESTIGATE (heuristic)
```

**This is a heuristic, not a certified test result.** It's here to give you
(a non-coder making a build-tool decision) solid evidence to look at, not to
replace your own judgment. Always also glance at the heatmap image (see
below).

What the verdict is checking:

| Signal | Healthy | Unhealthy (v1 "brick" signature) |
|---|---|---|
| Screen at rest | Reads almost exactly 0 | Reads noticeably above 0 (something is repainting even when nothing should move) |
| During motion | Change is present but happens across a normal amount of change | A sudden, huge spike, spread across almost the *entire* screen at once |
| Mid-motion freezes | None, or just one or two | Several — the picture is stuttering/pausing |

If you get a **PASS**: this is a good sign that the current build approach
(Tauri) is handling the animation cleanly, without the recompositing bug
that broke v1. Reasonable to keep building on this foundation.

If you get a **FAIL / INVESTIGATE**: something is behaving like the v1 brick
did — either the screen never truly rests, or there's a whole-screen flash
during motion, or there are multiple freezes. This is the signal to look
seriously at falling back to the Electron approach instead, or to dig into
*why* before committing further.

## Step 4 — Look at the heatmap

After a run, open:

```
spike-tools/_out/worst_heatmap.png
```

This is a picture of the single worst moment found during the recording,
with a red overlay showing which parts of the screen changed the most.

- **Healthy:** the red is concentrated in a narrow band or region — e.g.
  along the edge of a wipe effect, or where the camera move is happening.
  That's exactly what you'd expect from an intentional, localized animation.
- **Unhealthy:** the red is spread across almost the *entire* picture, corner
  to corner. That means the whole screen was being redrawn as one event —
  the same pattern that caused the v1 brick's flashing.

## Files in this folder

| File | Purpose |
|---|---|
| `capture.sh` | Captures a rapid burst of full-screen screenshots into a folder |
| `measure.py` | Analyzes the screenshots, prints the report + verdict, saves the heatmap |
| `run_measure.sh` | One command that does the whole thing end-to-end (terminal) |
| `measure.command` | Same as above, but double-clickable from Finder |
| `_out/` | Where captured frames, the report, and the heatmap land (safe to delete/regenerate any time) |

## Notes

- macOS will ask for **Screen Recording permission** the first time you run
  this (for whichever app runs the terminal — Terminal.app, iTerm, etc. — or
  when double-clicking, for Terminal.app itself). Grant it under
  **System Settings > Privacy & Security > Screen & System Audio Recording**,
  then re-run. You may need to quit and reopen the terminal app once after
  granting permission.
- This tooling only reads the screen and writes into `spike-tools/`. It does
  not touch any application source code.
- Nothing here is a hard pass/fail gate — it's a measurement to help a human
  make the Tauri-vs-Electron call with real evidence instead of a guess.
