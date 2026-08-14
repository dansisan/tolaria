use super::{parse_md_file, parse_non_md_file};
use std::fs;
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

// A note carries its own dates. Frontmatter first, filesystem second, and git
// history never — see `parse_md_file`.

#[test]
fn parse_md_file_uses_filesystem_dates_when_frontmatter_has_none() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("note.md");
    fs::write(&path, "# Note\n\nBody\n").unwrap();

    let (fs_modified, fs_created, _) = super::file::read_file_metadata(&path).unwrap();

    let entry = parse_md_file(&path, "created").unwrap();

    assert_eq!(entry.modified_at, fs_modified);
    assert_eq!(entry.created_at, fs_created);
}

// Regression test for the reason git dates were removed: a note imported from
// another tool routinely predates the repository, and the commit that first
// touched it says nothing about when it was written. Committing with an author
// date far in the past must not move the note's dates.
#[test]
fn parse_md_file_ignores_git_history_entirely() {
    let dir = TempDir::new().unwrap();
    let vault = dir.path();
    let path = vault.join("committed.md");
    fs::write(&path, "# Committed\n\nBody\n").unwrap();

    for args in [
        ["init", "--initial-branch=main"].as_slice(),
        ["config", "user.email", "test@test.com"].as_slice(),
        ["config", "user.name", "Test User"].as_slice(),
        ["add", "."].as_slice(),
    ] {
        crate::git::git_command()
            .args(args)
            .current_dir(vault)
            .output()
            .unwrap();
    }
    crate::git::git_command()
        .args(["commit", "-m", "old"])
        .env("GIT_AUTHOR_DATE", "2001-01-01T00:00:00+00:00")
        .env("GIT_COMMITTER_DATE", "2001-01-01T00:00:00+00:00")
        .current_dir(vault)
        .output()
        .unwrap();

    let (fs_modified, fs_created, _) = super::file::read_file_metadata(&path).unwrap();

    let entry = parse_md_file(&path, "created").unwrap();

    assert_eq!(entry.modified_at, fs_modified);
    assert_eq!(entry.created_at, fs_created);
    // 2001-01-01 is 978307200; the filesystem dates are from this test run.
    assert!(entry.created_at.unwrap() > 978_307_200);
}

// A `modified` frontmatter value — kept current by `stamp_modified_date` on
// save — must win outright. A clone or a sync resets every file's mtime, so the
// filesystem is the weaker source.
#[test]
fn parse_md_file_prioritizes_frontmatter_modified_over_the_filesystem() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("note.md");
    fs::write(
        &path,
        "---\nmodified: 2020-06-15 12:00:00\n---\n# Note\n\nBody\n",
    )
    .unwrap();

    let (fs_modified, _, _) = super::file::read_file_metadata(&path).unwrap();
    let fs_modified = fs_modified.unwrap();

    let entry = parse_md_file(&path, "created").unwrap();

    // Interpreted in the machine's ambient local timezone, same as the parser.
    let expected_fm_modified =
        chrono::NaiveDateTime::parse_from_str("2020-06-15 12:00:00", "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_local_timezone(chrono::Local)
            .single()
            .unwrap()
            .timestamp() as u64;

    assert_eq!(entry.modified_at, Some(expected_fm_modified));
    assert_ne!(entry.modified_at, Some(fs_modified));
}

// An unparseable `modified` frontmatter value must not poison resolution — fall
// back to the filesystem gracefully.
#[test]
fn parse_md_file_falls_back_when_frontmatter_modified_is_unparseable() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("note.md");
    fs::write(&path, "---\nmodified: not-a-date\n---\n# Note\n\nBody\n").unwrap();

    let (fs_modified, _, _) = super::file::read_file_metadata(&path).unwrap();

    let entry = parse_md_file(&path, "created").unwrap();

    assert_eq!(entry.modified_at, fs_modified);
}

#[test]
fn parse_non_md_file_uses_filesystem_dates() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("assets/data.txt");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "hello").unwrap();

    let (fs_modified, fs_created, _) = super::file::read_file_metadata(&path).unwrap();

    let entry = parse_non_md_file(&path).unwrap();

    assert_eq!(entry.modified_at, fs_modified);
    assert_eq!(entry.created_at, fs_created);
}

#[test]
fn scan_vault_sorts_by_filesystem_modified_time() {
    let dir = TempDir::new().unwrap();

    fs::write(dir.path().join("written-first.md"), "# First\n\nBody\n").unwrap();
    thread::sleep(Duration::from_secs(1));
    fs::write(dir.path().join("written-second.md"), "# Second\n\nBody\n").unwrap();

    let entries = super::scan_vault(dir.path(), "created").unwrap();
    let titles: Vec<_> = entries.iter().map(|entry| entry.title.as_str()).collect();

    assert_eq!(titles, vec!["written-second", "written-first"]);
}

fn write_note_with_modified(dir: &TempDir, modified: &str) -> std::path::PathBuf {
    let path = dir.path().join("note.md");
    fs::write(
        &path,
        format!("---\nmodified: {modified}\n---\n# Note\n\nBody\n"),
    )
    .unwrap();
    path
}

// Round-trip test for the writer/reader timezone contract: a naive
// "YYYY-MM-DD HH:MM:SS" frontmatter value is interpreted in the machine's
// ambient local timezone (`chrono::Local`), the same zone
// `stamp_modified_date` writes in — so formatting "now" and parsing it back
// must reproduce the same instant, regardless of what timezone (or DST
// state) the machine running this test happens to be in.
#[test]
fn frontmatter_modified_round_trips_through_ambient_local_timezone() {
    let dir = TempDir::new().unwrap();
    let now = chrono::Local::now();
    let naive = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let path = write_note_with_modified(&dir, &naive);

    let entry = parse_md_file(&path, "created").unwrap();

    assert_eq!(entry.modified_at, Some(now.timestamp() as u64));
}
