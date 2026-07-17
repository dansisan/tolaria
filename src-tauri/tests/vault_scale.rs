use std::fs;
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tolaria_lib::vault::{self, RenameNoteFilenameRequest};

/// Notes in the synthetic vault, tuned to be large enough to catch an
/// accidental return to an O(vault size) synchronous path, while still
/// generating and scanning in well under a second on CI hardware.
const LARGE_VAULT_NOTE_COUNT: usize = 3_000;

/// Every 10th filler note links to `note/target`, so a rename's background
/// rewrite has realistic, deterministic work to do.
const LINKING_NOTE_STRIDE: usize = 10;

/// Builds a vault with `note_count` small notes plus one `note/target.md`
/// that some of them link to via a path-based wikilink.
fn build_large_vault(note_count: usize) -> TempDir {
    let dir = TempDir::new().unwrap();
    let notes_dir = dir.path().join("note");
    fs::create_dir_all(&notes_dir).unwrap();
    fs::write(
        notes_dir.join("target.md"),
        "---\ntype: Note\n---\n\nThe note that gets renamed.\n",
    )
    .unwrap();

    for i in 0..note_count {
        let body = if i % LINKING_NOTE_STRIDE == 0 {
            "Links to [[note/target]] for context.\n".to_string()
        } else {
            format!("Filler content for note {i}.\n")
        };
        fs::write(
            notes_dir.join(format!("note-{i:05}.md")),
            format!("---\ntype: Note\n---\n\n{body}"),
        )
        .unwrap();
    }

    dir
}

#[test]
fn scan_vault_cached_stays_fast_at_thousands_of_notes() {
    let vault = build_large_vault(LARGE_VAULT_NOTE_COUNT);

    let start = Instant::now();
    let entries = vault::scan_vault_cached(vault.path()).unwrap();
    let elapsed = start.elapsed();

    assert_eq!(entries.len(), LARGE_VAULT_NOTE_COUNT + 1); // + target.md
    // Generous ceiling: this isn't meant to catch minor regressions, only a
    // return to an algorithm whose cost is wildly worse than linear.
    assert!(
        elapsed < Duration::from_secs(5),
        "scan_vault_cached took {elapsed:?} for {LARGE_VAULT_NOTE_COUNT} notes, expected < 5s"
    );
}

#[test]
fn rename_note_filename_stays_fast_regardless_of_vault_size() {
    let vault = build_large_vault(LARGE_VAULT_NOTE_COUNT);
    let old_path = vault.path().join("note/target.md");

    let start = Instant::now();
    let (result, pending) = vault::rename_note_filename(RenameNoteFilenameRequest {
        vault_path: vault.path().to_str().unwrap(),
        old_path: old_path.to_str().unwrap(),
        new_filename_stem: "renamed-target",
    })
    .unwrap();
    let rename_elapsed = start.elapsed();

    // The synchronous rename must never scale with vault size — the
    // wikilink-narrowing scan is deferred to PendingWikilinkRewrite::run
    // (see ADR-0137 and the fix in commit 256c7214). If this ever regresses
    // back to scanning the vault before returning, this bound catches it.
    assert!(
        rename_elapsed < Duration::from_millis(500),
        "rename_note_filename took {rename_elapsed:?} for a {LARGE_VAULT_NOTE_COUNT}-note vault, expected < 500ms"
    );
    // The rewrite hasn't run yet at this point — confirms the count above
    // measures only the rename, not the (separately-timed) background work.
    assert_eq!(result.updated_files, 0);

    let expected_linking_notes = LARGE_VAULT_NOTE_COUNT.div_ceil(LINKING_NOTE_STRIDE);
    let completed = pending.run();
    assert_eq!(completed.updated_files, expected_linking_notes);
}
