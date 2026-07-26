# Editor swap performance — what is known

Findings from investigating why opening one particular note took ~900ms. Recorded so the
next person does not repeat the search, and does not repeat the measurement mistakes.

Measured on WKWebView (the shipped runtime) unless noted. Chromium numbers come from
`tests/smoke/perf-apply-blocks-attribution.spec.ts`.

## The short version

Installing a note's document into the editor costs, for a normal note, tens of
milliseconds. For a note whose lines are separated by **single** newlines, it can cost
hundreds. Such a note collapses into a handful of paragraphs holding thousands of
`hardBreak` nodes, and **BlockNote's `paragraph` node view is ~35× more expensive to
construct when one paragraph holds thousands of inline children.**

The pathology is children-per-block, not note size and not block count:

| note | blocks | nodes | install |
|---|---|---|---|
| 147KB, ~9,200 single-spaced lines | 13 | ~18,000 | **~900ms** |
| 83KB, ordinary paragraphs | 268 | ~933 | ~50ms |

Many small blocks are cheap even though each gets its own node view. One fat block is not.

## Where the time goes

For the 18,000-node note, `console.time` around each statement of `applyBlocksToEditor`:

```
view.updateState                845ms   (94%)
  └ docView.update              729ms
editor.replaceBlocks (steps)     13ms
plugin apply + dispatch          38ms
everything else                 ~21ms
```

Isolating it further, by constructing the same document in a throwaway detached
`EditorView` and varying one thing at a time:

```
with plugins, no node views       22ms
with no plugins                  21ms
with plugins AND node views     715ms   ← reproduces the live cost
  without nodeView "paragraph"   20ms   ← 35x drop
  without nodeView "table"      731ms
  without nodeView "image"      713ms
  without nodeView "bulletListItem" 685ms
```

So: `paragraph`, and nothing else.

## Ruled out, each by measurement

| candidate | result |
|---|---|
| our plugins (129 of them) | with vs without: 2ms |
| ProseMirror's in-place patch vs full rebuild | forcing rebuild: no change |
| the editor DOM being attached / laid out | detaching for the install: no change |
| our CSS | disabling every stylesheet: no change on WKWebView |
| layout thrashing during insertion | 5 layouts for the whole install, not 9,000 |
| the side menu / drag handles | 0.03–1ms |
| block conversion, block repair, `editor.document` | <13ms combined |
| `editor.getBlock` per block | 0.1ms |

## Workarounds

- **Content**: put blank lines between paragraphs. A note of single-newline lines is the
  worst case; the same content as separate blocks is ~20–30× cheaper to open.
- **Upstream**: the reproduction above is BlockNote-only and worth filing — a paragraph
  with a few thousand inline children costs ~140ms through its node view versus ~0.1ms
  without one.
- Overriding BlockNote's `paragraph` block spec to avoid its node view was not tried.
  Block-level features (drag handles, block props) hang off that plumbing.

## Fixed along the way

- **Note-list traversal** (`useNoteListKeyboard.ts`): arrow-keying installed every note
  passed over. Opens now wait for the highlight to settle, so a traversal costs one
  install instead of one per keypress — six presses went from 6 installs/659ms to 2/138ms.
- **Selection reset** (`editorTiptapSelection.ts`): resetting the selection before a swap
  dispatched its own transaction against the *outgoing* document, costing a whole extra
  view update — 82–100ms when leaving a large note. It now rides along with the
  transaction that replaces the content, and the `cachedDoc` route skips it entirely
  because `EditorState.create` already starts the selection at the top.

## How to measure, and how not to

`tests/smoke/perf-apply-blocks-attribution.spec.ts` holds the tooling: a CPU profile, a
script/style/layout split via CDP, DOM shape counts, and a stylesheet bisect. Run it with
the regression config (it is deliberately not tagged `@smoke`):

```
npx playwright test --config playwright.config.ts \
  tests/smoke/perf-apply-blocks-attribution.spec.ts --retries=0
```

Lessons that cost real time on this investigation:

- **Profile before hypothesising.** A V8 sampling profile and a Safari timeline each
  answered in one recording what a dozen hand-built probes got wrong. The Safari timeline
  named `insertBefore` under `renderDescs` and `getBoundingClientRect` under ProseMirror's
  scroll preservation directly.
- **Chromium does not predict WKWebView here.** The same note splits as 412ms script /
  332ms style / 344ms layout in Chromium, and as ~900ms of script with ~60ms of layout on
  WKWebView. A fix validated in the harness must be re-validated natively.
- **Never toggle CSS by rewriting rules.** Use `sheet.disabled`. A per-rule bisect built
  on `deleteRule`/`insertRule` blamed 330ms on a rule that costs ~4ms, because the churn
  perturbs Chrome's rule-set state — and because failed re-inserts silently drop rules, so
  the sheet erodes as the run proceeds. The tell was that every run converged on ~1ms
  regardless of which rules it targeted.
- **Beware probes that skip the work they are measuring.** Building a view into an
  offscreen `visibility:hidden` host skips style and layout, which made attachment look
  free and produced three wrong conclusions. Detached probes are valid for *differences*
  between two detached runs (the plugin comparison above), not for absolute cost.
- **An instrument can dominate what it measures.** A forced-reflow read added to the log
  line cost 447ms and topped the profile of the swap it was there to measure.
