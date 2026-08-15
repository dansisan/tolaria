//! Which date frontmatter a note is missing. Read-only — the write goes through
//! `update_frontmatter` like any other property edit.

use std::path::Path;

use serde::Serialize;

/// One frontmatter key a note is missing, with the value it should get.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NoteDateSuggestion {
    pub key: String,
    pub value: String,
}

/// The date frontmatter a note is missing, in the order it should be written.
pub fn missing_note_dates(
    path: &Path,
    created_key: &str,
) -> Result<Vec<NoteDateSuggestion>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {}", path.display(), error))?;

    let missing = crate::frontmatter::missing_date_keys(&content, created_key);
    if missing.is_empty() {
        return Ok(Vec::new());
    }

    let (fs_modified, fs_created, _) = super::file::read_file_metadata(path)?;
    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();

    let dates = crate::frontmatter::resolve_note_dates(
        &filename,
        fs_created,
        fs_modified,
        chrono::Local::now(),
    );

    Ok(missing
        .into_iter()
        .map(|key| NoteDateSuggestion {
            value: crate::frontmatter::note_date_value(&dates, &key, created_key).to_string(),
            key,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn keys(suggestions: &[NoteDateSuggestion]) -> Vec<&str> {
        suggestions.iter().map(|s| s.key.as_str()).collect()
    }

    fn value_of<'a>(suggestions: &'a [NoteDateSuggestion], key: &str) -> &'a str {
        suggestions
            .iter()
            .find(|s| s.key == key)
            .map(|s| s.value.as_str())
            .unwrap_or_default()
    }

    #[test]
    fn suggests_every_date_for_a_note_an_agent_dropped_in() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("agent-output.md");
        fs::write(&path, "# Findings\n\nBody\n").unwrap();

        let suggestions = missing_note_dates(&path, "created").unwrap();

        assert_eq!(keys(&suggestions), vec!["created", "dayCreated", "modified"]);
        assert!(!value_of(&suggestions, "created").is_empty());
    }

    #[test]
    fn a_daily_note_takes_its_date_from_its_filename() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("2025-12-17.md");
        fs::write(&path, "# Daily\n").unwrap();

        let suggestions = missing_note_dates(&path, "created").unwrap();

        assert_eq!(value_of(&suggestions, "created"), "2025-12-17 00:00:00");
        assert_eq!(value_of(&suggestions, "dayCreated"), "Wed");
    }

    #[test]
    fn suggests_only_the_missing_key() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        fs::write(
            &path,
            "---\ncreated: \"2019-05-05 08:00:00\"\ndayCreated: Sun\n---\n# Note\n",
        )
        .unwrap();

        let suggestions = missing_note_dates(&path, "created").unwrap();

        assert_eq!(keys(&suggestions), vec!["modified"]);
    }

    #[test]
    fn suggests_nothing_for_a_fully_dated_note() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        fs::write(
            &path,
            concat!(
                "---\n",
                "created: \"2026-01-02 03:04:05\"\n",
                "dayCreated: Fri\n",
                "modified: \"2026-01-03 03:04:05\"\n",
                "---\n# Note\n"
            ),
        )
        .unwrap();

        assert!(missing_note_dates(&path, "created").unwrap().is_empty());
    }

    /// Reading must never write — the note is the reader's, and the inspector only
    /// offers.
    #[test]
    fn leaves_the_note_on_disk_untouched() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        let original = "# Note\n\nBody\n";
        fs::write(&path, original).unwrap();

        missing_note_dates(&path, "created").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), original);
    }

    #[test]
    fn honors_a_vault_configured_created_key() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "# Note\n").unwrap();

        let suggestions = missing_note_dates(&path, "date").unwrap();

        assert_eq!(keys(&suggestions), vec!["date", "dayCreated", "modified"]);
        assert!(!value_of(&suggestions, "date").is_empty());
    }
}
