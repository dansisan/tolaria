---
type: ADR
id: "0139"
title: "Frontmatter `modified` field overrides fs/git date resolution"
status: active
date: 2026-07-21
---

## Context

Supersedes [ADR-0039](0039-git-history-for-note-dates.md).

ADR-0039 established batch `git log` history as the source of truth for
`created_at`/`modified_at`, specifically because filesystem `mtime`/`ctime` is
unreliable across `git clone`, `git pull`, and cloud sync. That ADR explicitly
rejected frontmatter dates as an option, reasoning that they "require user
discipline... not automatic... break when users forget to set them."

Since then, `resolve_entry_dates` (`src-tauri/src/vault/mod.rs`) drifted from
that decision: it now computes `modified_at` as
`max(fs_mtime, git_modified)` rather than pure git history — a change made to
catch unsaved edits not yet committed to git. This reintroduced exactly the
fs-mtime unreliability ADR-0039 warned against: `git clone` (used by
`clone_repo`, `src-tauri/src/git/clone.rs`, when connecting a vault on a
new/second device) resets every tracked file's mtime to the clone time, since
git does not preserve original mtimes on checkout. On the first full scan
after such a clone, `max(fs_mtime, git_modified)` picks the inflated
clone-time mtime for every note not edited since, and that value is baked
permanently into the vault cache.

This produced a concrete user-facing bug: the note list's relative "time
since modified" label plateaus at roughly "1 month ago" (the approximate
last-clone/connect date) for notes that are actually years old, while notes
edited after the clone show correctly.

## Decision

**Add a `modified` frontmatter field as the highest-priority source for
`modified_at`, and have the app maintain it automatically on every save so it
never requires user discipline.**

- `extract_fm_and_rels` (`src-tauri/src/vault/frontmatter.rs`) reads a
  hardcoded `"modified"` key (not a configurable setting, unlike the existing
  `frontmatter_created_key`) via the existing `parse_fm_date_secs` helper.
- `parse_md_file` (`src-tauri/src/vault/mod.rs`) applies it as an outright
  override: `let modified_at = fm_modified_at.or(modified_at);`, layered on
  top of the existing `max(fs_mtime, git_modified)` result from
  `resolve_entry_dates`.
- `stamp_modified_date` (`src-tauri/src/frontmatter/mod.rs`) now
  unconditionally writes this key on every save — including adding a
  frontmatter block to a plain note that had none — rather than only
  refreshing it if already present. This directly answers ADR-0039's original
  objection: the field is maintained by the app, not by the user.

Resulting resolution order: **frontmatter `modified` (if present and
parseable) → `max(fs_mtime, git_modified)` → filesystem-only (non-git
vaults).** `created_at` resolution is unchanged: frontmatter
`frontmatter_created_key` → git → filesystem.

### Timezone pitfall found while shipping this

`parse_date_str_secs` (`src-tauri/src/vault/frontmatter.rs`) reads the naive
`"YYYY-MM-DD HH:MM:SS"` frontmatter format with no offset marker, so any
writer of this format must agree with the reader on what timezone those
components represent. Two writers initially disagreed (both used the
machine's local time while the reader assumed UTC), causing
`modified_at`/`created_at` to silently shift by the machine's UTC offset
every time a value was written and later re-read — e.g. a note saved "just
now" would read back several hours old.

As a stepping-stone fix, both writers (`stamp_modified_date`'s
`DeriveContext` in `save_note_content`, and `buildNoteContent` in
`src/hooks/useNoteCreation.ts`) were changed to write real UTC, matching the
reader's `.and_utc()` assumption. **This stepping-stone was superseded by
[ADR-0140](0140-ambient-local-timezone-for-frontmatter-dates.md)**: the user
didn't want UTC in their notes' frontmatter at all, and a follow-up attempt
at a configurable per-machine timezone setting was also discarded as
unnecessary complexity — the reader and both writers now simply use the
machine's ambient local timezone (`chrono::Local` / local `Date` getters),
with no stored setting. See ADR-0140 for the current design and why the
configurable-setting approach was rejected; this section is kept for history.

## Options considered

- **Revert to pure git history for `modified_at`** (undo the `max(fs, git)`
  change from commit `2772064b`): would fix the clone-mtime-reset bug, but
  reintroduces the original problem that change solved — unsaved, uncommitted
  edits would show a stale "last commit" date instead of "just now."
- **Only prefer fs mtime when the file is actually dirty/uncommitted** (check
  git status per file): more surgical, but adds a git-status check to every
  scan and doesn't help vaults where git integration is disabled.
- **Frontmatter `modified`, app-maintained, as an override** (chosen): reuses
  the same pattern already proven for `created_at`
  (`fm_created_at.or(fs_or_git_created)`), is immune to any future fs-mtime
  disturbance (clone, checkout, cloud sync, backup restore) once a note has
  been saved once, and — critically — the app writes the field itself on
  every save, so it doesn't depend on the user remembering to add it.

## Consequences

- Every note saved after this ships becomes self-describing: its `modified`
  frontmatter value is authoritative from then on, regardless of what happens
  to the file's mtime or git history afterward.
- **Not retroactive.** A note that is never saved again after this ships has
  no `modified` frontmatter key, so it keeps falling back to
  `max(fs_mtime, git_modified)` — the plateau bug persists indefinitely for
  notes nobody touches. A one-time bulk backfill was considered and rejected:
  `apply_content_frontmatter` (`src-tauri/src/frontmatter/derive.rs`) already
  documents a "never bulk-touch `modified`" policy, because a migration
  writing a `modified` value would falsely claim a note was edited when it
  wasn't. This fix is deliberately self-healing over time rather than
  instantaneous.
- Notes imported from other tools that already declare their own `modified`
  frontmatter value (in a compatible date format) are now respected as-is,
  which is desirable for portability but means a malformed or intentionally
  backdated value is taken at face value rather than cross-checked against
  fs/git — `parse_fm_date_secs` returning `None` for unparseable values is the
  only guard, falling back to `max(fs, git)`.
- If a future change needs the "unsaved edit shows as recent" behavior to
  also apply before any save has happened — e.g. external edits to a file
  outside the app that already has a `modified` key — the frontmatter value
  would currently win and mask that external edit. Re-evaluate if that
  becomes a reported issue.
