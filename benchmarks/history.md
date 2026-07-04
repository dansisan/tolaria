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
