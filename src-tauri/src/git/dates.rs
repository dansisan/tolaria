use std::collections::HashMap;
use std::path::Path;

use git2::Repository;

use super::repo;

/// Git-derived creation and modification timestamps for a file.
#[derive(Debug, Clone)]
pub struct GitDates {
    pub created_at: u64,
    pub modified_at: u64,
}

/// Walk history once to collect creation and modification dates for all tracked
/// files in the repository. Returns a map from relative path to dates.
///
/// - **modified_at** = author date of the most recent commit touching the file
/// - **created_at** = author date of the oldest commit touching the file
///
/// Files not yet committed (untracked / only staged) will not appear in the map;
/// callers should fall back to filesystem metadata for those.
pub fn get_all_file_dates(vault_path: &Path) -> HashMap<String, GitDates> {
    let Ok(repository) = repo::open(vault_path) else {
        return HashMap::new();
    };

    collect_file_dates(&repository).unwrap_or_default()
}

fn collect_file_dates(repository: &Repository) -> Result<HashMap<String, GitDates>, git2::Error> {
    let mut dates: HashMap<String, GitDates> = HashMap::new();

    for oid in repo::head_commits(repository)? {
        let commit = repository.find_commit(oid)?;
        let timestamp = repo::author_timestamp(&commit);
        if timestamp < 0 {
            continue;
        }
        let timestamp = timestamp as u64;

        for changed in repo::changed_files(repository, &commit)? {
            if !changed.path.ends_with(".md") {
                continue;
            }
            record_date(&mut dates, changed.path, timestamp);
        }
    }

    Ok(dates)
}

/// Widen a file's known date range. Taking min/max keeps the result independent
/// of walk order, so it cannot silently invert if the ordering ever changes.
fn record_date(dates: &mut HashMap<String, GitDates>, path: String, timestamp: u64) {
    dates
        .entry(path)
        .and_modify(|existing| {
            existing.created_at = existing.created_at.min(timestamp);
            existing.modified_at = existing.modified_at.max(timestamp);
        })
        .or_insert(GitDates {
            created_at: timestamp,
            modified_at: timestamp,
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::git_command;
    use crate::git::tests::setup_git_repo;
    use std::fs;

    /// Commit `files` with a pinned author date so date assertions are exact.
    fn commit_at(vault: &Path, date: &str, files: &[(&str, &str)], message: &str) {
        for (name, body) in files {
            let path = vault.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, body).unwrap();
        }

        git_command()
            .args(["add", "."])
            .current_dir(vault)
            .output()
            .unwrap();

        git_command()
            .args(["commit", "-m", message])
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date)
            .current_dir(vault)
            .output()
            .unwrap();
    }

    #[test]
    fn test_single_commit_sets_created_and_modified_to_the_same_date() {
        let dir = setup_git_repo();
        let vault = dir.path();

        commit_at(
            vault,
            "2026-03-15T10:00:00+00:00",
            &[("file-a.md", "# A\n"), ("file-b.md", "# B\n")],
            "first",
        );

        let dates = get_all_file_dates(vault);

        assert_eq!(dates.len(), 2);
        assert_eq!(dates["file-a.md"].created_at, 1773568800);
        assert_eq!(dates["file-a.md"].modified_at, 1773568800);
    }

    #[test]
    fn test_created_tracks_oldest_commit_and_modified_tracks_newest() {
        let dir = setup_git_repo();
        let vault = dir.path();

        commit_at(
            vault,
            "2026-03-10T08:00:00+00:00",
            &[("file-a.md", "# A\n"), ("file-b.md", "# B\n")],
            "older",
        );
        commit_at(
            vault,
            "2026-03-15T10:00:00+00:00",
            &[("file-a.md", "# A updated\n")],
            "newer",
        );

        let dates = get_all_file_dates(vault);

        assert_eq!(dates.len(), 2);
        assert_eq!(dates["file-a.md"].created_at, 1773129600);
        assert_eq!(dates["file-a.md"].modified_at, 1773568800);
        assert_eq!(dates["file-b.md"].created_at, 1773129600);
        assert_eq!(dates["file-b.md"].modified_at, 1773129600);
    }

    #[test]
    fn test_non_md_files_filtered_out() {
        let dir = setup_git_repo();
        let vault = dir.path();

        commit_at(
            vault,
            "2026-03-15T10:00:00+00:00",
            &[
                ("README.txt", "readme\n"),
                ("note.md", "# Note\n"),
                ("image.png", "not really a png\n"),
            ],
            "mixed",
        );

        let dates = get_all_file_dates(vault);

        assert_eq!(dates.len(), 1);
        assert!(dates.contains_key("note.md"));
    }

    #[test]
    fn test_subdirectory_paths_are_repo_relative() {
        let dir = setup_git_repo();
        let vault = dir.path();

        commit_at(
            vault,
            "2026-03-15T10:00:00+00:00",
            &[
                ("docs/adr/0001-stack.md", "# ADR\n"),
                ("notes/daily.md", "# Daily\n"),
            ],
            "nested",
        );

        let dates = get_all_file_dates(vault);

        assert_eq!(dates.len(), 2);
        assert!(dates.contains_key("docs/adr/0001-stack.md"));
        assert!(dates.contains_key("notes/daily.md"));
    }

    #[test]
    fn test_deleted_file_keeps_its_last_touching_commit() {
        let dir = setup_git_repo();
        let vault = dir.path();

        commit_at(
            vault,
            "2026-03-10T08:00:00+00:00",
            &[("gone.md", "# Gone\n")],
            "add",
        );
        fs::remove_file(vault.join("gone.md")).unwrap();
        commit_at(vault, "2026-03-15T10:00:00+00:00", &[], "remove");

        let dates = get_all_file_dates(vault);

        assert_eq!(dates["gone.md"].created_at, 1773129600);
        assert_eq!(dates["gone.md"].modified_at, 1773568800);
    }

    #[test]
    fn test_empty_repo_has_no_dates() {
        let dir = setup_git_repo();

        assert!(get_all_file_dates(dir.path()).is_empty());
    }

    #[test]
    fn test_get_all_file_dates_no_git_repo() {
        let dir = tempfile::TempDir::new().unwrap();

        assert!(get_all_file_dates(dir.path()).is_empty());
    }
}
