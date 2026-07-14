---
type: ADR
id: "0138"
title: "Filename is the title for Notes; Types keep H1/frontmatter title"
status: active
date: 2026-07-14
supersedes: "0068"
---

## Context

Supersedes [ADR-0068](0068-h1-only-title-surface-with-optional-untitled-auto-rename.md).

ADR-0044 (and 0055/0068 after it) made the first `# H1` heading the canonical title for every note, with frontmatter `title:` as a legacy fallback and an optional auto-rename-on-save step that renamed `untitled-*` files to match the H1 once one appeared.

In practice this model doesn't match how notes actually get used day to day: nobody writes an H1 or a frontmatter `title:`, and the filename is already treated as the title, the way it works in most plain-text note tools. Carrying the H1/frontmatter-title machinery forward for that common case bought nothing but risk — it was the direct cause of a real bug this session: a stale frontmatter title (or H1) could keep shadowing a note's actual filename in the breadcrumb forever after a rename, because a plain filename rename intentionally leaves file content untouched. Fixing that bug required syncing content across two layers (Rust + TS) that never needed to diverge from the filename in the first place.

Structured Type instances (a `Person`, `Project`, or other `type:`-tagged record) are a different case: they're often closer to structured data than free-form prose and may have no natural H1 to derive a name from, so a frontmatter `title:` can legitimately be their only real "name," independent of a filesystem-safe filename. That distinction is out of scope for this decision and is unaffected by it.

## Decision

**For entries with no `type:`/`Is A:` frontmatter, or an explicit `type: Note`, the filename is the only title source — H1 and frontmatter `title:` are never read as a title, never stamped into new note content, and never drive an auto-rename. Retitling one of these notes means renaming the file, full stop. Structured Type instances are unaffected: they keep the existing H1 → frontmatter title → filename priority chain from ADR-0044.**

The gate is `is_a.is_none() || is_a.as_deref() == Some("Note")` in Rust (`is_default_note_type` in `src-tauri/src/vault/mod.rs`) and the frontend equivalent `isDefaultNoteType` in `src/utils/noteTitle.ts`, applied consistently wherever title was previously derived (vault scan, search results, the breadcrumb's display-title chip, save-time metadata patching, and note creation's frontmatter stamping).

Removed entirely as part of this decision (all Note-only concepts with no Type-instance use):
- The `initial_h1_auto_rename_enabled` setting and its Settings UI switch.
- The untitled-H1-auto-rename machinery (`auto_rename_untitled` Tauri command, the frontend debounce/scheduling coordinator in `useAppSave.ts`).
- The `rename_note` (title-based rename) Tauri command and its supporting code (`RenameNoteRequest`, `title_to_slug`, collision-suffix rename path in the rename-transaction workspace). `rename_note_filename` is now the only rename operation notes go through.
- The dead `sync_note_title` command and `title_sync.rs` module (confirmed unused by any real caller before removal — a leftover from the ADR-0007 era).
- The H1 "title bar" visual CSS treatment in the editor (extra margin, border, and a "Title" placeholder override). H1 is now a plain heading like H2–H6.

Frontmatter-title-driven rename-on-edit (editing a note's `title` property in the Inspector used to rename the file to match) is now gated the same way: it fires only for Type instances, using `rename_note_filename` with a client-slugified stem instead of the removed `rename_note` command.

## Options considered

- **Option A** (chosen): Filename-only title for Notes, gated by type, Types unchanged. Matches actual usage, removes a whole class of title/filename desync bugs and the machinery that caused them. Downside: any pre-existing vault content with a meaningful H1/frontmatter title on a `type: Note` file will have that content ignored as a title going forward (the text itself is untouched, just no longer read as a title) — acceptable since this vault has none.
- **Option B**: Keep H1/frontmatter title for all types, just fix the specific rename-sync bug from this session. Lower short-term effort, but leaves the entire priority chain, auto-rename debounce/scheduling machinery, and the underlying bug class in place for the common case.
- **Option C**: Remove title as a concept everywhere, including Type instances. Simpler still, but breaks structured Type instances that rely on a frontmatter title as their only real name when they have no natural H1/free-form body — explicitly out of scope for this decision.

## Consequences

- Wikilink resolution by title/humanized-title (`findEntryByTitle`/`findEntryByHumanizedTitle` in `src/utils/wikilink.ts`, `collect_legacy_wikilink_targets` in `src-tauri/src/vault/rename.rs`) is left in place unchanged — it's a no-op for Notes now that title always equals filename, and still does real work for Type instances whose title diverges from their filename.
- The breadcrumb's separate "display title" chip (`deriveBreadcrumbDisplayTitle` in `BreadcrumbBar.tsx`) never renders for Notes; it still renders for Type instances with a stored title/H1 that diverges from their filename.
- AI-agent system prompts (`src/utils/ai-agent.ts`) and the seeded per-vault `AGENTS.md`/site docs were updated to describe the new model: rename the file to retitle a note, no H1/`title:` needed.
- A future `displayName`-style dedicated field for Type instances (separating "record name" from the generic frontmatter `title:` key) is a candidate follow-up but is a separate decision, not part of this one.
- Re-evaluation trigger: if structured Type instances turn out to need filename-is-title behavior too, or if free-form notes need an explicit divergent display name after all.
