use std::path::Path;

use git2::{Commit, Diff, DiffFormat, DiffOptions, Repository};

use super::repo;
use super::GitCommit;
use crate::vault::path_identity::vault_relative_path_string;

/// How many commits the file-history panel shows.
const HISTORY_LIMIT: usize = 20;

/// Get git log history for a specific file in the vault.
pub fn get_file_history(vault_path: &str, file_path: &str) -> Result<Vec<GitCommit>, String> {
    let vault = Path::new(vault_path);
    let relative = vault_relative_path_string(vault, Path::new(file_path))?;
    let repository = open_vault(vault)?;

    file_history(&repository, &relative).map_err(read_failure)
}

fn file_history(repository: &Repository, relative: &str) -> Result<Vec<GitCommit>, git2::Error> {
    let mut history = Vec::new();

    for oid in repo::head_commits(repository)? {
        if history.len() >= HISTORY_LIMIT {
            break;
        }

        let commit = repository.find_commit(oid)?;
        if !touches_path(repository, &commit, relative)? {
            continue;
        }

        history.push(describe_commit(&commit)?);
    }

    Ok(history)
}

fn touches_path(
    repository: &Repository,
    commit: &Commit,
    relative: &str,
) -> Result<bool, git2::Error> {
    Ok(repo::changed_files(repository, commit)?
        .iter()
        .any(|changed| changed.path == relative))
}

fn describe_commit(commit: &Commit) -> Result<GitCommit, git2::Error> {
    Ok(GitCommit {
        hash: commit.id().to_string(),
        short_hash: repo::short_hash(commit)?,
        author: commit.author().name().unwrap_or_default().to_string(),
        date: repo::author_timestamp(commit),
        message: commit.summary()?.unwrap_or_default().to_string(),
    })
}

/// Get git diff for a specific file.
///
/// Prefers unstaged changes, falls back to staged ones, and finally renders an
/// untracked file as entirely added.
pub fn get_file_diff(vault_path: &str, file_path: &str) -> Result<String, String> {
    let vault = Path::new(vault_path);
    let file = Path::new(file_path);
    let relative = vault_relative_path_string(vault, file)?;
    let repository = open_vault(vault)?;

    let unstaged = unstaged_diff(&repository, &relative).map_err(read_failure)?;
    if !unstaged.is_empty() {
        return Ok(unstaged);
    }

    let staged = staged_diff(&repository, &relative).map_err(read_failure)?;
    if !staged.is_empty() {
        return Ok(staged);
    }

    if is_untracked(&repository, &relative) {
        let content =
            std::fs::read_to_string(file).map_err(|e| format!("Failed to read file: {}", e))?;
        return Ok(added_file_patch(&relative, &content));
    }

    Ok(String::new())
}

fn unstaged_diff(repository: &Repository, relative: &str) -> Result<String, git2::Error> {
    let mut options = path_options(relative);
    let diff = repository.diff_index_to_workdir(None, Some(&mut options))?;
    render_patch(&diff)
}

fn staged_diff(repository: &Repository, relative: &str) -> Result<String, git2::Error> {
    let head_tree = match repo::head_commit(repository)? {
        Some(commit) => Some(commit.tree()?),
        None => None,
    };
    let mut options = path_options(relative);
    let diff = repository.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut options))?;
    render_patch(&diff)
}

fn is_untracked(repository: &Repository, relative: &str) -> bool {
    repository
        .status_file(Path::new(relative))
        .map(|status| status.is_wt_new())
        .unwrap_or(false)
}

/// Get git diff for a specific file at a given commit (compared to its parent).
pub fn get_file_diff_at_commit(
    vault_path: &str,
    file_path: &str,
    commit_hash: &str,
) -> Result<String, String> {
    let vault = Path::new(vault_path);
    let relative = vault_relative_path_string(vault, Path::new(file_path))?;
    let repository = open_vault(vault)?;

    commit_diff(&repository, commit_hash, &relative).map_err(read_failure)
}

/// Diff a commit against its first parent. A root commit has no parent, so it
/// diffs against the empty tree and every line reads as added.
fn commit_diff(
    repository: &Repository,
    commit_hash: &str,
    relative: &str,
) -> Result<String, git2::Error> {
    let commit = repository.revparse_single(commit_hash)?.peel_to_commit()?;
    let tree = commit.tree()?;
    let parent_tree = match commit.parent(0) {
        Ok(parent) => Some(parent.tree()?),
        Err(_) => None,
    };

    let mut options = path_options(relative);
    let diff =
        repository.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))?;
    render_patch(&diff)
}

/// Restrict a diff to one file. Pathspec matching is disabled so the path is
/// compared literally — note titles routinely contain glob characters.
fn path_options(relative: &str) -> DiffOptions {
    let mut options = DiffOptions::new();
    options.pathspec(relative);
    options.disable_pathspec_match(true);
    options
}

/// Render a diff as unified patch text, the format `DiffView` renders.
fn render_patch(diff: &Diff) -> Result<String, git2::Error> {
    let mut patch = String::new();

    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        // Context and +/- lines carry their marker in `origin`; header lines
        // already include their own leading text.
        if matches!(line.origin(), '+' | '-' | ' ') {
            patch.push(line.origin());
        }

        let content = String::from_utf8_lossy(line.content());
        if line.origin() == 'F' {
            patch.push_str(&unquote_paths(&content));
        } else {
            patch.push_str(&content);
        }
        true
    })?;

    Ok(patch)
}

/// libgit2 escapes non-ASCII bytes in patch file headers, the way git does with
/// `core.quotePath=true`. The CLI path turned that off globally; do the same here
/// so a note named 中文笔记.md reads as itself rather than as octal escapes.
fn unquote_paths(header: &str) -> String {
    let mut out = String::new();
    let mut rest = header;

    while let Some(start) = rest.find('"') {
        out.push_str(&rest[..start]);
        let quoted = &rest[start + 1..];
        match find_closing_quote(quoted) {
            Some(end) => {
                out.push_str(&unescape(&quoted[..end]));
                rest = &quoted[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                return out;
            }
        }
    }

    out.push_str(rest);
    out
}

fn find_closing_quote(quoted: &str) -> Option<usize> {
    let bytes = quoted.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'\\' => index += 2,
            b'"' => return Some(index),
            _ => index += 1,
        }
    }

    None
}

fn unescape(escaped: &str) -> String {
    let bytes = escaped.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] != b'\\' {
            out.push(bytes[index]);
            index += 1;
            continue;
        }

        index += 1;
        index += push_escaped(&mut out, escaped, index);
    }

    String::from_utf8_lossy(&out).to_string()
}

/// Decode one escape sequence, returning how many characters it consumed.
fn push_escaped(out: &mut Vec<u8>, escaped: &str, index: usize) -> usize {
    let bytes = escaped.as_bytes();

    match bytes.get(index) {
        Some(b'n') => push_one(out, b'\n'),
        Some(b't') => push_one(out, b'\t'),
        Some(b'r') => push_one(out, b'\r'),
        Some(b'\\') => push_one(out, b'\\'),
        Some(b'"') => push_one(out, b'"'),
        Some(digit) if digit.is_ascii_digit() => push_octal(out, escaped, index),
        _ => push_one(out, b'\\') - 1,
    }
}

fn push_one(out: &mut Vec<u8>, byte: u8) -> usize {
    out.push(byte);
    1
}

fn push_octal(out: &mut Vec<u8>, escaped: &str, index: usize) -> usize {
    let end = (index + 3).min(escaped.len());
    match u8::from_str_radix(&escaped[index..end], 8) {
        Ok(byte) => {
            out.push(byte);
            end - index
        }
        Err(_) => push_one(out, b'\\') - 1,
    }
}

fn added_file_patch(relative: &str, content: &str) -> String {
    let lines: Vec<String> = content.lines().map(|line| format!("+{}", line)).collect();
    format!(
        "diff --git a/{0} b/{0}\nnew file\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n{2}",
        relative,
        lines.len(),
        lines.join("\n")
    )
}

fn open_vault(vault: &Path) -> Result<Repository, String> {
    repo::open(vault).map_err(|error| format!("Failed to open git repository: {}", error.message()))
}

fn read_failure(error: git2::Error) -> String {
    format!("Failed to read git history: {}", error.message())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::git_command;
    use crate::git::tests::setup_git_repo;
    use std::{fs, path::PathBuf};

    fn write_and_commit_file(
        vault: &Path,
        relative_path: &str,
        content: &str,
        message: &str,
    ) -> PathBuf {
        let file = vault.join(relative_path);
        fs::write(&file, content).unwrap();
        git_command()
            .args(["add", relative_path])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", message])
            .current_dir(vault)
            .output()
            .unwrap();
        file
    }

    fn head_hash(vault: &Path) -> String {
        let log = git_command()
            .args(["log", "--format=%H", "-1"])
            .current_dir(vault)
            .output()
            .unwrap();
        String::from_utf8_lossy(&log.stdout).trim().to_string()
    }

    #[test]
    fn test_unquote_paths_decodes_octal_escapes() {
        let header = "diff --git \"a/\\344\\270\\255.md\" \"b/\\344\\270\\255.md\"\n";

        assert_eq!(unquote_paths(header), "diff --git a/中.md b/中.md\n");
    }

    #[test]
    fn test_unquote_paths_leaves_plain_headers_untouched() {
        let header = "diff --git a/note.md b/note.md\n";

        assert_eq!(unquote_paths(header), header);
    }

    #[test]
    fn test_unquote_paths_handles_escaped_quotes_and_tabs() {
        let header = "--- \"a/od\\\"d\\tname.md\"\n";

        assert_eq!(unquote_paths(header), "--- a/od\"d\tname.md\n");
    }

    #[test]
    fn test_unquote_paths_keeps_unterminated_quote_verbatim() {
        let header = "--- \"a/broken.md\n";

        assert_eq!(unquote_paths(header), header);
    }

    #[test]
    fn test_get_file_history_with_commits() {
        let dir = setup_git_repo();
        let vault = dir.path();

        let file = write_and_commit_file(vault, "test.md", "# Initial\n", "Initial commit");
        write_and_commit_file(vault, "test.md", "# Updated\n\nNew content.", "Update test");

        let history = get_file_history(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].message, "Update test");
        assert_eq!(history[1].message, "Initial commit");
        assert_eq!(history[0].author, "Test User");
        assert!(!history[0].hash.is_empty());
        assert!(!history[0].short_hash.is_empty());
    }

    #[test]
    fn test_get_file_history_ignores_other_files() {
        let dir = setup_git_repo();
        let vault = dir.path();

        let file = write_and_commit_file(vault, "kept.md", "# Kept\n", "Add kept");
        write_and_commit_file(vault, "other.md", "# Other\n", "Add other");

        let history = get_file_history(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].message, "Add kept");
    }

    #[test]
    fn test_get_file_history_no_commits() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let file = vault.join("new.md");
        fs::write(&file, "# New\n").unwrap();

        let history = get_file_history(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();

        assert!(history.is_empty());
    }

    #[test]
    fn test_get_file_diff() {
        let dir = setup_git_repo();
        let vault = dir.path();

        let file = write_and_commit_file(
            vault,
            "diff-test.md",
            "# Test\n\nOriginal content.",
            "Add diff-test",
        );

        fs::write(&file, "# Test\n\nModified content.").unwrap();

        let diff = get_file_diff(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();

        assert!(!diff.is_empty());
        assert!(diff.contains("-Original content."));
        assert!(diff.contains("+Modified content."));
    }

    #[test]
    fn test_get_file_diff_reports_staged_changes() {
        let dir = setup_git_repo();
        let vault = dir.path();

        let file = write_and_commit_file(vault, "staged.md", "# Staged\n\nBefore.\n", "Add staged");
        fs::write(&file, "# Staged\n\nAfter.\n").unwrap();
        git_command()
            .args(["add", "staged.md"])
            .current_dir(vault)
            .output()
            .unwrap();

        let diff = get_file_diff(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();

        assert!(diff.contains("-Before."));
        assert!(diff.contains("+After."));
    }

    #[test]
    fn test_get_file_diff_renders_untracked_file_as_added() {
        let dir = setup_git_repo();
        let vault = dir.path();
        write_and_commit_file(vault, "seed.md", "# Seed\n", "Add seed");

        let file = vault.join("untracked.md");
        fs::write(&file, "# Fresh\nBody line\n").unwrap();

        let diff = get_file_diff(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();

        assert!(diff.contains("diff --git a/untracked.md b/untracked.md"));
        assert!(diff.contains("+# Fresh"));
        assert!(diff.contains("+Body line"));
    }

    #[test]
    fn test_get_file_diff_is_empty_for_unchanged_file() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let file = write_and_commit_file(vault, "clean.md", "# Clean\n", "Add clean");

        let diff = get_file_diff(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();

        assert!(diff.is_empty());
    }

    #[test]
    fn test_get_file_diff_at_commit() {
        let dir = setup_git_repo();
        let vault = dir.path();

        let file = write_and_commit_file(
            vault,
            "diff-at-commit.md",
            "# First\n\nOriginal content.",
            "First commit",
        );
        write_and_commit_file(
            vault,
            "diff-at-commit.md",
            "# First\n\nModified content.",
            "Second commit",
        );

        let hash = head_hash(vault);

        let diff = get_file_diff_at_commit(vault.to_str().unwrap(), file.to_str().unwrap(), &hash)
            .unwrap();

        assert!(!diff.is_empty());
        assert!(diff.contains("-Original content."));
        assert!(diff.contains("+Modified content."));
    }

    #[test]
    fn test_get_file_diff_at_initial_commit() {
        let dir = setup_git_repo();
        let vault = dir.path();

        let file = write_and_commit_file(
            vault,
            "initial.md",
            "# Initial\n\nHello world.",
            "Initial commit",
        );

        let hash = head_hash(vault);

        let diff = get_file_diff_at_commit(vault.to_str().unwrap(), file.to_str().unwrap(), &hash)
            .unwrap();

        assert!(!diff.is_empty());
        assert!(diff.contains("+# Initial"));
        assert!(diff.contains("+Hello world."));
    }

    #[test]
    fn test_get_file_diff_at_commit_accepts_short_hash() {
        let dir = setup_git_repo();
        let vault = dir.path();

        let file = write_and_commit_file(vault, "short.md", "# Short\n", "Add short");
        let hash = head_hash(vault);

        let diff =
            get_file_diff_at_commit(vault.to_str().unwrap(), file.to_str().unwrap(), &hash[..7])
                .unwrap();

        assert!(diff.contains("+# Short"));
    }

    #[test]
    fn test_get_file_diff_at_commit_preserves_chinese_filename_and_content() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let relative_path = "中文笔记.md";
        let file = vault.join(relative_path);

        write_and_commit_file(
            vault,
            relative_path,
            "# 初始\n\n第一行\n",
            "Add Chinese note",
        );
        write_and_commit_file(
            vault,
            relative_path,
            "# 初始\n\n第二行\n",
            "Update Chinese note",
        );
        let hash = head_hash(vault);

        let diff = get_file_diff_at_commit(vault.to_str().unwrap(), file.to_str().unwrap(), &hash)
            .unwrap();

        assert!(diff.contains("diff --git a/中文笔记.md b/中文笔记.md"));
        assert!(diff.contains("-第一行"));
        assert!(diff.contains("+第二行"));
        assert!(!diff.contains("\\344"));
    }
}
