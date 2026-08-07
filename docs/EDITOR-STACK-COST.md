# What the BlockNote stack costs — and the CodeMirror question

**Status: recorded, not planned.** No work is scheduled off this. Perf complaints today are
confined to pathological notes (see [EDITOR-SWAP-PERF.md](EDITOR-SWAP-PERF.md)), which is not
enough to justify a migration. This exists so the next person asking "what is BlockNote
actually costing us?" does not have to re-measure it.

Measured at `69369325`, `@blocknote/* 0.46.2`.

## The short version

The bundle cost is real and **irrelevant**. The complexity cost is the reason to care, and it
is much larger than the bundle number suggests.

## Bundle: ~1.1 MB, and not a reason to act

Attributed from a sourcemapped production build of the eager `App` chunk (6,284 KB minified):

| group | KB min |
|---|---|
| `@blocknote/{core,react,mantine,code-block}` | 329 |
| `prosemirror-*` (view, model, tables, transform, state, commands, history) | 230 |
| `@mantine/{core,hooks}` — present only for BlockNote's UI shell | 126 |
| `yjs` + `lib0` + `y-prosemirror` | 106 |
| `@tiptap/{core,react,extension-link}` | 92 |
| `@floating-ui/react` | 23 |
| `linkifyjs` | 14 |
| **total JS** | **920 (14.6% of the chunk)** |

Plus 162 KB of the 266 KB `App-*.css` (61%) is Mantine/`.bn-`/blocknote selectors.

**Why this does not matter:** Tauri loads from local disk. There is no download. The only
size-derived cost is parse/eval at cold start, that is the whole 6.3 MB chunk rather than
BlockNote's slice, and it is a one-time cost in the low hundreds of ms. Do not spend effort
here. The number is recorded to close the question, not to open it.

Two incidental findings, independent of any editor decision. Both are *eagerly evaluated* at
startup rather than merely present, which is the only way bundle contents cost anything here —
so both were measured (fresh V8 process, 5 runs, module-eval time only):

| eager work at startup | measured |
|---|---|
| `iconRegistry.ts` — 356 Phosphor icons, each building a 6-entry weight `Map` of `createElement` trees at module scope | **~21 ms** |
| 18 locale catalogs inlined as JS object literals | **~12 ms** |
| *(for contrast: `JSON.parse` of the same locale bytes)* | 5 ms |
| *(baseline: React alone)* | 1 ms |

**~33 ms combined. That is not a startup win worth chasing.** Recorded so the question stays
closed. Caveat: V8, not the shipped WKWebView; same order, not the same number.

Detail, since the shape is not obvious:

- `@phosphor-icons/react` contributes **1,147 KB**, but *not* from a tree-shaking failure —
  this was mis-diagnosed as a barrel-import problem at first. The sourcemap's 712 modules are
  356 icons × 2 files (`defs/` + `csr/`). Roughly 290 come from `ICON_OPTIONS` in
  `src/utils/iconRegistry.ts`, a deliberately curated picker; ~117 more are used across the
  UI. Deferring the picker is a real refactor, not an import-statement fix.
- `src/lib/i18n.ts:205` uses `import.meta.glob(..., { eager: true })`, so all 18 catalogs
  (~980 KB) are inlined as object literals and constructed at module scope. `TRANSLATIONS` is
  then a synchronous module-level map, so making it lazy means gating app init on the selected
  catalog — contained, but it does ripple into the `t()` path.
- `vite.config.ts` sets no `manualChunks` and `App.tsx` has no `lazy()`, so all of it is eager.

Two things that are BlockNote's but not load-bearing: `yjs`+`lib0`+`y-prosemirror` (106 KB) is
dead — nothing in `src/` uses collaboration, `@blocknote/core` imports it unconditionally.
`@mantine/core` exists only because we use `@blocknote/mantine`.

### Reproducing the attribution

`npx vite build --sourcemap`, then attribute minified bytes per source via the chunk's
sourcemap. **Measurement trap:** the naive "a segment owns the bytes until the next segment"
rule misassigns unmapped inlined data to whatever package precedes it — it initially credited
808 KB of inlined locale JSON to `@dnd-kit/sortable`, a package whose entire source is 20 KB.
Cap oversized spans (>1.5 KB) into a separate "unmapped" bucket, and sanity-check any package
whose attributed size exceeds its on-disk size.

## Complexity: the actual cost

| | lines |
|---|---|
| Patches against the editor stack (5 packages) | 1,635 |
| — of which `@blocknote/core` alone | 1,102 |
| Non-test `src/` touching `@blocknote` | 9,614 |
| `blockNote*.regression.test.ts` (8 files, each named for a bug) | 736 |
| Mode-sync glue existing *only* because there are two editors | ~700 |
| ADRs mentioning blocknote/prosemirror | 20 of 143 |

The `@blocknote/core` patch is the sharpest signal: it patches `dist/` — pre-bundled output —
so every version bump means re-deriving 1,102 lines against minified files.

## The asymmetry

The app already contains a complete second editor. Raw mode is not code-block plumbing; it is
CodeMirror 6: `RawEditorView.tsx` (548), `useCodeMirror.ts` (376), `RawEditorFindBar.tsx`
(572), plus `frontmatterHighlight` / `markdownHighlight` / `findMatchHighlight` /
`zoomCursorFix`. **1,943 lines, zero vendor patches.**

So the entire CM6 editor costs about a fifth of the *adaptation layer* wrapped around
BlockNote, and carries none of the patch burden. Obsidian is CM6-only and reaches inline
WYSIWYG through Live Preview decorations.

## Possible direction

Consolidate on CM6 and drop the BlockNote/ProseMirror/Tiptap/Mantine/Yjs stack. That removes
920 KB JS, 162 KB CSS, 1,635 lines of vendor patches, the ~700-line two-editor sync layer, and
the class of bugs the 8 regression files were written for.

**This is a migration, not a cleanup.** BlockNote buys real WYSIWYG: inline tables with resize
handles, math, mermaid, checklists, drag-reorder, wikilink autocomplete. On CM6 those have to
be rebuilt as decorations. Obsidian proves the path exists; it does not make it cheap.

**The question that decides it:** what fraction of the 9,614 BlockNote-coupled lines is
*workaround* versus *feature*? Workaround lines evaporate on migration; feature lines must be
rewritten. That split is a few hours of reading and has not been done. Until it is, the effort
estimate is unfounded in either direction.

**Trigger to revisit:** perf problems that show up on ordinary notes rather than pathological
ones, or a BlockNote upgrade whose patch re-derivation cost becomes intolerable.
