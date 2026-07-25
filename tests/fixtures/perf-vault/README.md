# perf-vault — persistent big-note fixtures

Kept in the repo (not cleaned up) for reproducing large-note problems:
switch lag, content bleeding between notes, autosave races.

- Tests must COPY this directory (see `createPerfVaultCopy`) — never edit in place.
- For manual QA, open this folder as a vault; `git checkout -- tests/fixtures/perf-vault`
  restores it afterwards.
- Regenerate or scale with `node scripts/make-perf-vault.mjs [--size-kb N]`.
- `dense-lines.md` is the worst case for document install: ~9k short single-spaced
  lines, so cost tracks line (hardBreak) count rather than bytes.

Each note carries `UNIQUE-MARKER: <NAME>` plus per-paragraph prefixes so any
cross-note content bleeding is detectable by grep.
