---
type: ADR
id: "0141"
title: "libgit2 (git2) for read-only git operations"
status: active
date: 2026-08-13
---

## Context

Every git operation in `src-tauri/src/git/` spawned the system `git` binary and parsed
its stdout/stderr. That cost more than the process spawns:

- **Localized output broke error classification.** Failures were classified by matching
  English phrases — `"authentication failed"`, `"fetch first"`, `"does not have any commits yet"`,
  `"cannot run gpg"` — against git's output. git translates its messages through gettext,
  and no code path pinned the locale, so on a machine with a localized git every one of
  those checks silently stopped matching. The wording also drifts across versions:
  `remote.rs` matched both `"Already up to date"` and `"Already up-to-date"` because git
  reworded it in 2.16.
- **Output format was a second fragile contract.** Porcelain v1, `--numstat -z`, and
  `--name-status` were parsed by hand. `core.quotePath=false` had to be injected globally
  so Unicode filenames survived, and `-z` was used inconsistently across call sites.
- **Launching git at all needed ~150 lines of support code.** `git/mod.rs` probes the
  user's login shell on macOS to recover a usable `PATH`, scrubs AppImage loader
  variables on Linux, and rebuilds `PATH` so git can find its own helpers.
- **Structured data was reconstructed from text.** Commit messages containing `|` broke
  the pulse feed's `%H|%h|%s|%aI` split, silently zeroing the commit date.

## Decision

**Read-only git operations use libgit2 in-process via the `git2` crate. Writes stay on the
`git` CLI.** A shared `git/repo.rs` module owns the libgit2 primitives (open, HEAD commit,
HEAD-first revwalk, per-commit changed files, `%h`-equivalent short hashes).

Ported to libgit2: vault pulse, last-commit info, file history, file diffs (working tree,
staged, and at a commit), modified-file status with line stats, per-file git dates, and
single-file status lookup.

Still on the CLI: commit, pull, push, clone, remote connect/disconnect, conflict
resolution, and discard. Those depend on behavior libgit2 does not provide — commit
signing, repository hooks, credential helpers, and automatic `gc`.

`git2` is declared with `default-features = false`: no SSH, no HTTPS, no OpenSSL. Read
operations are local, so the vendored libgit2 build stays small and needs no TLS stack.

Because CLI paths remain, `git_command()` now also pins `LC_ALL=C` and clears `LANGUAGE`,
so the phrase matching that still exists is no longer at the mercy of the user's locale.

## Options Considered

- **libgit2 for reads, CLI for writes** (chosen): removes the parsing and locale coupling
  from the paths that poll constantly, while leaving signing, hooks, credential helpers,
  and `gc` with the tool that implements them. One dependency, no behavior cliff.
- **Move everything to libgit2**: a single implementation and no `git` prerequisite at all,
  but it silently drops commit signing and hooks for users who configured them, stops
  packing loose objects in vaults that auto-commit frequently, and rewrites the highest-risk
  write paths in one step.
- **Keep shelling out and only pin the locale**: a two-line fix for the worst bug, but
  leaves porcelain/numstat parsing, the login-shell probe, and the `|`-in-message class of
  bug in place.
- **gitoxide (`gix`)**: pure Rust with no C toolchain and excellent performance, but push
  support has lagged, so the write path would still need a second implementation.

## Consequences

- Read paths no longer spawn a process or re-read git config per call, which matters for
  the status and pulse polling driven by the autogit timers.
- Rename reporting, Unicode paths, and pagination are now exercised by behavior tests
  against real repositories instead of by parser unit tests against captured CLI text.
- Two ordering and formatting differences had to be handled explicitly: libgit2's `TIME`
  revwalk sort leaves same-second commits in arbitrary order (fixed by pairing it with
  `TOPOLOGICAL`), and libgit2 escapes non-ASCII bytes in patch headers the way
  `core.quotePath=true` does (undone when rendering patches).
- The build now compiles vendored libgit2 C sources, adding to cold build time and binary
  size.
- Reads and writes can now disagree in principle, since they run through different
  implementations. The read surface is covered by tests that use real repositories, which
  is what keeps them honest.
- This is a prerequisite for any future mobile target, where subprocesses are unavailable —
  see [ADR-0005](0005-tauri-ios-for-ipad.md). It does not by itself make the write path
  portable.
