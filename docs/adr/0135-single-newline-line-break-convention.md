---
type: ADR
id: "0135"
title: "Single newline renders as a line break (notes-markdown convention)"
status: active
date: 2026-06-28
---

## Context

Notes are stored as Markdown on disk and rendered two ways: the **BlockNote**
rich editor (the primary, editable view) and a **react-markdown** reading view
(`MarkdownContent`, used for AI chat and previews).

These disagreed on what a single `\n` between two text lines means:

- **Strict CommonMark** (what react-markdown + `remark-gfm` does) treats a single
  `\n` as a *soft break* — it renders as a space, joining the two lines.
- **BlockNote's editor** keeps a single `\n` inside a paragraph as a visible
  line break, and Obsidian's default ("Strict line breaks: off") does the same.

The standard CommonMark way to force an in-paragraph line break is a **hard
break** — two trailing spaces or a trailing backslash. But BlockNote's markdown
parser reads a hard break back as *two* breaks, so every editor save widened the
gap by a blank line (an unstable round-trip). This first surfaced importing
Apple Notes, where each note line must stay on its own line without gaining a
blank-line gap.

## Decision

**A single `\n` between text lines means a visible line break, following the
notes-markdown convention used by Obsidian/Bear rather than strict CommonMark.**

To make this work consistently:

1. On editor **save**, `compactMarkdown` demotes BlockNote's `\`-hard-break to a
   plain `\n` (`softenInlineHardBreak`) — stable round-trip, backslash-free files.
2. The reading view (`MarkdownContent`) adds the `remark-breaks` plugin so a
   single `\n` renders as `<br>`, matching the editor.
3. Two blank lines (a `\n\n\n` run) remain a durable empty-paragraph separator;
   one blank line is an ordinary paragraph break.

## Options considered

- **Single `\n` = line break + `remark-breaks`** (chosen): tight spacing
  matching Apple Notes/Obsidian, stable BlockNote round-trip, both views agree.
  Cost: files are off strict CommonMark — a pure CommonMark tool would join the
  lines.
- **Standard hard breaks (two spaces / `\`)**: portable CommonMark, but BlockNote
  doubles them on every save — unstable. Rejected.
- **Every line its own paragraph (blank lines)**: fully portable and stable, no
  plugin needed, but inserts a blank-line gap between every line — not the tight
  layout users expect from notes. Rejected.

## Consequences

- The BlockNote editor and the reading view now render newlines identically.
- Imported and edited notes keep tight single-spaced lines and survive repeated
  save/reload without growing gaps or accumulating backslashes.
- Vault files are **not** strict-CommonMark for single newlines: a pure
  CommonMark renderer (e.g. plain GitHub file view, pandoc) will join such lines.
  This matches Obsidian's default, so vault portability to Obsidian is unaffected.
- Re-evaluate if Tolaria ever needs to emit strictly portable CommonMark, or if
  BlockNote fixes its hard-break round-trip so standard hard breaks become usable.
