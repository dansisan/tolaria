//! Bulk re-derivation of content-based frontmatter across an existing vault.
//!
//! Derived fields like `codeBlocks` are normally stamped on the save path, so
//! they only reach notes that have been saved since the feature shipped. This
//! walks every markdown note and applies the same content pipeline once, so the
//! whole vault is brought up to date in a single pass.

use std::fs;
use std::path::Path;

use walkdir::{DirEntry, WalkDir};

use super::{is_hidden_dir, is_md_file};

/// Re-derive content-based frontmatter (e.g. `codeBlocks`) for every markdown
/// note in the vault, rewriting a file only when the derivation actually
/// changes it. The `modified` date is deliberately left untouched — a backfill
/// is a migration, not an edit. Returns the number of notes that changed.
pub fn backfill_derived_frontmatter(vault_path: &Path) -> Result<usize, String> {
    if !vault_path.is_dir() {
        return Err(format!(
            "Vault path is not a directory: {}",
            vault_path.display()
        ));
    }

    let mut changed = 0;
    let walker = WalkDir::new(vault_path)
        .follow_links(true)
        .into_iter()
        .filter_entry(|entry| !is_hidden_walk_dir(entry));

    for entry in walker.filter_map(Result::ok) {
        let path = entry.path();
        if is_md_file(path) && backfill_note(path)? {
            changed += 1;
        }
    }

    Ok(changed)
}

/// Skip hidden directories (`.git`, `.obsidian`, …) without skipping the vault
/// root itself, mirroring the main vault scan.
fn is_hidden_walk_dir(entry: &DirEntry) -> bool {
    entry.file_type().is_dir()
        && entry.depth() > 0
        && is_hidden_dir(&entry.file_name().to_string_lossy())
}

/// Apply the content pipeline to one note, writing it back only on change.
/// Returns whether the file was rewritten.
fn backfill_note(path: &Path) -> Result<bool, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let updated = crate::frontmatter::apply_content_frontmatter(&content);
    if updated == content {
        return Ok(false);
    }
    fs::write(path, &updated).map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(dir: &TempDir, name: &str, content: &str) {
        let path = dir.path().join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn read(dir: &TempDir, name: &str) -> String {
        fs::read_to_string(dir.path().join(name)).unwrap()
    }

    #[test]
    fn stamps_code_block_count_into_notes_that_contain_code() {
        let dir = TempDir::new().unwrap();
        write(&dir, "code.md", "# Code\n\n```\nlet x = 1\n```\n");
        write(&dir, "prose.md", "# Prose\n\nNo code here.\n");

        let changed = backfill_derived_frontmatter(dir.path()).unwrap();

        assert_eq!(changed, 1);
        assert!(read(&dir, "code.md").contains("codeBlocks: 1"));
        // A prose note with no code and no key is left exactly as it was.
        assert_eq!(read(&dir, "prose.md"), "# Prose\n\nNo code here.\n");
    }

    #[test]
    fn is_idempotent_and_reports_no_changes_on_a_second_pass() {
        let dir = TempDir::new().unwrap();
        write(&dir, "code.md", "# Code\n\n```\nlet x = 1\n```\n");

        assert_eq!(backfill_derived_frontmatter(dir.path()).unwrap(), 1);
        assert_eq!(backfill_derived_frontmatter(dir.path()).unwrap(), 0);
    }

    #[test]
    fn preserves_modified_dates_while_refreshing_a_stale_count() {
        let dir = TempDir::new().unwrap();
        write(
            &dir,
            "note.md",
            "---\nmodified: 2020-01-01 00:00:00\ncodeBlocks: 9\n---\n# Note\n\n```\ncode\n```\n",
        );

        assert_eq!(backfill_derived_frontmatter(dir.path()).unwrap(), 1);
        let updated = read(&dir, "note.md");
        assert!(updated.contains("codeBlocks: 1"));
        assert!(updated.contains("2020-01-01 00:00:00"));
    }

    #[test]
    fn skips_hidden_directories_and_non_markdown_files() {
        let dir = TempDir::new().unwrap();
        write(&dir, ".git/hooks/note.md", "# Hidden\n\n```\ncode\n```\n");
        write(&dir, "notes.txt", "```\ncode\n```\n");

        assert_eq!(backfill_derived_frontmatter(dir.path()).unwrap(), 0);
        assert!(!read(&dir, ".git/hooks/note.md").contains("codeBlocks"));
    }

    #[test]
    fn errors_when_the_vault_path_is_not_a_directory() {
        let dir = TempDir::new().unwrap();
        write(&dir, "note.md", "# Note\n");
        let result = backfill_derived_frontmatter(&dir.path().join("note.md"));
        assert!(result.unwrap_err().contains("not a directory"));
    }
}
