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
