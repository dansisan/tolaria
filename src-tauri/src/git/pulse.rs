use serde::Serialize;
use std::path::Path;

use git2::{Commit, Repository};

use super::{parse_github_repo_path, repo};

#[derive(Debug, Serialize, Clone)]
pub struct PulseFile {
    pub path: String,
    pub status: String,
    pub title: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PulseCommit {
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub message: String,
    pub date: i64,
    #[serde(rename = "githubUrl")]
    pub github_url: Option<String>,
    pub files: Vec<PulseFile>,
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct LastCommitInfo {
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    #[serde(rename = "commitUrl")]
    pub commit_url: Option<String>,
}

fn title_from_path(path: &str) -> String {
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .strip_suffix(".md")
        .unwrap_or(path)
        .replace('-', " ")
}

/// Get the pulse (commit activity feed) for a vault, showing only .md file changes.
/// `skip` offsets into the commit list for pagination; `limit` caps how many to return.
pub fn get_vault_pulse(
    vault_path: &str,
    limit: usize,
    skip: usize,
) -> Result<Vec<PulseCommit>, String> {
    let vault = Path::new(vault_path);

    if !vault.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }

    let repository = repo::open(vault)
        .map_err(|error| format!("Failed to open git repository: {}", error.message()))?;
    let github_base = github_base_url(&repository);

    collect_pulse(&repository, limit, skip, &github_base)
        .map_err(|error| format!("Failed to read git history: {}", error.message()))
}

/// Walk history newest-first, keeping only commits that touched a note, then
/// apply pagination to that filtered list — the same shape as
/// `git log -n <limit> --skip <skip> -- '*.md'`.
fn collect_pulse(
    repository: &Repository,
    limit: usize,
    skip: usize,
    github_base: &Option<String>,
) -> Result<Vec<PulseCommit>, git2::Error> {
    let mut commits = Vec::new();
    let mut skipped = 0;

    for oid in repo::head_commits(repository)? {
        if commits.len() >= limit {
            break;
        }

        let commit = repository.find_commit(oid)?;
        let files = note_files(repository, &commit)?;
        if files.is_empty() {
            continue;
        }

        if skipped < skip {
            skipped += 1;
            continue;
        }

        commits.push(pulse_commit(&commit, files, github_base)?);
    }

    Ok(commits)
}

fn note_files(repository: &Repository, commit: &Commit) -> Result<Vec<PulseFile>, git2::Error> {
    Ok(repo::changed_files(repository, commit)?
        .into_iter()
        .filter(|changed| changed.path.ends_with(".md"))
        .map(|changed| PulseFile {
            title: title_from_path(&changed.path),
            status: changed.status.to_string(),
            path: changed.path,
        })
        .collect())
}

fn pulse_commit(
    commit: &Commit,
    files: Vec<PulseFile>,
    github_base: &Option<String>,
) -> Result<PulseCommit, git2::Error> {
    let hash = commit.id().to_string();

    Ok(PulseCommit {
        short_hash: repo::short_hash(commit)?,
        message: commit.summary()?.unwrap_or_default().to_string(),
        date: repo::author_timestamp(commit),
        github_url: github_base
            .as_ref()
            .map(|base| format!("{}/commit/{}", base, hash)),
        added: count_with_status(&files, "added"),
        modified: count_with_status(&files, "modified"),
        deleted: count_with_status(&files, "deleted"),
        files,
        hash,
    })
}

fn count_with_status(files: &[PulseFile], status: &str) -> usize {
    files.iter().filter(|file| file.status == status).count()
}

fn github_base_url(repository: &Repository) -> Option<String> {
    let remote = repository.find_remote("origin").ok()?;
    let repo_path = parse_github_repo_path(remote.url().ok()?)?;
    Some(format!("https://github.com/{}", repo_path))
}

/// Get the last commit's short hash and a GitHub URL (if remote is GitHub).
pub fn get_last_commit_info(vault_path: &str) -> Result<Option<LastCommitInfo>, String> {
    let repository = repo::open(Path::new(vault_path))
        .map_err(|error| format!("Failed to open git repository: {}", error.message()))?;

    last_commit_info(&repository)
        .map_err(|error| format!("Failed to read git history: {}", error.message()))
}

fn last_commit_info(repository: &Repository) -> Result<Option<LastCommitInfo>, git2::Error> {
    let Some(commit) = repo::head_commit(repository)? else {
        return Ok(None);
    };

    let commit_url =
        github_base_url(repository).map(|base| format!("{}/commit/{}", base, commit.id()));

    Ok(Some(LastCommitInfo {
        short_hash: repo::short_hash(&commit)?,
        commit_url,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::git_command;
    use crate::git::git_commit;
    use crate::git::tests::setup_git_repo;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    fn add_origin(vault: &Path, url: &str) {
        git_command()
            .args(["remote", "add", "origin", url])
            .current_dir(vault)
            .output()
            .unwrap();
    }

    #[test]
    fn test_get_vault_pulse_with_commits() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "Add note").unwrap();

        fs::write(vault.join("project.md"), "# Project\n").unwrap();
        git_commit(vp, "Add project").unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();

        assert_eq!(pulse.len(), 2);
        assert_eq!(pulse[0].message, "Add project");
        assert_eq!(pulse[1].message, "Add note");
        assert_eq!(pulse[0].files.len(), 1);
        assert_eq!(pulse[0].files[0].path, "project.md");
        assert_eq!(pulse[0].files[0].status, "added");
        assert_eq!(pulse[0].added, 1);
        assert_eq!(pulse[0].modified, 0);
        assert!(!pulse[0].short_hash.is_empty());
    }

    #[test]
    fn test_get_vault_pulse_no_git() {
        let dir = TempDir::new().unwrap();
        let vp = dir.path().to_str().unwrap();

        let result = get_vault_pulse(vp, 30, 0);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a git repository"));
    }

    #[test]
    fn test_get_vault_pulse_empty_repo() {
        let dir = setup_git_repo();
        let vp = dir.path().to_str().unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert!(pulse.is_empty());
    }

    #[test]
    fn test_get_vault_pulse_only_md_files() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        fs::write(vault.join("config.json"), "{}").unwrap();
        git_commit(vp, "Add files").unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert_eq!(pulse.len(), 1);
        assert_eq!(pulse[0].files.len(), 1);
        assert_eq!(pulse[0].files[0].path, "note.md");
    }

    #[test]
    fn test_get_vault_pulse_respects_limit() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        for i in 0..5 {
            fs::write(
                vault.join(format!("note{}.md", i)),
                format!("# Note {}\n", i),
            )
            .unwrap();
            git_commit(vp, &format!("Add note {}", i)).unwrap();
        }

        let pulse = get_vault_pulse(vp, 3, 0).unwrap();
        assert_eq!(pulse.len(), 3);
    }

    #[test]
    fn test_get_vault_pulse_skip_paginates_past_newest_commits() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        for i in 0..4 {
            fs::write(
                vault.join(format!("note{}.md", i)),
                format!("# Note {}\n", i),
            )
            .unwrap();
            git_commit(vp, &format!("Add note {}", i)).unwrap();
        }

        let page = get_vault_pulse(vp, 2, 2).unwrap();

        assert_eq!(page.len(), 2);
        assert_eq!(page[0].message, "Add note 1");
        assert_eq!(page[1].message, "Add note 0");
    }

    #[test]
    fn test_get_vault_pulse_modified_and_deleted() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "Add note").unwrap();

        fs::write(vault.join("note.md"), "# Updated\n").unwrap();
        git_commit(vp, "Update note").unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert_eq!(pulse[0].message, "Update note");
        assert_eq!(pulse[0].files[0].status, "modified");
        assert_eq!(pulse[0].modified, 1);
    }

    #[test]
    fn test_get_vault_pulse_counts_deletions() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "Add note").unwrap();

        fs::remove_file(vault.join("note.md")).unwrap();
        git_commit(vp, "Delete note").unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();

        assert_eq!(pulse[0].files[0].status, "deleted");
        assert_eq!(pulse[0].deleted, 1);
        assert_eq!(pulse[0].added, 0);
    }

    #[test]
    fn test_get_vault_pulse_keeps_pipes_in_commit_messages() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "Add note | with a pipe").unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();

        assert_eq!(pulse[0].message, "Add note | with a pipe");
        assert!(pulse[0].date > 0);
    }

    #[test]
    fn test_get_vault_pulse_github_url() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "Add note").unwrap();

        Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/owner/repo.git",
            ])
            .current_dir(vault)
            .output()
            .unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert!(pulse[0].github_url.is_some());
        let url = pulse[0].github_url.as_ref().unwrap();
        assert!(url.starts_with("https://github.com/owner/repo/commit/"));
    }

    #[test]
    fn test_get_vault_pulse_no_github_url_without_remote() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "Add note").unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert!(pulse[0].github_url.is_none());
    }

    #[test]
    fn test_github_base_url_ignores_non_github_remotes() {
        let dir = setup_git_repo();
        let vault = dir.path();
        add_origin(vault, "https://gitlab.com/owner/repo.git");

        let repository = repo::open(vault).unwrap();

        assert!(github_base_url(&repository).is_none());
    }

    #[test]
    fn test_github_base_url_reads_origin() {
        let dir = setup_git_repo();
        let vault = dir.path();
        add_origin(vault, "git@github.com:owner/repo.git");

        let repository = repo::open(vault).unwrap();

        assert_eq!(
            github_base_url(&repository).as_deref(),
            Some("https://github.com/owner/repo")
        );
    }

    #[test]
    fn test_title_from_path() {
        assert_eq!(title_from_path("note/my-project.md"), "my project");
        assert_eq!(title_from_path("simple.md"), "simple");
        assert_eq!(title_from_path("deep/nested/file.md"), "file");
    }

    #[test]
    fn test_get_last_commit_info_with_commit() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "initial").unwrap();

        let info = get_last_commit_info(vp).unwrap();
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.short_hash.len(), 7);
        assert!(info.commit_url.is_none());
    }

    #[test]
    fn test_get_last_commit_info_no_commits() {
        let dir = setup_git_repo();
        let vp = dir.path().to_str().unwrap();

        let info = get_last_commit_info(vp).unwrap();
        assert!(info.is_none());
    }

    #[test]
    fn test_get_last_commit_info_no_git_repo() {
        let dir = TempDir::new().unwrap();
        let vp = dir.path().to_str().unwrap();

        assert!(get_last_commit_info(vp).is_err());
    }

    #[test]
    fn test_get_last_commit_info_with_github_remote() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "initial").unwrap();

        Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/lucaong/laputa-vault.git",
            ])
            .current_dir(vault)
            .output()
            .unwrap();

        let info = get_last_commit_info(vp).unwrap().unwrap();
        assert!(info.commit_url.is_some());
        let url = info.commit_url.unwrap();
        assert!(url.starts_with("https://github.com/lucaong/laputa-vault/commit/"));
    }
}
