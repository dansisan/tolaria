---
type: ADR
id: "0140"
title: "Ambient local timezone for frontmatter dates (no stored setting)"
status: active
date: 2026-07-21
---

## Context

[ADR-0139](0139-frontmatter-modified-overrides-fs-git-date-resolution.md)
made a `modified` frontmatter field the highest-priority source for
`modified_at`, and made the app stamp it automatically on every save. Shipping
that change required both writers (`stamp_modified_date`'s `DeriveContext` in
`src-tauri/src/commands/vault/file_cmds.rs`, and the frontend's
`buildNoteContent` in `src/hooks/useNoteCreation.ts`) to agree with the
reader (`parse_date_str_secs`, `src-tauri/src/vault/frontmatter.rs`) on how
the naive `"YYYY-MM-DD HH:MM:SS"` frontmatter format is interpreted.

Two approaches were tried and discarded before landing here:

1. **Write UTC, read UTC** (`.and_utc()` / `chrono::Utc::now()` /
   `formatUtcISODatetime`): internally consistent and simplest to implement,
   but rejected on product grounds — the user doesn't want to open a note
   and see a UTC timestamp in `modified`/`created`, they want to see their
   own wall-clock time.
2. **Configurable IANA timezone setting** (defaulting to `America/New_York`,
   using a new `chrono-tz` dependency): let the user pick their zone in
   Settings. This was implemented, then reconsidered: the setting lives in
   each machine's local `settings.json`, not synced with the vault, so it
   doesn't actually solve multi-machine consistency any better than ambient
   local time does automatically when the machines are in the same real
   timezone (the common case) — it just adds a dependency, a settings field,
   and UI for no real benefit in that case.

## Decision

**Use the machine's ambient local timezone (`chrono::Local` in Rust,
local `Date` getters in JS) to both write and read naive frontmatter
timestamps. No stored setting, no new dependency.**

- `parse_date_str_secs` (`src-tauri/src/vault/frontmatter.rs`) resolves a
  naive datetime via `chrono::Local.from_local_datetime(&naive)` instead of
  `.and_utc()`.
- `stamp_modified_date`'s `DeriveContext` (`save_note_content`,
  `src-tauri/src/commands/vault/file_cmds.rs`) writes
  `chrono::Local::now()`.
- `buildNoteContent` (`src/hooks/useNoteCreation.ts`) writes via
  `formatLocalISODatetime` (`src/utils/dateDisplay.ts`), which uses the
  browser/webview's local `Date` getters — already correct for its other use
  (the human-editable date field in `CreateNoteForDateDialog`), now reused
  for frontmatter writing too.
- `chrono::Local` still handles DST correctly (it resolves through the OS's
  timezone database), so this is not a regression to the fixed-offset
  problem that motivated ADR-0139 in the first place — it's specifically the
  *reader/writer agreement* that was broken before, not DST awareness.

### DST edge cases

`chrono::Local.from_local_datetime(&naive)` returns a `LocalResult`, handled
the same way as it would be for any `TimeZone` implementation:
- **Single** — normal case, used as-is.
- **Ambiguous** (a fall-back transition repeats an hour) — the earlier
  occurrence is used, the common convention.
- **None** (a spring-forward transition skips an hour) — treated as
  unparseable, same as a malformed string; falls back to filesystem/git date
  resolution. Affects at most one hour per year.

Note: these Ambiguous/None branches can't be deterministically unit-tested
across arbitrary environments without injecting a specific zone (a fixed
`chrono::Local` ambient zone means the test's DST behavior depends on
whatever timezone actually runs it) — see `modified_dates_tests.rs`'s
`frontmatter_modified_round_trips_through_ambient_local_timezone` for the
portable round-trip test that replaced the season-specific hardcoded-offset
tests written during the discarded configurable-timezone attempt.

## Consequences

- Every currently-computed `modified_at`/`created_at` value depends on
  whatever the machine's local timezone is at write time *and* at read time.
  If the same vault is used from machines in genuinely different real
  timezones (or the OS timezone changes, e.g. traveling), a note's frontmatter
  can be transiently misinterpreted until it's next saved — the same
  non-retroactive, self-healing trade-off already accepted in ADR-0139, just
  triggered by a different kind of drift (machine/location change instead of
  app version change).
- No new dependency, no settings UI, no i18n strings — this stays a
  contained bug fix rather than a new configuration surface, consistent with
  how `frontmatter_created_key`'s key name is configurable but "which
  timezone" was deliberately kept simple.
- If a real need for multi-timezone consistency emerges later (e.g. a team
  vault synced across genuinely different timezones), revisit with an
  explicit, vault-level (not per-machine-settings) canonical timezone — this
  ADR's rejection of a per-machine setting doesn't apply to a vault-synced one.
