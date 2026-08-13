//! Shared libgit2 primitives for the read-only git paths.
//!
//! Reads run through libgit2 in-process instead of shelling out to `git`: no
//! process spawn per call, and no parsing of CLI output whose wording shifts
//! between git versions and translations. Writes (commit, pull, push, clone)
//! stay on the CLI, where hooks, commit signing, credential helpers and `gc`
//! live.

use std::path::Path;

use git2::{Commit, Delta, DiffDelta, ErrorCode, Oid, Repository, Sort};

/// One file changed by a commit, mirroring a `git log --name-status` row.
pub(super) struct ChangedFile {
    pub path: String,
    pub status: &'static str,
}

pub(super) fn open(vault_path: &Path) -> Result<Repository, git2::Error> {
    Repository::open(vault_path)
}

/// The commit HEAD points at, or `None` when the repository has no commits yet.
///
/// The CLI paths treated git's "does not have any commits yet" as an empty
/// result rather than a failure, so an unborn HEAD maps to `None` here.
pub(super) fn head_commit(repo: &Repository) -> Result<Option<Commit<'_>>, git2::Error> {
    match repo.head() {
        Ok(head) => Ok(Some(head.peel_to_commit()?)),
        Err(error) if is_missing_head(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

/// Commits reachable from HEAD, newest first.
///
/// `TIME` alone leaves commits that share a timestamp in arbitrary order — easy
/// to hit, since a burst of auto-commits lands within the same second. Pairing
/// it with `TOPOLOGICAL` guarantees a commit is always listed before its
/// parents, so the feed stays in a sensible order regardless of clock
/// granularity.
pub(super) fn head_commits(repo: &Repository) -> Result<Vec<Oid>, git2::Error> {
    if head_commit(repo)?.is_none() {
        return Ok(Vec::new());
    }

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    walk.push_head()?;
    walk.collect()
}

fn is_missing_head(error: &git2::Error) -> bool {
    matches!(error.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound)
}

/// Files a commit changed relative to its first parent.
///
/// Merge commits report nothing, which is what `git log --name-only` prints for
/// them by default.
pub(super) fn changed_files(
    repo: &Repository,
    commit: &Commit,
) -> Result<Vec<ChangedFile>, git2::Error> {
    if commit.parent_count() > 1 {
        return Ok(Vec::new());
    }

    let tree = commit.tree()?;
    let parent_tree = match commit.parent(0) {
        Ok(parent) => Some(parent.tree()?),
        Err(_) => None,
    };
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;

    Ok(diff.deltas().filter_map(changed_file).collect())
}

fn changed_file(delta: DiffDelta<'_>) -> Option<ChangedFile> {
    let path = delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())?
        .to_string_lossy()
        .to_string();

    Some(ChangedFile {
        path,
        status: delta_status(delta.status()),
    })
}

/// Map a delta to the status vocabulary the frontend already consumes. Anything
/// that is not a clean add or delete counts as a modification, which is how the
/// `git log --name-status` parser classified codes other than `A` and `D`.
fn delta_status(delta: Delta) -> &'static str {
    match delta {
        Delta::Added => "added",
        Delta::Deleted => "deleted",
        _ => "modified",
    }
}

/// Abbreviated commit hash, using the same auto-scaled width as git's `%h`.
pub(super) fn short_hash(commit: &Commit) -> Result<String, git2::Error> {
    let short = commit.as_object().short_id()?;
    Ok(short.as_str().unwrap_or_default().to_string())
}

/// Author timestamp in seconds since the epoch, matching git's `%aI`/`%at`.
pub(super) fn author_timestamp(commit: &Commit) -> i64 {
    commit.author().when().seconds()
}
