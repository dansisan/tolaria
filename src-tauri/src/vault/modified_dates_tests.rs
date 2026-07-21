use super::{parse_md_file, parse_non_md_file, resolve_entry_dates};
use crate::git::GitDates;
use std::collections::HashMap;
use std::fs;
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

#[test]
fn resolve_entry_dates_prefers_newer_filesystem_modified_time() {
    let resolved = resolve_entry_dates(Some(200), Some(50), Some((150, 25)));

    assert_eq!(resolved, (Some(200), Some(25)));
}

#[test]
fn resolve_entry_dates_keeps_newer_git_modified_time() {
    let resolved = resolve_entry_dates(Some(150), Some(50), Some((200, 25)));

    assert_eq!(resolved, (Some(200), Some(25)));
}

// No `modified` frontmatter key present, so this also covers the fallback
// case: resolution behaves exactly as it did before frontmatter priority
// was added.
#[test]
fn parse_md_file_uses_newer_filesystem_modified_time_than_git() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("note.md");
    fs::write(&path, "# Note\n\nBody\n").unwrap();

    let (fs_modified, _, _) = super::file::read_file_metadata(&path).unwrap();
    let fs_modified = fs_modified.unwrap();
    let git_created = fs_modified.saturating_sub(600);
    let git_modified = fs_modified.saturating_sub(60);

    let entry = parse_md_file(&path, Some((git_modified, git_created)), "created").unwrap();

    assert_eq!(entry.modified_at, Some(fs_modified));
    assert_eq!(entry.created_at, Some(git_created));
}

// Regression test: a git clone/checkout resets every tracked file's fs mtime
// to the clone time, so `max(fs_mtime, git_modified)` can wildly overstate
// how recently a note was actually edited. A `modified` frontmatter value —
// kept current by `stamp_modified_date` on save — must win outright.
#[test]
fn parse_md_file_prioritizes_frontmatter_modified_over_fs_and_git() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("note.md");
    fs::write(
        &path,
        "---\nmodified: 2020-06-15 12:00:00\n---\n# Note\n\nBody\n",
    )
    .unwrap();

    let (fs_modified, _, _) = super::file::read_file_metadata(&path).unwrap();
    let fs_modified = fs_modified.unwrap();
    let git_created = fs_modified.saturating_sub(600);
    let git_modified = fs_modified.saturating_sub(60);

    let entry = parse_md_file(&path, Some((git_modified, git_created)), "created").unwrap();

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

// An unparseable `modified` frontmatter value must not poison resolution —
// fall back to the existing max(fs, git) behavior gracefully.
#[test]
fn parse_md_file_falls_back_when_frontmatter_modified_is_unparseable() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("note.md");
    fs::write(&path, "---\nmodified: not-a-date\n---\n# Note\n\nBody\n").unwrap();

    let (fs_modified, _, _) = super::file::read_file_metadata(&path).unwrap();
    let fs_modified = fs_modified.unwrap();
    let git_created = fs_modified.saturating_sub(600);
    let git_modified = fs_modified.saturating_sub(60);

    let entry = parse_md_file(&path, Some((git_modified, git_created)), "created").unwrap();

    assert_eq!(entry.modified_at, Some(fs_modified));
}

#[test]
fn parse_non_md_file_falls_back_to_git_modified_when_filesystem_missing_newer_date() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("assets/data.txt");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "hello").unwrap();

    let (fs_modified, _, _) = super::file::read_file_metadata(&path).unwrap();
    let git_modified = fs_modified.unwrap().saturating_add(60);
    let git_created = git_modified.saturating_sub(600);

    let entry = parse_non_md_file(&path, Some((git_modified, git_created))).unwrap();

    assert_eq!(entry.modified_at, Some(git_modified));
    assert_eq!(entry.created_at, Some(git_created));
}

#[test]
fn scan_vault_sorts_by_newer_of_git_and_filesystem_modified_time() {
    let dir = TempDir::new().unwrap();
    let older_path = dir.path().join("older-git-newer-file.md");
    let newer_git_path = dir.path().join("newer-git-older-file.md");

    fs::write(&newer_git_path, "# Newer Git\n\nBody\n").unwrap();
    thread::sleep(Duration::from_secs(1));
    fs::write(&older_path, "# Newer File\n\nBody\n").unwrap();

    let (older_file_modified, _, _) = super::file::read_file_metadata(&older_path).unwrap();
    let older_file_modified = older_file_modified.unwrap();

    let git_dates = HashMap::from([
        (
            "older-git-newer-file.md".to_string(),
            GitDates {
                created_at: older_file_modified.saturating_sub(600),
                modified_at: older_file_modified.saturating_sub(120),
            },
        ),
        (
            "newer-git-older-file.md".to_string(),
            GitDates {
                created_at: older_file_modified.saturating_sub(700),
                modified_at: older_file_modified.saturating_sub(30),
            },
        ),
    ]);

    let entries = super::scan_vault(dir.path(), &git_dates, "created").unwrap();
    let titles: Vec<_> = entries.iter().map(|entry| entry.title.as_str()).collect();

    assert_eq!(titles, vec!["older-git-newer-file", "newer-git-older-file"]);
}

fn write_note_with_modified(dir: &TempDir, modified: &str) -> std::path::PathBuf {
    let path = dir.path().join("note.md");
    fs::write(&path, format!("---\nmodified: {modified}\n---\n# Note\n\nBody\n")).unwrap();
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

    let entry = parse_md_file(&path, None, "created").unwrap();

    assert_eq!(entry.modified_at, Some(now.timestamp() as u64));
}
