use super::*;

// Notes (is_a is absent or "Note") always use the filename stem as the title —
// H1 and frontmatter `title:` are ignored. Structured Types keep the legacy
// H1 -> frontmatter title -> filename priority chain (see ADR superseding 0068).

#[test]
fn test_note_type_ignores_h1_uses_filename() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "my-note.md",
        "---\ntype: Note\n---\n# Totally Different Heading\n\nBody.",
    );
    assert_eq!(entry.title, "my-note");
}

#[test]
fn test_note_type_ignores_frontmatter_title_uses_filename() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "my-note.md",
        "---\ntype: Note\ntitle: Legacy Title\n---\n\nBody.",
    );
    assert_eq!(entry.title, "my-note");
}

#[test]
fn test_note_type_ignores_both_h1_and_frontmatter_title() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "my-note.md",
        "---\ntype: Note\ntitle: Legacy Title\n---\n# H1 Title\n\nBody.",
    );
    assert_eq!(entry.title, "my-note");
}

#[test]
fn test_untyped_entry_no_frontmatter_at_all_uses_filename() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(&dir, "untyped-note.md", "# Some Heading\n\nBody.");
    assert_eq!(entry.title, "untyped-note");
    assert_eq!(entry.is_a, None);
}

#[test]
fn test_note_type_has_h1_is_always_false() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "my-note.md",
        "---\ntype: Note\n---\n# Totally Different Heading\n\nBody.",
    );
    assert!(!entry.has_h1);
}

#[test]
fn test_type_instance_still_uses_h1_priority() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "person-record.md",
        "---\ntype: Person\ntitle: Legacy Title\n---\n# Jane Doe\n\nBio.",
    );
    assert_eq!(entry.title, "Jane Doe");
    assert!(entry.has_h1);
}

#[test]
fn test_type_instance_still_uses_frontmatter_title_when_no_h1() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "person-record.md",
        "---\ntype: Person\ntitle: Jane Doe\n---\n\nBio.",
    );
    assert_eq!(entry.title, "Jane Doe");
    assert!(!entry.has_h1);
}
