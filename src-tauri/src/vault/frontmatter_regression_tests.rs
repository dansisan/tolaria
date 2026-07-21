use super::*;
use std::fs;
use std::io::Write;
use std::path::Path;
use tempfile::TempDir;

fn create_test_file(dir: &Path, name: &str, content: &str) {
    let file_path = dir.join(name);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut file = fs::File::create(file_path).unwrap();
    file.write_all(content.as_bytes()).unwrap();
}

fn parse_test_entry(dir: &TempDir, name: &str, content: &str) -> VaultEntry {
    create_test_file(dir.path(), name, content);
    parse_md_file(&dir.path().join(name), None, "created").unwrap()
}

struct HiddenPropertyCase<'a> {
    content: &'a str,
    hidden_key: &'a str,
}

fn assert_filtered_property_stays_hidden(case: HiddenPropertyCase<'_>) {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(&dir, "test.md", case.content);
    assert!(!entry.properties.contains_key(case.hidden_key));
    assert_eq!(
        entry
            .properties
            .get("Company")
            .and_then(|value| value.as_str()),
        Some("Acme Corp")
    );
}

struct SingleElementArrayCase<'a> {
    note_type: &'a str,
    key: &'a str,
    value: &'a str,
}

fn assert_single_element_array_property(case: SingleElementArrayCase<'_>) {
    let dir = TempDir::new().unwrap();
    let content = format!(
        "---\ntype: {}\n{}:\n  - {}\n---\n# Test\n",
        case.note_type, case.key, case.value
    );
    let entry = parse_test_entry(&dir, "test.md", &content);
    assert_eq!(
        entry
            .properties
            .get(case.key)
            .and_then(|property| property.as_str()),
        Some(case.value)
    );
    assert_eq!(entry.is_a, Some(case.note_type.to_string()));
}

struct AliasRecoveryCase<'a> {
    file_name: &'a str,
    title: &'a str,
    alias_item: &'a str,
}

fn assert_alias_parser_recovers(case: AliasRecoveryCase<'_>) {
    let dir = TempDir::new().unwrap();
    let content = format!(
        "---\ntype: Note\n_organized: true\naliases:\n  - {}\n  - Note\n---\n# {}\n",
        case.alias_item, case.title
    );
    let entry = parse_test_entry(&dir, case.file_name, &content);
    assert_eq!(entry.is_a, Some("Note".to_string()));
    assert!(entry.organized);
}

#[test]
fn test_filtered_properties_stay_hidden() {
    let cases = [HiddenPropertyCase {
        content: "---\nMentor: \"[[person/alice]]\"\nCompany: Acme Corp\n---\n# Test\n",
        hidden_key: "Mentor",
    }];

    for case in cases {
        assert_filtered_property_stays_hidden(case);
    }
}

#[test]
fn test_single_element_array_properties_unwrap_to_scalars() {
    let cases = [
        SingleElementArrayCase {
            note_type: "Responsibility",
            key: "Owner",
            value: "Luca",
        },
        SingleElementArrayCase {
            note_type: "Procedure",
            key: "Cadence",
            value: "Weekly",
        },
    ];

    for case in cases {
        assert_single_element_array_property(case);
    }
}

#[test]
fn test_multi_element_array_properties_are_preserved() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "playlist.md",
        "---\ngenres:\n  - blues\n  - chicago\n---\n# Playlist\n",
    );

    assert_eq!(
        entry.properties.get("genres"),
        Some(&serde_json::json!(["blues", "chicago"]))
    );
}

#[test]
fn test_blank_scalar_properties_are_preserved() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "book.md",
        "---\ntype: Book\nstart date:\nrating: \n---\n# Book\n",
    );

    assert!(entry
        .properties
        .get("start date")
        .is_some_and(|value| value.is_null()));
    assert!(entry
        .properties
        .get("rating")
        .is_some_and(|value| value.is_null()));
}

#[test]
fn test_unquoted_wikilink_relationships_are_preserved() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "book.md",
        "---\ntype: Type\nMentor: [[person/alice]]\n---\n# Book\n",
    );

    assert_eq!(
        entry.relationships.get("Mentor"),
        Some(&vec!["[[person/alice]]".to_string()])
    );
}

#[test]
fn test_alias_parser_recovers_special_alias_items() {
    let cases = [
        AliasRecoveryCase {
            file_name: "colon-alias.md",
            title: "Test",
            alias_item: "Bitcoin: Net Unrealized Profit/Loss",
        },
        AliasRecoveryCase {
            file_name: "hash-alias.md",
            title: "Title",
            alias_item: "# Writing a Good CLAUDE.md",
        },
    ];

    for case in cases {
        assert_alias_parser_recovers(case);
    }
}

#[test]
fn test_alias_collisions_keep_frontmatter_with_last_value_winning() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Note\nstatus: Active\nStatus: Evergreened\n---\n# Test\n";
    let entry = parse_test_entry(&dir, "test.md", content);

    assert_eq!(entry.is_a, Some("Note".to_string()));
    assert_eq!(entry.status, Some("Evergreened".to_string()));
}

/// Naive datetimes (no offset marker) are interpreted in the machine's
/// ambient local timezone — the same zone `stamp_modified_date` writes in —
/// so expected values here are computed the same way rather than hardcoding
/// a UTC assumption, keeping the test deterministic regardless of what
/// timezone actually runs it.
fn local_epoch_secs(naive: chrono::NaiveDateTime) -> i64 {
    naive.and_local_timezone(chrono::Local).single().unwrap().timestamp()
}

#[test]
fn test_frontmatter_created_date_only_is_in_seconds() {
    let dir = TempDir::new().unwrap();
    // Date-only format (no time component) — the bug case where ms were returned instead of secs.
    let content = "---\ncreated: 2025-11-30\n---\n# Test\n";
    let entry = parse_test_entry(&dir, "date-only.md", content);

    // Noon keeps the date stable across all timezones.
    let expected = local_epoch_secs(
        chrono::NaiveDate::from_ymd_opt(2025, 11, 30)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap(),
    );
    assert_eq!(entry.created_at, Some(expected as u64));
}

#[test]
fn test_frontmatter_created_datetime_is_in_seconds() {
    let dir = TempDir::new().unwrap();
    let content = "---\ncreated: 2025-11-30T10:30:00\n---\n# Test\n";
    let entry = parse_test_entry(&dir, "datetime.md", content);

    let expected = local_epoch_secs(
        chrono::NaiveDate::from_ymd_opt(2025, 11, 30)
            .unwrap()
            .and_hms_opt(10, 30, 0)
            .unwrap(),
    );
    assert_eq!(entry.created_at, Some(expected as u64));
}

#[test]
fn test_frontmatter_created_rfc3339_is_in_seconds() {
    let dir = TempDir::new().unwrap();
    let content = "---\ncreated: 2025-11-30T10:30:00Z\n---\n# Test\n";
    let entry = parse_test_entry(&dir, "rfc3339.md", content);

    // RFC3339 carries an explicit "Z" (UTC) offset, so this is timezone-independent.
    assert_eq!(entry.created_at, Some(1_764_460_800 + 10 * 3600 + 30 * 60));
}

#[test]
fn test_frontmatter_created_datetime_without_seconds_space_separator() {
    let dir = TempDir::new().unwrap();
    // Bear/common format: "YYYY-MM-DD HH:MM" (no seconds)
    let content = "---\ncreated: 2025-11-30 10:30\n---\n# Test\n";
    let entry = parse_test_entry(&dir, "no-seconds-space.md", content);

    let expected = local_epoch_secs(
        chrono::NaiveDate::from_ymd_opt(2025, 11, 30)
            .unwrap()
            .and_hms_opt(10, 30, 0)
            .unwrap(),
    );
    assert_eq!(entry.created_at, Some(expected as u64));
}

#[test]
fn test_frontmatter_created_datetime_without_seconds_t_separator() {
    let dir = TempDir::new().unwrap();
    // ISO 8601 without seconds: "YYYY-MM-DDTHH:MM"
    let content = "---\ncreated: 2025-11-30T10:30\n---\n# Test\n";
    let entry = parse_test_entry(&dir, "no-seconds-t.md", content);

    let expected = local_epoch_secs(
        chrono::NaiveDate::from_ymd_opt(2025, 11, 30)
            .unwrap()
            .and_hms_opt(10, 30, 0)
            .unwrap(),
    );
    assert_eq!(entry.created_at, Some(expected as u64));
}

#[test]
fn test_frontmatter_tags_list_included_in_inline_tags() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntags:\n  - project\n  - work\n---\n# Test\n\nBody text.\n";
    let entry = parse_test_entry(&dir, "fm-tags-list.md", content);

    assert!(entry.inline_tags.contains(&"project".to_string()));
    assert!(entry.inline_tags.contains(&"work".to_string()));
}

#[test]
fn test_frontmatter_tags_hash_prefix_stripped() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntags:\n  - \"#project\"\n  - \"#work\"\n---\n# Test\n\nBody text.\n";
    let entry = parse_test_entry(&dir, "fm-tags-hash.md", content);

    assert!(entry.inline_tags.contains(&"project".to_string()));
    assert!(entry.inline_tags.contains(&"work".to_string()));
    assert!(!entry.inline_tags.iter().any(|t| t.starts_with('#')));
}

#[test]
fn test_frontmatter_tags_string_included_in_inline_tags() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntags: single-tag\n---\n# Test\n\nBody text.\n";
    let entry = parse_test_entry(&dir, "fm-tags-string.md", content);

    assert!(entry.inline_tags.contains(&"single-tag".to_string()));
}

#[test]
fn test_frontmatter_tags_merged_with_body_tags_deduped() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntags:\n  - alpha\n  - beta\n---\n# Test\n\n#alpha #gamma\n";
    let entry = parse_test_entry(&dir, "fm-tags-merged.md", content);

    let mut expected = vec!["alpha", "beta", "gamma"];
    expected.sort();
    let mut actual = entry.inline_tags.iter().map(|s| s.as_str()).collect::<Vec<_>>();
    actual.sort();
    assert_eq!(actual, expected);
}
