use super::*;
use std::path::Path;

fn entry_filenames(entries: &[VaultEntry]) -> Vec<&str> {
    entries
        .iter()
        .map(|entry| entry.filename.as_str())
        .collect()
}

fn assert_filenames_include(entries: &[VaultEntry], expected: &[&str]) {
    let filenames = entry_filenames(entries);
    for filename in expected {
        assert!(filenames.contains(filename), "missing {filename}");
    }
}

#[test]
fn test_scan_vault_root_and_protected_folders() {
    let dir = TempDir::new().unwrap();
    create_test_file(dir.path(), "root.md", "# Root Note\n");
    create_test_file(
        dir.path(),
        "project.md",
        "---\ntype: Type\n---\n# Project\n",
    );
    create_test_file(dir.path(), "attachments/notes.md", "# Attachment note\n");
    create_test_file(
        dir.path(),
        "not-markdown.txt",
        "This should be included as text",
    );

    let entries = scan_vault(dir.path(), "created").unwrap();
    assert_eq!(entries.len(), 4);
    assert_filenames_include(
        &entries,
        &["root.md", "project.md", "notes.md", "not-markdown.txt"],
    );

    let txt_entry = entries
        .iter()
        .find(|entry| entry.filename == "not-markdown.txt")
        .unwrap();
    assert_eq!(txt_entry.file_kind, "text");
    assert_eq!(txt_entry.title, "not-markdown.txt");
}

#[test]
fn test_scan_vault_includes_subdirectory_notes() {
    let dir = TempDir::new().unwrap();
    create_test_file(dir.path(), "root.md", "# Root Note\n");
    create_test_file(
        dir.path(),
        "random-folder/nested.md",
        "---\ntype: Note\n---\n# Nested\n",
    );
    create_test_file(
        dir.path(),
        "project/old-project.md",
        "---\ntype: Project\n---\n# Old\n",
    );

    let entries = scan_vault(dir.path(), "created").unwrap();
    assert_eq!(
        entries.len(),
        3,
        "all .md files including subdirs should be scanned"
    );
    assert_filenames_include(&entries, &["root.md", "nested.md", "old-project.md"]);
}

#[test]
fn test_scan_vault_includes_all_protected_folders() {
    let dir = TempDir::new().unwrap();
    create_test_file(dir.path(), "root.md", "# Root\n");
    create_test_file(dir.path(), "attachments/notes.md", "# Attachment note\n");
    create_test_file(dir.path(), "assets/image.md", "# Asset\n");

    let entries = scan_vault(dir.path(), "created").unwrap();
    assert_eq!(entries.len(), 3);
}

#[test]
fn test_scan_vault_skips_hidden_folders() {
    let dir = TempDir::new().unwrap();
    create_test_file(dir.path(), "root.md", "# Root\n");
    create_test_file(dir.path(), ".laputa/cache.md", "# Cache\n");
    create_test_file(dir.path(), ".git/objects.md", "# Git\n");

    let entries = scan_vault(dir.path(), "created").unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].filename, "root.md");
}

#[test]
fn test_scan_vault_nonexistent_path() {
    let result = scan_vault(
        Path::new("/nonexistent/path/that/does/not/exist"),
        "created",
    );
    assert!(result.is_err());
}

#[test]
fn test_get_note_content() {
    let dir = TempDir::new().unwrap();
    let content = "---\nIs A: Note\n---\n# Test Note\n\nHello, world!";
    create_test_file(dir.path(), "test.md", content);

    let path = dir.path().join("test.md");
    let result = get_note_content(&path);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), content);
}

#[test]
fn test_get_note_content_nonexistent() {
    let result = get_note_content(Path::new("/nonexistent/path/file.md"));
    assert!(result.is_err());
}

#[test]
fn test_get_note_content_invalid_utf8() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("invalid.csv");
    std::fs::write(&path, [0x66, 0x6f, 0x80]).unwrap();

    let result = get_note_content(&path);

    assert_eq!(
        result.unwrap_err(),
        format!("File is not valid UTF-8 text: {}", path.display())
    );
}

/// A file created outside the app is folded into the entry list one entry at a
/// time. `scan_entry` decides what qualifies, so it must agree with what a full
/// `scan_vault` would have listed.
#[test]
fn scan_entry_reads_a_newly_created_note() {
    let dir = TempDir::new().unwrap();
    create_test_file(dir.path(), "notes/fresh.md", "# Fresh\n\nBody\n");

    let ScannedPath::Entry { entry } =
        scan_entry(&dir.path().join("notes/fresh.md"), dir.path()).unwrap()
    else {
        panic!("expected a listed entry")
    };

    assert_eq!(entry.filename, "fresh.md");
    assert_eq!(entry.title, "fresh");
    assert_eq!(entry.file_kind, "markdown");
}

#[test]
fn scan_entry_reads_a_newly_created_non_markdown_file() {
    let dir = TempDir::new().unwrap();
    create_test_file(dir.path(), "attachments/data.txt", "hello");

    let ScannedPath::Entry { entry } =
        scan_entry(&dir.path().join("attachments/data.txt"), dir.path()).unwrap()
    else {
        panic!("expected a listed entry")
    };

    assert_eq!(entry.filename, "data.txt");
    assert_eq!(entry.file_kind, "text");
}

#[test]
fn scan_entry_separates_a_vanished_file_from_one_the_scan_would_skip() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("New Folder")).unwrap();
    create_test_file(dir.path(), ".laputa/views/work.yml", "name: Work\n");
    create_test_file(dir.path(), ".hidden.md", "# Hidden\n");

    // Present but not listed: the folder tree may still need to hear about it.
    assert!(matches!(
        scan_entry(&dir.path().join("New Folder"), dir.path()).unwrap(),
        ScannedPath::Unlisted
    ));
    assert!(matches!(
        scan_entry(&dir.path().join(".laputa/views/work.yml"), dir.path()).unwrap(),
        ScannedPath::Unlisted
    ));
    assert!(matches!(
        scan_entry(&dir.path().join(".hidden.md"), dir.path()).unwrap(),
        ScannedPath::Unlisted
    ));
    // Gone: the entry list holding nothing there is already correct.
    assert!(matches!(
        scan_entry(&dir.path().join("missing.md"), dir.path()).unwrap(),
        ScannedPath::Missing
    ));
}

#[test]
fn scan_entry_rejects_paths_outside_the_vault() {
    let dir = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    create_test_file(outside.path(), "stray.md", "# Stray\n");

    assert!(matches!(
        scan_entry(&outside.path().join("stray.md"), dir.path()).unwrap(),
        ScannedPath::Unlisted
    ));
}

#[test]
fn scan_entry_accepts_every_file_a_full_scan_lists() {
    let dir = TempDir::new().unwrap();
    create_test_file(dir.path(), "root.md", "# Root\n");
    create_test_file(dir.path(), "notes/nested.md", "# Nested\n");
    create_test_file(dir.path(), "attachments/data.txt", "text");
    create_test_file(dir.path(), "type/Project.md", "---\ntype: Type\n---\n");

    for scanned in scan_vault(dir.path(), "created").unwrap() {
        let path = PathBuf::from(&scanned.path);
        assert!(
            matches!(
                scan_entry(&path, dir.path()).unwrap(),
                ScannedPath::Entry { .. }
            ),
            "scan_vault listed {} but scan_entry rejected it",
            scanned.path
        );
    }
}
