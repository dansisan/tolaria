---
type: ADR
id: "0136"
title: "Wider autosave idle window"
status: active
date: 2026-07-03
supersedes: "0102"
---

## Context

Supersedes [ADR-0102](0102-low-end-safe-autosave-idle-window.md).

Profiling typing latency in a 100KB note showed that per-keystroke editor work is cheap (sub-frame even at 200 WPM), but the deferred editor pipeline — 500ms change flush, then the autosave and its completion state updates — triggers an app-wide re-render roughly 2s after a typing pause. When the user has resumed typing by then, that render blocks the main thread for ~200ms+ and visibly delays keystrokes. The 1.5s window also fires an autosave for nearly every natural typing pause, so a pause-heavy writing session saves far more often than needed.

## Decision

**Tolaria autosaves after a 30s idle window (`AUTO_SAVE_DEBOUNCE_MS`), treating autosave purely as a crash backstop while all explicit flush paths stay immediate.** Manual saves (Cmd+S and File→Save), note switches, raw-mode transitions, and destructive actions persist pending content right away, and stale in-flight autosave protection from ADR-0102 is unchanged.

## Options considered

- **Option A — widen the idle window to 30s, backstop-only** (chosen): every interactive exit already flushes synchronously, so a short idle window mostly duplicates those flushes while causing mid-typing save collisions. One-line change; timing stays defined by a single constant that tests share.
- **Option B — moderate widening (3–5s)**: fewer collisions than 1.5s but still saves on nearly every natural pause, keeping the save pipeline's re-render in the typing hot path.
- **Option C — reset the autosave timer on every keystroke**: avoids mid-typing saves entirely but couples the save layer to editor input events, and a continuously typing user would never autosave.

## Consequences

- Autosaves effectively disappear from normal writing flow; disk writes, vault-entry refreshes, and their re-renders coalesce into explicit flush points.
- The crash-loss window grows from ~2s to ~30.5s after the last keystroke (500ms flush + 30s idle). Explicit flushes still bound loss on navigation and manual save — but **app quit does not flush** (the Rust exit handler only persists window state), so quitting within 30s of typing without Cmd+S loses that typing. A quit-time flush is the natural follow-up if this bites.
- Side effects that ride on persistence (untitled-note H1 auto-rename, unsaved-indicator clearing, autogit dirtiness) settle only at the next explicit flush or ~30.5s after typing stops.
- `UNTITLED_RENAME_DEBOUNCE_MS` is now derived as `AUTO_SAVE_DEBOUNCE_MS + 1s` (was a fixed 2.5s): the rename reads the H1 from disk, so it must always fire after the buffered save that persisted it. Idle untitled-rename latency grows accordingly (~60s worst case); navigation, tab switches, and manual saves still flush the rename immediately.
- The Playwright fixture harness injects `__TOLARIA_AUTOSAVE_IDLE_MS` (1.5s) via init script so specs exercise the same ordering relationships without idle-waiting the production interval; specs derive waits from `FIXTURE_AUTOSAVE_IDLE_MS`, unit tests from the real constants under fake timers.
- Re-evaluate if users report lost edits (crash/force-quit) or if save-side-effect latency (rename, indicators) feels broken rather than merely relaxed.
