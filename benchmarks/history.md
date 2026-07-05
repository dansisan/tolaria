# Large-note benchmark history

Conditions (see perf-switch-benchmark.spec.ts header):
A first-visit (cold) · B revisit-clean (never edited) · C typing keydown→frame · D revisit-edited.
A switch sample = note-list click → editor shows swapped content (`[perf] noteOpen`).

## 2026-07-04 — baseline b757895c vs ab59ca52 (swap dedupe + trust-memory-on-revisit)

| condition | baseline p50/p90 | ab59ca52 p50/p90 | delta |
|---|---|---|---|
| A first-visit | 352 / 426 | 345 / 462 | none (not targeted) |
| B revisit-clean | 238 / 329 | 236 / 334 | none (cache trust predates) |
| C typing (ms/key) | 2.9 / 19.5 | 3.2 / 19.2 | none (fixed earlier session) |
| D revisit-edited | 332 / 433 | **200 / 285** | **−40% p50; disk load 50→0ms** |

CPU-profile buckets for a switch (dev build): ~40% whole-app React
render/commit, ~32% ProseMirror apply+redraw, ~6% markdown parse (A only).
Note: in B, ~95ms of "contentLoad" is actually the click's synchronous app
render blocking the async continuation (in D the pre-switch flush absorbs it
into beforeNavigate) — phase attribution shifts, totals are comparable.

## 2026-07-04 — render campaign round 1: stable handlers + StatusBar memo (vs ab59ca52)

React Profiler probe (12 clean-revisit switches, dev): Sidebar 3 commits/switch
and StatusBar 3 commits/switch → **0** after stabilizing 34 callback props via
useStableHandlers + memo(StatusBar). Cause was callback identity churn from App
defeating the existing memo() on Sidebar/NoteList.

End-to-end benchmark (3 runs each side, p50 means):
| condition | ab59ca52 | + campaign | verdict |
|---|---|---|---|
| B revisit-clean | 219 | 220 | **no user-facing change** |
| D revisit-edited | 193 | 218 | none (variance/ordering bias) |

Interpretation: the eliminated renders sit mostly AFTER editorSwapped, so this
is a background-CPU/hygiene win, not a click→content win. The critical path is
App render #1 (Editor + NoteList subtrees) → schedulePostPaint (rAF+setTimeout,
1–2 deliberate frames) → PM apply. Next levers: skip the post-paint deferral for
cache-hit swaps; Editor-subtree render cost; NoteList internal commits
(~7/switch from its own state, not props).

## 2026-07-04 — render campaign round 2 (vs round 1)

Two changes:
1. `scheduleTabSwap` defers via `queueMicrotask` instead of rAF+setTimeout —
   the post-paint hop existed for BlockNote's flushSync-in-effect crash, and a
   microtask escapes the effect stack just as safely (same mechanism as the
   editor onMount path) without spending 1–2 frames.
2. Trusted-cache switches apply in ONE render: `readTrustedNoteContentSync`
   (identity-matched cache read) lets `navigateToEntry` set the active path and
   tab content in the same commit, eliminating the second app-wide render.
   Same-path reopens keep the old read-only flow (tab entry must not be
   clobbered by stale list metadata).

3 runs, p50 means:
| condition | round 1 | round 2 | vs original baseline |
|---|---|---|---|
| A first-visit | ~333 | **214** | 352 → 214 (−39%) |
| B revisit-clean | 220 | **118–131** | 219 → ~125 (**−43%**) |
| D revisit-edited | 218 | 214 | 193 → 214 (flat; cost is the departure flush/save) |

B's remaining ~120ms = the single app render (Editor+NoteList subtrees) + PM
apply for ~350 blocks. D's floor = B + serializing/saving the departed note.

## 2026-07-04 — render campaign round 3 (vs round 2)

Three changes:
1. **Selection indicator follows the keyboard cursor** — the grey-then-blue
   flash during arrow browsing was the row rendering 'highlighted' (grey)
   while the blue 'selected' style waited for the open to commit. Keyboard
   highlight always opens the note it lands on, so `useRenderItem` now styles
   the highlighted row as the active selection immediately (perceived-latency
   fix; not captured by the timing metrics).
2. **Generous caches** — parsed-block cache 6→64 notes (source cap 3→32MB,
   entry 768KB→1MB); content cache 24→512 notes (8→96MB, entry 1→4MB);
   neighbor preload radius 3→8, limit 6→16, faster cadence. A size-sorted
   browsing window blows through a 6-note parsed cache; 64 holds it.
3. Benchmark gains condition E (rapid burst → settle) and a JS-heap readout.

2 runs, p50:
| condition | round 2 | round 3 |
|---|---|---|
| A first-visit | 214 | 206 |
| B revisit-clean | ~125 | **104** (p90 ~140) |
| D revisit-edited | 214 | 207 (departure flush still the floor) |
| E rapid burst (5 notes → settle) | — | ~943ms (new baseline) |
| JS heap after full run | — | ~133MB (dev build) |

Campaign totals from start: B 219→104 (−53%), A 352→206 (−41%).

## 2026-07-04 — round 4 baseline: the two biggest notes (300KB fixtures added)

New perf-vault fixtures huge-note-x/y (300KB each; `make-perf-vault.mjs`), new
benchmark condition F (back-and-forth on the pair):

| condition | p50 | p90 | where the time is |
|---|---|---|---|
| F huge-pair-clean | 575 | 613 | ~99% editorSwap — ProseMirror rebuild of ~1000 blocks; all caches hit |
| F huge-pair-edited | 745 | 797 | + ~180-230ms beforeNavigate — departure serialize+save on the critical path |

Round-4 options, by expected payoff on F:
1. **Editor view pool** — keep the last 2-3 notes' editor views mounted and
   swap visibility instead of rebuilding the document. Removes ~550ms swap
   for pooled notes (back-and-forth ≈ instant). Architecture change: editor
   instance per pooled tab, focus/event routing, memory (~acceptable given
   the new cache posture). High effort, high reward.
2. **Deferred departure serialization** — capture the immutable PM doc at
   switch, serialize+save post-swap. Removes the ~200ms edited-departure tax.
   Medium effort; must respect the content-bleed guards (tab content briefly
   stale while blocks cache is authoritative).
3. Accept the floor at 300KB.

## 2026-07-04 — round 4: EditorState swap instead of replaceBlocks

Profiling the 557ms huge swap: 40% was pm-model TRANSACTION machinery
(addRange/replaceTwoWay/apply/step + appendMappingInverted/invert +
validContent/matchFragment) — replaceBlocks runs the full editing pipeline
(doc-wide replace step, schema revalidation, history inverse mappings we
discard) to do a document SWAP. Not parsing, not a BlockNote limit.

Fix: `applyCachedDocState` in editorContentSwapApply — a WeakMap from cached
blocks arrays to the built (immutable) ProseMirror doc; revisits install a
fresh EditorState (view.updateState) with the cached doc. No step, no
validation, no history math; plugin state reset = per-open undo isolation
(what addToHistory:false approximated). First visits keep the old path and
populate the doc cache.

2 runs, p50:
| condition | round 3 | round 4 |
|---|---|---|
| F huge-pair-clean | 575 | **351** (−39%) |
| F huge-pair-edited | 745 | 680 (departure flush ~200ms remains) |
| B revisit-clean | 104 | ~98 |
| A first-visit | 206 | ~215 (unchanged) |

Remaining floors: ~343ms = PM view DOM rebuild + React for ~1000 blocks
(next candidates: above-the-fold chunked apply exploiting PM node-identity
reuse in view diffing; deferred departure serialization for the edited tax).
Also verified: CodeMirror never mounts in rich mode and the rich view
unmounts in raw mode — the dual-editor architecture costs bundle size, not
switch time.
