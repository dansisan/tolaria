use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

use git2::{Delta, Diff, DiffOptions, Patch, Repository, Status, StatusEntry, StatusOptions};

use super::{git_command, repo};

#[derive(Debug, Serialize, Clone)]
pub struct ModifiedFile {
    pub path: String,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub status: String,
    #[serde(rename = "addedLines")]
    pub added_lines: Option<usize>,
    #[serde(rename = "deletedLines")]
    pub deleted_lines: Option<usize>,
    pub binary: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct DiffStats {
    added_lines: Option<usize>,
    deleted_lines: Option<usize>,
    binary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileChangeStatus {
    Modified,
    Added,
    Deleted,
    Untracked,
    Renamed,
}

impl FileChangeStatus {
    fn from_code(status_code: &str) -> Self {
        match status_code.trim() {
            "A" => Self::Added,
            "D" => Self::Deleted,
            "??" => Self::Untracked,
            "R" | "RM" => Self::Renamed,
            _ => Self::Modified,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::Deleted => "deleted",
            Self::Untracked => "untracked",
            Self::Renamed => "renamed",
            Self::Modified => "modified",
        }
    }
}

/// Render a libgit2 status as git's two-letter porcelain code (index column, then
/// worktree column), so the status vocabulary the frontend receives stays
/// byte-for-byte what the `git status --porcelain` parser produced.
fn porcelain_code(status: Status) -> String {
    if status.is_wt_new() && !status.is_index_new() {
        return "??".to_string();
    }

    format!("{}{}", index_column(status), worktree_column(status))
}

fn index_column(status: Status) -> char {
    if status.is_index_new() {
        'A'
    } else if status.is_index_modified() {
        'M'
    } else if status.is_index_deleted() {
        'D'
    } else if status.is_index_renamed() {
        'R'
    } else if status.is_index_typechange() {
        'T'
    } else {
        ' '
    }
}

fn worktree_column(status: Status) -> char {
    if status.is_wt_modified() {
        'M'
    } else if status.is_wt_deleted() {
        'D'
    } else if status.is_wt_renamed() {
        'R'
    } else if status.is_wt_typechange() {
        'T'
    } else {
        ' '
    }
}

/// Line counts for every path that differs between HEAD and the working tree —
/// the equivalent of `git diff --numstat --find-renames HEAD`.
fn load_diff_stats(repository: &Repository) -> Result<HashMap<String, DiffStats>, git2::Error> {
    let Some(head) = repo::head_commit(repository)? else {
        return Ok(HashMap::new());
    };

    let tree = head.tree()?;
    let mut options = DiffOptions::new();
    let mut diff = repository.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut options))?;
    diff.find_similar(None)?;

    diff_stats_by_path(&diff)
}

fn diff_stats_by_path(diff: &Diff) -> Result<HashMap<String, DiffStats>, git2::Error> {
    let mut stats = HashMap::new();

    for index in 0..diff.deltas().len() {
        let Some(path) = delta_path(diff, index) else {
            continue;
        };
        stats.insert(path, delta_stats(diff, index)?);
    }

    Ok(stats)
}

fn delta_path(diff: &Diff, index: usize) -> Option<String> {
    let delta = diff.get_delta(index)?;
    let path = delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())?;

    Some(path.to_string_lossy().to_string())
}

/// Binary files report no line counts, matching numstat's `-` columns.
fn delta_stats(diff: &Diff, index: usize) -> Result<DiffStats, git2::Error> {
    let patch = Patch::from_diff(diff, index)?;

    let is_binary = diff
        .get_delta(index)
        .is_some_and(|delta| delta.flags().is_binary() || delta.status() == Delta::Unreadable);
    if is_binary {
        return Ok(DiffStats {
            added_lines: None,
            deleted_lines: None,
            binary: true,
        });
    }

    let (_, added, deleted) = match patch {
        Some(patch) => patch.line_stats()?,
        None => (0, 0, 0),
    };

    Ok(DiffStats {
        added_lines: Some(added),
        deleted_lines: Some(deleted),
        binary: false,
    })
}

fn count_worktree_lines(vault: &Path, relative_path: &Path) -> DiffStats {
    let full_path = vault.join(relative_path);
    let added_lines = std::fs::read_to_string(full_path)
        .ok()
        .map(|content| content.lines().count());

    DiffStats {
        added_lines,
        deleted_lines: None,
        binary: false,
    }
}

fn resolve_diff_stats(
    vault: &Path,
    relative_path: &Path,
    status: FileChangeStatus,
    diff_stats: &HashMap<String, DiffStats>,
    include_stats: bool,
) -> DiffStats {
    if !include_stats {
        return DiffStats::default();
    }

    if status == FileChangeStatus::Untracked {
        return count_worktree_lines(vault, relative_path);
    }

    let key = relative_path.to_string_lossy();
    diff_stats.get(key.as_ref()).copied().unwrap_or_default()
}

fn ensure_path_within_vault(vault: &Path, relative_path: &Path, abs: &Path) -> Result<(), String> {
    for component in relative_path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err("File path is outside the vault".into());
        }
    }

    if !abs.exists() {
        return Ok(());
    }

    let canonical_vault = vault
        .canonicalize()
        .map_err(|e| format!("Cannot resolve vault path: {e}"))?;
    let canonical_file = abs
        .canonicalize()
        .map_err(|e| format!("Cannot resolve file path: {e}"))?;

    if canonical_file.starts_with(&canonical_vault) {
        Ok(())
    } else {
        Err("File path is outside the vault".into())
    }
}

/// Trimmed porcelain code for a single file, or an empty string when the file is
/// clean or unknown to git.
fn load_file_status(vault: &Path, relative_path: &Path) -> Result<String, String> {
    let repository = open_vault(vault)?;

    Ok(repository
        .status_file(relative_path)
        .map(|status| porcelain_code(status).trim().to_string())
        .unwrap_or_default())
}

fn restore_tracked_file(vault: &Path, relative_path: &Path) -> Result<(), String> {
    let _ = git_command()
        .args(["reset", "HEAD", "--"])
        .arg(relative_path)
        .current_dir(vault)
        .output();

    let checkout = git_command()
        .args(["checkout", "--"])
        .arg(relative_path)
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git checkout: {e}"))?;

    if checkout.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&checkout.stderr);
    Err(format!("git checkout failed: {}", stderr.trim()))
}

/// Get list of modified/added/deleted files in the vault (uncommitted changes).
pub fn get_modified_files(vault_path: impl AsRef<Path>) -> Result<Vec<ModifiedFile>, String> {
    get_modified_files_impl(vault_path.as_ref(), false)
}

/// Get list of modified/added/deleted files with line-level diff statistics.
pub fn get_modified_files_with_stats(
    vault_path: impl AsRef<Path>,
) -> Result<Vec<ModifiedFile>, String> {
    get_modified_files_impl(vault_path.as_ref(), true)
}

fn get_modified_files_impl(vault: &Path, include_stats: bool) -> Result<Vec<ModifiedFile>, String> {
    let repository = open_vault(vault)?;

    collect_modified_files(&repository, vault, include_stats)
        .map_err(|error| format!("Failed to read git status: {}", error.message()))
}

fn collect_modified_files(
    repository: &Repository,
    vault: &Path,
    include_stats: bool,
) -> Result<Vec<ModifiedFile>, git2::Error> {
    let diff_stats = if include_stats {
        load_diff_stats(repository)?
    } else {
        HashMap::new()
    };

    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repository.statuses(Some(&mut options))?;
    let files = statuses
        .iter()
        .filter_map(|entry| {
            let status = entry.status();
            let relative_path = entry_path(&entry, status)?;
            // Only include markdown files
            if !relative_path.ends_with(".md") {
                return None;
            }

            Some(modified_file(
                vault,
                relative_path,
                FileChangeStatus::from_code(&porcelain_code(status)),
                &diff_stats,
                include_stats,
            ))
        })
        .collect();

    Ok(files)
}

/// `git status --porcelain` lists a rename's destination path first, and that
/// destination is what the rest of the app keys off. libgit2's `StatusEntry::path`
/// reports the source instead, so renames read their new path off the delta.
fn entry_path(entry: &StatusEntry, status: Status) -> Option<String> {
    if status.is_index_renamed() || status.is_wt_renamed() {
        if let Some(destination) = rename_destination(entry) {
            return Some(destination);
        }
    }

    entry.path().ok().map(ToString::to_string)
}

fn rename_destination(entry: &StatusEntry) -> Option<String> {
    entry
        .head_to_index()
        .or_else(|| entry.index_to_workdir())?
        .new_file()
        .path()
        .map(|path| path.to_string_lossy().to_string())
}

fn modified_file(
    vault: &Path,
    relative_path: String,
    status: FileChangeStatus,
    diff_stats: &HashMap<String, DiffStats>,
    include_stats: bool,
) -> ModifiedFile {
    let stats = resolve_diff_stats(
        vault,
        Path::new(&relative_path),
        status,
        diff_stats,
        include_stats,
    );

    ModifiedFile {
        path: vault.join(&relative_path).to_string_lossy().to_string(),
        relative_path,
        status: status.label().to_string(),
        added_lines: stats.added_lines,
        deleted_lines: stats.deleted_lines,
        binary: stats.binary,
    }
}

fn open_vault(vault: &Path) -> Result<Repository, String> {
    repo::open(vault).map_err(|error| format!("Failed to open git repository: {}", error.message()))
}

/// Discard uncommitted changes to a single file.
///
/// - **Modified / Deleted**: `git checkout -- <file>` restores the last committed version.
/// - **Untracked / Added**: the file is removed from disk.
///
/// The `relative_path` must be relative to `vault_path` (the same format
/// returned by [`get_modified_files`]).
pub fn discard_file_changes(vault_path: &str, relative_path: &str) -> Result<(), String> {
    let vault = Path::new(vault_path);
    let relative = Path::new(relative_path);
    let abs = vault.join(relative);

    ensure_path_within_vault(vault, relative, &abs)?;
    let status_code = load_file_status(vault, relative)?;

    match status_code.as_str() {
        "??" => {
            std::fs::remove_file(&abs)
                .map_err(|e| format!("Failed to delete untracked file: {e}"))?;
        }
        _ => {
            restore_tracked_file(vault, relative)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::git_command;
    use super::*;
    use crate::git::git_commit;
    use crate::git::tests::setup_git_repo;
    use std::fs;

    fn write_and_commit_markdown(vault: &Path, vp: &str, relative_path: &str, content: &str) {
        fs::write(vault.join(relative_path), content).unwrap();
        git_commit(vp, "initial").unwrap();
    }

    fn force_quoted_git_paths(vault: &Path) {
        git_command()
            .args(["config", "core.quotePath", "true"])
            .current_dir(vault)
            .output()
            .unwrap();
    }

    fn expect_modified_file(vp: &str, relative_path: &str, status: &str) -> ModifiedFile {
        let modified = get_modified_files_with_stats(vp).unwrap();
        let file = modified
            .iter()
            .find(|file| file.relative_path == relative_path)
            .unwrap_or_else(|| panic!("{relative_path} should be reported as {status}"));

        assert_eq!(file.status, status);
        assert!(file.path.ends_with(relative_path));
        file.clone()
    }

    fn expect_changed_file_after(
        relative_path: &str,
        status: &str,
        change: impl FnOnce(&Path, &str),
    ) -> ModifiedFile {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        change(vault, vp);

        expect_modified_file(vp, relative_path, status)
    }

    #[test]
    fn test_get_modified_files_with_stats() {
        let dir = setup_git_repo();
        let vault = dir.path();

        // Create and commit a file
        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_command()
            .args(["add", "note.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Add note"])
            .current_dir(vault)
            .output()
            .unwrap();

        // Modify it
        fs::write(vault.join("note.md"), "# Note\n\nUpdated.").unwrap();
        // Add an untracked file
        fs::write(vault.join("new.md"), "# New\n").unwrap();

        let modified = get_modified_files_with_stats(vault.to_str().unwrap()).unwrap();

        assert!(modified.len() >= 2);
        let statuses: Vec<&str> = modified.iter().map(|f| f.status.as_str()).collect();
        assert!(statuses.contains(&"modified"));
        assert!(statuses.contains(&"untracked"));

        let modified_entry = modified
            .iter()
            .find(|file| file.relative_path == "note.md")
            .unwrap();
        assert!(modified_entry.added_lines.is_some());
        assert!(!modified_entry.binary);

        let untracked_entry = modified
            .iter()
            .find(|file| file.relative_path == "new.md")
            .unwrap();
        assert_eq!(untracked_entry.added_lines, Some(1));
        assert_eq!(untracked_entry.deleted_lines, None);
    }

    #[test]
    fn test_get_modified_files_omits_stats_by_default() {
        let dir = setup_git_repo();
        let vault = dir.path();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_command()
            .args(["add", "note.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Add note"])
            .current_dir(vault)
            .output()
            .unwrap();

        fs::write(vault.join("note.md"), "# Note\n\nUpdated.").unwrap();
        fs::write(vault.join("new.md"), "# New\n").unwrap();

        let modified = get_modified_files(vault.to_str().unwrap()).unwrap();

        assert!(modified.len() >= 2);
        assert!(modified.iter().all(|file| file.added_lines.is_none()
            && file.deleted_lines.is_none()
            && !file.binary));
    }

    #[test]
    fn test_get_modified_files_untracked_in_subdirectory() {
        let dir = setup_git_repo();
        let vault = dir.path();

        // Create initial commit so git is initialized
        fs::write(vault.join("init.md"), "# Init\n").unwrap();
        git_command()
            .args(["add", "init.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Initial"])
            .current_dir(vault)
            .output()
            .unwrap();

        // Create a new untracked file in a subdirectory (simulates new note creation)
        fs::create_dir_all(vault.join("note")).unwrap();
        fs::write(vault.join("note/brand-new.md"), "# Brand New\n").unwrap();

        let modified = get_modified_files_with_stats(vault.to_str().unwrap()).unwrap();

        assert_eq!(modified.len(), 1);
        assert_eq!(modified[0].status, "untracked");
        assert_eq!(modified[0].relative_path, "note/brand-new.md");
        assert_eq!(modified[0].added_lines, Some(1));
        assert!(
            modified[0].path.ends_with("/note/brand-new.md"),
            "Full path should end with relative path: {}",
            modified[0].path
        );
    }

    #[test]
    fn test_get_modified_files_preserves_chinese_markdown_path() {
        let relative_path = "中文笔记.md";

        let file = expect_changed_file_after(relative_path, "modified", |vault, vp| {
            force_quoted_git_paths(vault);
            write_and_commit_markdown(vault, vp, relative_path, "# 初始\n");
            fs::write(vault.join(relative_path), "# 初始\n\n更新\n").unwrap();
        });
        assert_eq!(file.added_lines, Some(2));
    }

    #[test]
    fn test_get_modified_files_preserves_untracked_markdown_path_with_spaces() {
        let relative_path = "test note.md";

        let file = expect_changed_file_after(relative_path, "untracked", |vault, vp| {
            write_and_commit_markdown(vault, vp, "init.md", "# Init\n");
            fs::write(vault.join(relative_path), "# Test\n").unwrap();
        });
        assert_eq!(file.added_lines, Some(1));
    }

    #[test]
    fn test_get_modified_files_preserves_modified_markdown_path_with_spaces() {
        let relative_path = "test note.md";

        let file = expect_changed_file_after(relative_path, "modified", |vault, vp| {
            write_and_commit_markdown(vault, vp, relative_path, "# Test\n");
            fs::write(vault.join(relative_path), "# Test\n\nUpdated\n").unwrap();
        });
        assert_eq!(file.added_lines, Some(2));
    }

    #[test]
    fn test_get_modified_files_preserves_renamed_markdown_path_with_spaces() {
        let relative_path = "test note.md";

        let file = expect_changed_file_after(relative_path, "renamed", |vault, vp| {
            write_and_commit_markdown(vault, vp, "alpha.md", "# Alpha\n");
            git_command()
                .args(["mv", "alpha.md", relative_path])
                .current_dir(vault)
                .output()
                .unwrap();
        });
        assert_eq!(file.added_lines, Some(0));
        assert_eq!(file.deleted_lines, Some(0));
    }

    #[test]
    fn test_commit_flow_modified_files_then_commit_clears() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        // Create and commit initial file
        fs::write(vault.join("flow.md"), "# Original\n").unwrap();
        git_commit(vp, "initial").unwrap();

        // Modify the file on disk
        fs::write(vault.join("flow.md"), "# Modified\n").unwrap();

        // get_modified_files should detect the change
        let modified = get_modified_files(vp).unwrap();
        assert!(
            modified.iter().any(|f| f.relative_path == "flow.md"),
            "Modified file should be detected after write"
        );

        // Commit the change
        let result = git_commit(vp, "update flow").unwrap();
        assert!(
            result.contains("1 file changed") || result.contains("flow.md"),
            "Commit output should reference the changed file: {}",
            result
        );

        // After commit, get_modified_files should return empty
        let after = get_modified_files(vp).unwrap();
        assert!(
            after.is_empty(),
            "No modified files should remain after commit, found: {:?}",
            after
        );
    }

    #[test]
    fn test_discard_modified_file() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        write_and_commit_markdown(vault, vp, "note.md", "# Original\n");

        // Modify the file
        fs::write(vault.join("note.md"), "# Changed\n").unwrap();
        assert_eq!(get_modified_files(vp).unwrap().len(), 1);

        // Discard
        discard_file_changes(vp, "note.md").unwrap();

        let content = fs::read_to_string(vault.join("note.md")).unwrap();
        assert_eq!(content, "# Original\n");
        assert!(get_modified_files(vp).unwrap().is_empty());
    }

    #[test]
    fn test_discard_untracked_file() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        write_and_commit_markdown(vault, vp, "init.md", "# Init\n");

        // Create an untracked file
        fs::write(vault.join("new.md"), "# New\n").unwrap();
        assert!(vault.join("new.md").exists());

        discard_file_changes(vp, "new.md").unwrap();

        assert!(!vault.join("new.md").exists());
        assert!(get_modified_files(vp).unwrap().is_empty());
    }

    #[test]
    fn test_discard_deleted_file() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        write_and_commit_markdown(vault, vp, "note.md", "# Original\n");

        // Delete the file
        fs::remove_file(vault.join("note.md")).unwrap();
        assert!(!vault.join("note.md").exists());

        discard_file_changes(vp, "note.md").unwrap();

        assert!(vault.join("note.md").exists());
        let content = fs::read_to_string(vault.join("note.md")).unwrap();
        assert_eq!(content, "# Original\n");
    }

    #[test]
    fn test_discard_rejects_path_outside_vault() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        write_and_commit_markdown(vault, vp, "init.md", "# Init\n");

        let result = discard_file_changes(vp, "../../../etc/passwd");
        assert!(
            result.is_err(),
            "Should reject path outside vault, got: {:?}",
            result
        );
        assert!(
            result.unwrap_err().contains("outside the vault"),
            "Error should mention 'outside the vault'"
        );
    }
}
