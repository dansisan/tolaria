---
type: ADR
id: "0137"
title: "Deferred vault-wide wikilink rewrite after rename"
status: active
date: 2026-07-11
---

## Context

Every rename command (`rename_note`, `rename_note_filename`, `move_note_to_folder`, `move_note_to_workspace`, `auto_rename_untitled`) used to move the file and then synchronously scan the vault to rewrite `[[wikilinks]]` in every other note that referenced it, returning only once both steps finished. On the frontend, the path a user's in-flight edits should be persisted to was tracked through a `renamedPathsRef`-style map so a save that started before a rename resolved could still find its way to the right file. Renaming a file is fast; scanning the rest of the vault for backlinks is not, and coupling the two made every rename feel slow and made the save path meaningfully harder to reason about — the store of a real data-loss report traced back to that path-remapping complexity.

Given a single-note editing model (ADR-0003), there is at most one open editor and one path it needs to save to at any moment. There is no legitimate reason for a save to still be resolving against a path from several renames ago, so the map existed only to paper over the rename-that-also-updates-everything-synchronously design, not a genuine requirement.

## Decision

**Rename commands return as soon as the file move itself lands. The vault-wide wikilink rewrite for every other note that referenced the renamed file runs afterward as a background Rust task and reports its own result later via a Tauri event.**

Each backend rename function now returns `(RenameResult, PendingWikilinkRewrite)`. The `RenameResult` a caller gets back immediately always has zeroed `updated_files`/`failed_updates`/`updated_paths`. The Tauri command handler runs `PendingWikilinkRewrite::run()` in a `tokio::task::spawn_blocking`, without awaiting it, and emits `wikilinks-rewrite-completed` (`old_path`, `new_path`, `updated_files`, `failed_updates`, `updated_paths`) once that finishes. On the frontend, `useWikilinkRewriteNotifications` listens for that event, reloads content for any open tab among `updated_paths` (skipping tabs with unsaved edits, since their in-memory content is newer than disk), refreshes just those entries (or falls back to a full vault reload if incremental refresh isn't wired), and surfaces the real updated/failed counts as a toast.

With the rewrite decoupled, the save path no longer needs to track renames across time: `useEditorSave`/`useAppSave` eagerly remap any buffered content old→new the moment a rename resolves and await at most one in-flight rename before persisting, instead of maintaining a map of past renames.

## Options considered

- **Defer the rewrite via a background task + event** (chosen): renames complete as fast as the file move itself; other open notes catch up moments later without the caller waiting. Requires the frontend to reconcile currently-open tabs against a completion event instead of getting the result inline.
- **Keep the rewrite synchronous, just don't await it from the command's return value**: doesn't actually decouple anything meaningful — the frontend still has no result to act on until the caller polls or waits, and the underlying save-path complexity (tracking pending renames) remains.
- **Keep the synchronous rewrite, optimize the scan instead**: would reduce, not eliminate, the latency coupling, and does nothing for the save-path complexity that caused the original data-loss bug.

## Consequences

Renames feel instant regardless of vault size, since the caller never waits on a full-vault backlink scan. The frontend's rename-related save logic is simpler and has one fewer class of bug (stale path resolution through a multi-rename map) — `useAppSave`/`useEditorSave` only ever need to resolve at most one in-flight rename. Other open notes whose backlinks changed show the update a moment after the rename rather than immediately; this is the deliberate trade-off. Any new rename-adjacent command that needs to rewrite content elsewhere in the vault should follow the same `Pending*::run()` + completion-event pattern rather than reintroducing a synchronous, vault-wide side effect inside the command.
