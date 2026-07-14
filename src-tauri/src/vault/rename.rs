use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;
use walkdir::WalkDir;

use super::filename_rules::validate_filename_stem;
use super::parsing::extract_outgoing_links;
use super::path_identity::vault_relative_markdown_stem;
use super::rename_transaction::RenameWorkspace;
use super::VaultEntry;
use crate::frontmatter::{update_frontmatter_content, FrontmatterValue};

/// Result of a rename operation. The file move is already committed by the
/// time this is returned; `updated_files`/`failed_updates`/`updated_paths` are
/// always zero/empty here — the vault-wide wikilink rewrite runs afterward as
/// a background job (see `PendingWikilinkRewrite`) and reports its own result
/// separately, since scanning/rewriting every other note that links this one
/// is the slow part of a rename and callers shouldn't have to wait on it just
/// to learn the new path.
#[derive(Debug, Serialize, Deserialize)]
pub struct RenameResult {
    /// New absolute file path after rename
    pub new_path: String,
    /// Number of other files updated (wiki link replacements)
    pub updated_files: usize,
    /// Number of linked-note rewrites that failed and need manual attention
    pub failed_updates: usize,
    /// Absolute paths of the other notes whose wikilinks were rewritten, so the
    /// renderer can refresh just those entries instead of rescanning the vault.
    #[serde(default)]
    pub updated_paths: Vec<String>,
}

/// The result of the deferred wikilink rewrite, reported once it completes —
/// see `PendingWikilinkRewrite::run`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikilinkRewriteCompleted {
    pub old_path: String,
    pub new_path: String,
    pub updated_files: usize,
    pub failed_updates: usize,
    pub updated_paths: Vec<String>,
}

/// Everything needed to run a rename's vault-wide wikilink rewrite later, on a
/// background thread, after the caller already has the fast RenameResult in
/// hand. Holds owned data (not borrowed from the request) so it can move into
/// a spawned task. The candidate-narrowing vault scan is deferred to `run`
/// too — it exists only to speed up this background rewrite, so it must never
/// run on the rename's synchronous path (see ADR-0137).
pub struct PendingWikilinkRewrite {
    vault_path: std::path::PathBuf,
    old_targets: Vec<String>,
    new_target: String,
    exclude_path: std::path::PathBuf,
    old_path: String,
    new_path: String,
    /// Move-to-workspace touches both the source and destination vaults when
    /// they differ — this is the second one, rewritten with the same targets.
    additional_vault_path: Option<std::path::PathBuf>,
}

impl PendingWikilinkRewrite {
    fn noop(old_path: &str, new_path: &str) -> Self {
        Self {
            vault_path: std::path::PathBuf::new(),
            old_targets: Vec::new(),
            new_target: String::new(),
            exclude_path: std::path::PathBuf::new(),
            old_path: old_path.to_string(),
            new_path: new_path.to_string(),
            additional_vault_path: None,
        }
    }

    /// Runs the vault-wide wikilink rewrite. Blocking (a vault scan to narrow
    /// candidates, plus file I/O across potentially every note in the vault)
    /// — call from a blocking-safe context (e.g. `tokio::task::spawn_blocking`),
    /// not an async task.
    pub fn run(self) -> WikilinkRewriteCompleted {
        let entries = super::scan_vault_cached(&self.vault_path).ok();
        let old_targets: Vec<&str> = self.old_targets.iter().map(String::as_str).collect();
        let mut summary = update_wikilinks_in_vault(
            &self.vault_path,
            &old_targets,
            &self.new_target,
            &self.exclude_path,
            entries.as_deref(),
        );
        if let Some(additional_vault_path) = &self.additional_vault_path {
            let additional = update_wikilinks_in_vault(
                additional_vault_path,
                &old_targets,
                &self.new_target,
                &self.exclude_path,
                None,
            );
            summary.updated_files += additional.updated_files;
            summary.failed_updates += additional.failed_updates;
            summary.updated_paths.extend(additional.updated_paths);
        }
        WikilinkRewriteCompleted {
            old_path: self.old_path,
            new_path: self.new_path,
            updated_files: summary.updated_files,
            failed_updates: summary.failed_updates,
            updated_paths: summary.updated_paths,
        }
    }
}

#[derive(Clone, Copy)]
pub struct RenameNoteFilenameRequest<'a> {
    pub vault_path: &'a str,
    pub old_path: &'a str,
    pub new_filename_stem: &'a str,
}

#[derive(Clone, Copy)]
pub struct MoveNoteToFolderRequest<'a> {
    pub vault_path: &'a str,
    pub old_path: &'a str,
    pub destination_folder_path: &'a str,
}

#[derive(Clone, Copy)]
pub struct MoveNoteToWorkspaceRequest<'a> {
    pub source_vault_path: &'a str,
    pub destination_vault_path: &'a str,
    pub old_path: &'a str,
    pub destination_path: &'a str,
    pub replacement_target: Option<&'a str>,
}

#[derive(Debug, Default)]
struct WikilinkUpdateSummary {
    updated_files: usize,
    failed_updates: usize,
    /// Absolute paths of the files whose wikilinks were rewritten, so callers
    /// can refresh just those entries instead of rescanning the whole vault.
    updated_paths: Vec<String>,
}

/// Build a regex that matches wiki links referencing any of the provided targets.
fn build_wikilink_pattern(targets: &[&str]) -> Option<Regex> {
    let escaped_targets: Vec<String> = targets
        .iter()
        .filter(|target| !target.is_empty())
        .map(|target| regex::escape(target))
        .collect();
    if escaped_targets.is_empty() {
        return None;
    }
    let pattern_str = format!(r"\[\[(?:{})(\|[^\]]*?)?\]\]", escaped_targets.join("|"));
    Regex::new(&pattern_str).ok()
}

/// Check if a path is a vault markdown file eligible for wikilink replacement.
fn is_replaceable_md_file(path: &Path, exclude: &Path) -> bool {
    path.is_file() && path != exclude && path.extension().is_some_and(|ext| ext == "md")
}

/// Replace wikilink references in a single file's content. Returns updated content if changed.
fn replace_wikilinks_in_content(content: &str, re: &Regex, new_target: &str) -> Option<String> {
    if !re.is_match(content) {
        return None;
    }
    let replaced = re.replace_all(content, |caps: &regex::Captures| match caps.get(1) {
        Some(pipe) => format!("[[{}{}]]", new_target, pipe.as_str()),
        None => format!("[[{}]]", new_target),
    });
    if replaced != content {
        Some(replaced.into_owned())
    } else {
        None
    }
}

/// Collect all .md file paths in vault eligible for wikilink replacement.
fn collect_md_files(vault_path: &Path, exclude: &Path) -> Vec<std::path::PathBuf> {
    WalkDir::new(vault_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|e| e.into_path())
        .filter(|p| is_replaceable_md_file(p, exclude))
        .collect()
}

/// Every bare wikilink target a note references where the app recognizes links:
/// its body `[[target]]` links plus the targets inside every frontmatter
/// relationship value. Reserved structural keys (title, type, status, tags, …)
/// hold no inter-note links — the one that can, `type`, is folded into
/// `relationships` during parsing — so this is a superset of what the rename
/// regex matches for recognized links.
fn entry_link_targets(entry: &VaultEntry) -> HashSet<String> {
    let mut targets: HashSet<String> = entry.outgoing_links.iter().cloned().collect();
    for values in entry.relationships.values() {
        for value in values {
            targets.extend(extract_outgoing_links(value));
        }
    }
    targets
}

/// Narrow the vault to just the notes that reference one of `old_targets`, using
/// the already-parsed link sets in `entries` instead of reading every file. The
/// result is a superset of the files `collect_md_files` would yield a match for,
/// so the exact regex rewrite that follows produces identical output far faster.
fn collect_candidate_files(
    entries: &[VaultEntry],
    old_targets: &[&str],
    exclude: &Path,
) -> Vec<std::path::PathBuf> {
    let wanted: HashSet<&str> = old_targets
        .iter()
        .copied()
        .filter(|target| !target.is_empty())
        .collect();
    entries
        .iter()
        .filter(|entry| {
            entry_link_targets(entry)
                .iter()
                .any(|target| wanted.contains(target.as_str()))
        })
        .map(|entry| std::path::PathBuf::from(&entry.path))
        .filter(|path| is_replaceable_md_file(path, exclude))
        .collect()
}

fn unique_wikilink_targets(targets: Vec<&str>) -> Vec<&str> {
    let mut seen = HashSet::new();
    targets
        .into_iter()
        .filter(|target| !target.is_empty())
        .filter(|target| seen.insert(*target))
        .collect()
}

fn collect_legacy_wikilink_targets<'a>(old_title: &'a str, old_path_stem: &'a str) -> Vec<&'a str> {
    let old_filename_stem = old_path_stem.rsplit('/').next().unwrap_or(old_path_stem);
    unique_wikilink_targets(vec![old_title, old_path_stem, old_filename_stem])
}

/// Replace wiki link references across all vault markdown files.
fn update_wikilinks_in_vault(
    vault_path: &Path,
    old_targets: &[&str],
    new_target: &str,
    exclude_path: &Path,
    entries: Option<&[VaultEntry]>,
) -> WikilinkUpdateSummary {
    let re = match build_wikilink_pattern(old_targets) {
        Some(r) => r,
        None => return WikilinkUpdateSummary::default(),
    };
    let files = match entries {
        Some(entries) => collect_candidate_files(entries, old_targets, exclude_path),
        None => collect_md_files(vault_path, exclude_path),
    };
    replace_wikilinks_in_files(files, &re, new_target)
}

fn replace_wikilinks_in_files(
    files: Vec<std::path::PathBuf>,
    re: &Regex,
    replacement: &str,
) -> WikilinkUpdateSummary {
    let mut summary = WikilinkUpdateSummary::default();
    for path in files.iter() {
        match rewrite_wikilinks_in_file(path, re, replacement) {
            Ok(true) => {
                summary.updated_files += 1;
                summary.updated_paths.push(path.to_string_lossy().into_owned());
            }
            Ok(false) => {}
            Err(_) => summary.failed_updates += 1,
        }
    }
    summary
}

fn rewrite_wikilinks_in_file(path: &Path, re: &Regex, replacement: &str) -> Result<bool, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let Some(new_content) = replace_wikilinks_in_content(&content, re, replacement) else {
        return Ok(false);
    };

    fs::write(path, &new_content)
        .map(|_| true)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

/// Extract the value of the `title:` frontmatter field from raw content.
fn extract_fm_title_value(content: &str) -> Option<String> {
    if !content.starts_with("---\n") {
        return None;
    }
    let fm = content[4..].split("\n---").next()?;
    fm.lines()
        .map(str::trim_start)
        .find_map(extract_title_value_from_frontmatter_line)
}

fn extract_title_value_from_frontmatter_line(line: &str) -> Option<String> {
    ["title:", "\"title\":"]
        .iter()
        .find_map(|prefix| line.strip_prefix(prefix))
        .map(str::trim)
        .map(|value| value.trim_matches('"').trim_matches('\''))
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

/// Update the `title:` frontmatter field in content.
/// Always writes `title` to frontmatter (creates it if absent).
/// H1 headings are body content and are NOT modified — the title source
/// of truth is frontmatter `title:` → filename, never H1.
fn update_note_title_in_content(content: &str, new_title: &str) -> String {
    let value = FrontmatterValue::String(new_title.to_string());
    match update_frontmatter_content(content, "title", Some(value)) {
        Ok(c) => c,
        Err(_) => content.to_string(),
    }
}

/// Strip vault prefix and .md suffix to get the relative path stem (e.g., "project/weekly-review").
fn to_path_stem(path: &Path, vault_root: &Path) -> String {
    vault_relative_markdown_stem(path, vault_root)
}

pub(crate) fn recover_pending_rename_transactions(vault: &Path) -> Result<(), String> {
    super::rename_transaction::recover_pending_rename_transactions(vault)
}

fn finalize_rename(
    vault: &Path,
    old_path: &str,
    old_targets: &[&str],
    new_file: &Path,
) -> (RenameResult, PendingWikilinkRewrite) {
    let new_path = new_file.to_string_lossy().to_string();
    let new_path_stem = to_path_stem(new_file, vault);
    let pending = PendingWikilinkRewrite {
        vault_path: vault.to_path_buf(),
        old_targets: old_targets.iter().map(|target| target.to_string()).collect(),
        new_target: new_path_stem,
        exclude_path: new_file.to_path_buf(),
        old_path: old_path.to_string(),
        new_path: new_path.clone(),
        additional_vault_path: None,
    };
    (
        RenameResult {
            new_path,
            updated_files: 0,
            failed_updates: 0,
            updated_paths: Vec::new(),
        },
        pending,
    )
}

fn create_new_note_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                "A note with that name already exists".to_string()
            } else {
                format!("Failed to create {}: {}", path.display(), e)
            }
        })?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync {}: {}", path.display(), e))
}

fn remove_created_file(path: &Path) {
    let _ = fs::remove_file(path);
}

fn normalize_filename_stem(new_filename_stem: &str) -> Result<String, String> {
    let trimmed = new_filename_stem.trim();
    let stem = trimmed.strip_suffix(".md").unwrap_or(trimmed).trim();
    if stem.is_empty() {
        return Err("New filename cannot be empty".to_string());
    }
    validate_filename_stem(stem)?;
    Ok(stem.to_string())
}

fn unchanged_result(path: &Path) -> (RenameResult, PendingWikilinkRewrite) {
    let path_str = path.to_string_lossy().to_string();
    (
        RenameResult {
            new_path: path_str.clone(),
            updated_files: 0,
            failed_updates: 0,
            updated_paths: Vec::new(),
        },
        PendingWikilinkRewrite::noop(&path_str, &path_str),
    )
}

fn ensure_existing_note(old_file: &Path) -> Result<(), String> {
    if old_file.exists() {
        return Ok(());
    }
    Err(format!("File does not exist: {}", old_file.display()))
}

/// Rename only the file path stem while preserving title/frontmatter content.
/// The vault-wide wikilink update runs later, on a background thread — see
/// [`PendingWikilinkRewrite`].
pub fn rename_note_filename(
    request: RenameNoteFilenameRequest<'_>,
) -> Result<(RenameResult, PendingWikilinkRewrite), String> {
    let vault = Path::new(request.vault_path);
    let old_file = Path::new(request.old_path);

    recover_pending_rename_transactions(vault)?;

    if !old_file.exists() {
        return Err(format!("File does not exist: {}", old_file.display()));
    }

    let normalized_stem = normalize_filename_stem(request.new_filename_stem)?;
    let old_filename = old_file
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let content = fs::read_to_string(old_file)
        .map_err(|e| format!("Failed to read {}: {}", request.old_path, e))?;
    let fm_title = extract_fm_title_value(&content);
    let old_title = super::extract_title(fm_title.as_deref(), &content, &old_filename);
    let new_filename = format!("{}.md", normalized_stem);

    if old_filename == new_filename {
        return Ok(unchanged_result(old_file));
    }

    // When the frontmatter title exactly mirrors the old filename stem (e.g.
    // notes created via the date-picker flow), keep it in sync with the new
    // name — otherwise it stays stale forever, since a filename-only rename
    // otherwise leaves content untouched.
    let old_stem = old_filename.strip_suffix(".md").unwrap_or(&old_filename);
    let content = if fm_title.as_deref() == Some(old_stem) {
        update_note_title_in_content(&content, &normalized_stem)
    } else {
        content
    };

    let parent_dir = old_file
        .parent()
        .ok_or("Cannot determine parent directory")?;
    let new_file = parent_dir.join(&new_filename);
    let workspace = RenameWorkspace::new(vault)?;
    let committed = workspace
        .operation(request.old_path, old_file)
        .rename_exact(workspace.stage_note_content(&content)?, &new_file)?;

    let old_path_stem = to_path_stem(old_file, vault);
    let old_targets = collect_legacy_wikilink_targets(&old_title, &old_path_stem);
    Ok(finalize_rename(
        vault,
        request.old_path,
        &old_targets,
        committed.new_file(),
    ))
}

/// Move a note into a different folder while preserving its filename and content.
/// The vault-wide wikilink update runs later, on a background thread — see
/// [`PendingWikilinkRewrite`].
pub fn move_note_to_folder(
    request: MoveNoteToFolderRequest<'_>,
) -> Result<(RenameResult, PendingWikilinkRewrite), String> {
    let vault = Path::new(request.vault_path);
    let old_file = Path::new(request.old_path);
    let destination_dir = Path::new(request.destination_folder_path);

    recover_pending_rename_transactions(vault)?;
    ensure_existing_note(old_file)?;

    if !destination_dir.exists() {
        return Err(format!(
            "Folder does not exist: {}",
            request.destination_folder_path
        ));
    }
    if !destination_dir.is_dir() {
        return Err(format!(
            "Folder is not a directory: {}",
            request.destination_folder_path
        ));
    }

    let old_filename = old_file
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let content = fs::read_to_string(old_file)
        .map_err(|e| format!("Failed to read {}: {}", request.old_path, e))?;
    let fm_title = extract_fm_title_value(&content);
    let old_title = super::extract_title(fm_title.as_deref(), &content, &old_filename);
    let new_file = destination_dir.join(&old_filename);

    if new_file == old_file {
        return Ok(unchanged_result(old_file));
    }

    let workspace = RenameWorkspace::new(vault)?;
    let committed = workspace
        .operation(request.old_path, old_file)
        .rename_exact(workspace.stage_note_content(&content)?, &new_file)?;

    let old_path_stem = to_path_stem(old_file, vault);
    let old_targets = collect_legacy_wikilink_targets(&old_title, &old_path_stem);
    Ok(finalize_rename(
        vault,
        request.old_path,
        &old_targets,
        committed.new_file(),
    ))
}

/// Move a note into another workspace while preserving its vault-relative path.
pub fn move_note_to_workspace(
    request: MoveNoteToWorkspaceRequest<'_>,
) -> Result<(RenameResult, PendingWikilinkRewrite), String> {
    let source_vault = Path::new(request.source_vault_path);
    let destination_vault = Path::new(request.destination_vault_path);
    let old_file = Path::new(request.old_path);
    let new_file = Path::new(request.destination_path);

    recover_pending_rename_transactions(source_vault)?;
    recover_pending_rename_transactions(destination_vault)?;
    ensure_existing_note(old_file)?;

    if new_file == old_file {
        return Ok(unchanged_result(old_file));
    }
    if new_file.exists() {
        return Err("A note with that name already exists".to_string());
    }

    let content = fs::read_to_string(old_file)
        .map_err(|e| format!("Failed to read {}: {}", request.old_path, e))?;
    let old_filename = old_file
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let fm_title = extract_fm_title_value(&content);
    let old_title = super::extract_title(fm_title.as_deref(), &content, &old_filename);

    create_new_note_file(new_file, &content)?;
    if let Err(error) = fs::remove_file(old_file) {
        remove_created_file(new_file);
        return Err(format!(
            "Failed to remove {}: {}",
            old_file.display(),
            error
        ));
    }

    let old_path_stem = to_path_stem(old_file, source_vault);
    let old_targets = collect_legacy_wikilink_targets(&old_title, &old_path_stem);
    let fallback_target = to_path_stem(new_file, destination_vault);
    let replacement_target = request
        .replacement_target
        .unwrap_or(&fallback_target)
        .to_string();
    let new_path = new_file.to_string_lossy().to_string();
    let pending = PendingWikilinkRewrite {
        vault_path: source_vault.to_path_buf(),
        old_targets: old_targets.iter().map(|target| target.to_string()).collect(),
        new_target: replacement_target,
        exclude_path: new_file.to_path_buf(),
        old_path: request.old_path.to_string(),
        new_path: new_path.clone(),
        additional_vault_path: if source_vault == destination_vault {
            None
        } else {
            Some(destination_vault.to_path_buf())
        },
    };
    Ok((
        RenameResult {
            new_path,
            updated_files: 0,
            failed_updates: 0,
            updated_paths: Vec::new(),
        },
        pending,
    ))
}

/// A detected rename: old path → new path (both relative to vault root).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DetectedRename {
    pub old_path: String,
    pub new_path: String,
}

/// Detect renamed files by comparing working tree against HEAD using git diff.
pub fn detect_renames(vault: &Path) -> Result<Vec<DetectedRename>, String> {
    let output = crate::git::git_command()
        .args(["diff", "HEAD", "--name-status", "--diff-filter=R", "-M"])
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git diff: {e}"))?;

    if !output.status.success() {
        return Ok(vec![]); // No HEAD yet or other git issue — no renames
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let renames: Vec<DetectedRename> = stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 && parts[0].starts_with('R') {
                let old = parts[1].to_string();
                let new = parts[2].to_string();
                if old.ends_with(".md") && new.ends_with(".md") {
                    return Some(DetectedRename {
                        old_path: old,
                        new_path: new,
                    });
                }
            }
            None
        })
        .collect();

    Ok(renames)
}

/// Update wikilinks across the vault for a list of detected renames.
/// Returns the total number of files updated.
pub fn update_wikilinks_for_renames(
    vault: &Path,
    renames: &[DetectedRename],
) -> Result<usize, String> {
    let mut total_updated = 0;

    for rename in renames {
        let old_file = vault.join(&rename.old_path);
        let new_file = vault.join(&rename.new_path);
        let old_stem = to_path_stem(&old_file, vault);
        let new_stem = to_path_stem(&new_file, vault);
        let old_filename_stem = old_stem.split('/').next_back().unwrap_or(&old_stem);
        // Build title from filename stem (kebab-case → Title Case)
        let old_title = super::parsing::slug_to_title(old_filename_stem);
        let old_targets = collect_legacy_wikilink_targets(&old_title, &old_stem);
        let summary = update_wikilinks_in_vault(vault, &old_targets, &new_stem, &new_file, None);
        total_updated += summary.updated_files;
    }

    Ok(total_updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    /// Test-only helpers that run a rename and immediately resolve its
    /// deferred wikilink rewrite, merging the result back into a single
    /// `RenameResult` — reproducing the pre-decoupling synchronous shape so
    /// the many existing tests below don't each need to juggle the
    /// (RenameResult, PendingWikilinkRewrite) split by hand.
    fn resolve(outcome: Result<(RenameResult, PendingWikilinkRewrite), String>) -> Result<RenameResult, String> {
        let (mut result, pending) = outcome?;
        let completed = pending.run();
        result.updated_files = completed.updated_files;
        result.failed_updates = completed.failed_updates;
        result.updated_paths = completed.updated_paths;
        Ok(result)
    }

    fn rename_note_filename_sync(request: RenameNoteFilenameRequest<'_>) -> Result<RenameResult, String> {
        resolve(rename_note_filename(request))
    }

    fn move_note_to_folder_sync(request: MoveNoteToFolderRequest<'_>) -> Result<RenameResult, String> {
        resolve(move_note_to_folder(request))
    }

    fn move_note_to_workspace_sync(
        request: MoveNoteToWorkspaceRequest<'_>,
    ) -> Result<RenameResult, String> {
        resolve(move_note_to_workspace(request))
    }

    fn create_test_file(dir: &Path, name: impl AsRef<Path>, content: impl AsRef<[u8]>) {
        let file_path = dir.join(name);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(file_path).unwrap();
        file.write_all(content.as_ref()).unwrap();
    }

    fn create_current_note(vault: &Path, relative_path: impl AsRef<Path>) -> std::path::PathBuf {
        let relative_path = relative_path.as_ref();
        create_test_file(vault, relative_path, "# Current\n");
        vault.join(relative_path)
    }

    fn run_git(vault: &Path, args: &[&str]) {
        let output = crate::hidden_command("git")
            .args(args)
            .current_dir(vault)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_git_repo_with_quoted_paths(vault: &Path) {
        run_git(vault, &["init"]);
        run_git(vault, &["config", "user.email", "test@test.com"]);
        run_git(vault, &["config", "user.name", "Test"]);
        run_git(vault, &["config", "core.quotePath", "true"]);
    }

    fn assert_rename_note_filename_error<P>(
        new_filename_stem: impl AsRef<str>,
        existing_destination: Option<P>,
        expected_error: impl AsRef<str>,
    ) where
        P: AsRef<Path>,
    {
        let dir = TempDir::new().unwrap();
        let vault = dir.path();
        let current_path = create_current_note(vault, "note/current.md");
        if let Some(existing_path) = existing_destination {
            create_test_file(vault, existing_path.as_ref(), "# Existing\n");
        }

        let result = rename_note_filename_sync(RenameNoteFilenameRequest {
            vault_path: vault.to_str().unwrap(),
            old_path: current_path.to_str().unwrap(),
            new_filename_stem: new_filename_stem.as_ref(),
        });

        assert_eq!(result.unwrap_err(), expected_error.as_ref());
    }

    fn assert_move_note_to_folder_error(expected_error: impl AsRef<str>) {
        let dir = TempDir::new().unwrap();
        let vault = dir.path();
        create_test_file(vault, "projects/weekly-review.md", "# Weekly Review\n");
        create_test_file(vault, "areas/weekly-review.md", "# Existing\n");

        let result = move_note_to_folder_sync(MoveNoteToFolderRequest {
            vault_path: vault.to_str().unwrap(),
            old_path: vault.join("projects/weekly-review.md").to_str().unwrap(),
            destination_folder_path: vault.join("areas").to_str().unwrap(),
        });

        assert_eq!(result.unwrap_err(), expected_error.as_ref());
    }

    #[test]
    fn test_detect_renames_preserves_chinese_markdown_paths() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path();

        init_git_repo_with_quoted_paths(vault);
        create_test_file(vault, "旧名.md", "# 旧名\n");
        run_git(vault, &["add", "旧名.md"]);
        run_git(vault, &["commit", "-m", "add chinese note"]);
        fs::rename(vault.join("旧名.md"), vault.join("新名.md")).unwrap();
        run_git(vault, &["add", "-A"]);

        let renames = detect_renames(vault).unwrap();

        assert_eq!(renames.len(), 1);
        assert_eq!(renames[0].old_path, "旧名.md");
        assert_eq!(renames[0].new_path, "新名.md");
    }

    #[test]
    fn test_path_stem_normalizes_tmp_aliases_and_separators() {
        assert_eq!(
            to_path_stem(
                Path::new("/tmp/tolaria-vault/projects\\weekly-review.md"),
                Path::new("/private/tmp/tolaria-vault")
            ),
            "projects/weekly-review"
        );
    }

    #[test]
    fn test_rename_note_filename_preserves_title_and_updates_path_wikilinks() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path();
        create_test_file(
            vault,
            "note/project-kickoff.md",
            "---\ntitle: Project Kickoff\ntype: Note\n---\n\n# Project Kickoff\n\nBody.\n",
        );
        create_test_file(
            vault,
            "note/ref.md",
            "# Ref\n\nSee [[note/project-kickoff]] and [[Project Kickoff]].\n",
        );

        let old_path = vault.join("note/project-kickoff.md");
        let result = rename_note_filename_sync(RenameNoteFilenameRequest {
            vault_path: vault.to_str().unwrap(),
            old_path: old_path.to_str().unwrap(),
            new_filename_stem: "manual-name",
        })
        .unwrap();

        assert!(result.new_path.ends_with("manual-name.md"));
        assert!(!old_path.exists());

        let renamed = fs::read_to_string(&result.new_path).unwrap();
        assert!(renamed.contains("title: Project Kickoff"));
        assert!(renamed.contains("# Project Kickoff"));

        let ref_content = fs::read_to_string(vault.join("note/ref.md")).unwrap();
        assert!(ref_content.contains("[[note/manual-name]]"));
        assert!(!ref_content.contains("[[Project Kickoff]]"));
        assert!(!ref_content.contains("[[note/project-kickoff]]"));
    }

    #[test]
    fn test_rename_note_filename_syncs_filename_derived_frontmatter_title() {
        // The date-picker "create new note for date" flow stamps a frontmatter
        // title identical to the filename stem (no slugify difference). Renaming
        // the file afterward should keep that title in sync — otherwise the
        // breadcrumb shows the stale creation-time title forever, since a plain
        // filename rename otherwise leaves content untouched.
        let dir = TempDir::new().unwrap();
        let vault = dir.path();
        create_test_file(
            vault,
            "note/2026-07-13.md",
            "---\ntitle: 2026-07-13\ntype: Note\n---\n\nBody.\n",
        );

        let old_path = vault.join("note/2026-07-13.md");
        let result = rename_note_filename_sync(RenameNoteFilenameRequest {
            vault_path: vault.to_str().unwrap(),
            old_path: old_path.to_str().unwrap(),
            new_filename_stem: "Team Standup Notes",
        })
        .unwrap();

        assert!(result.new_path.ends_with("Team Standup Notes.md"));
        let renamed = fs::read_to_string(&result.new_path).unwrap();
        assert!(
            renamed.contains("title: Team Standup Notes"),
            "expected frontmatter title to follow the rename, got: {renamed}"
        );
        assert!(!renamed.contains("title: 2026-07-13"));
    }

    #[test]
    fn test_rename_note_filename_rejects_existing_destination() {
        assert_rename_note_filename_error(
            "manual-name",
            Some("note/manual-name.md"),
            "A note with that name already exists",
        );
    }

    #[test]
    fn test_rename_note_filename_rejects_windows_invalid_names() {
        assert_rename_note_filename_error("quarterly:plan", None::<&str>, "Invalid filename");
    }

    #[test]
    fn test_move_note_to_folder_preserves_filename_and_updates_wikilinks() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path();
        create_test_file(
            vault,
            "projects/weekly-review.md",
            "---\ntitle: Weekly Review\n---\n# Weekly Review\nBody\n",
        );
        create_test_file(
            vault,
            "areas/linked.md",
            "Reference [[projects/weekly-review]]\n",
        );

        let result = move_note_to_folder_sync(MoveNoteToFolderRequest {
            vault_path: vault.to_str().unwrap(),
            old_path: vault.join("projects/weekly-review.md").to_str().unwrap(),
            destination_folder_path: vault.join("areas").to_str().unwrap(),
        })
        .expect("move should succeed");

        assert!(result.new_path.ends_with("areas/weekly-review.md"));
        assert!(!vault.join("projects/weekly-review.md").exists());
        assert!(vault.join("areas/weekly-review.md").exists());
        assert_eq!(
            fs::read_to_string(vault.join("areas/linked.md")).unwrap(),
            "Reference [[areas/weekly-review]]\n"
        );
    }

    #[test]
    fn test_move_note_to_folder_noop_when_destination_matches_current_parent() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path();
        create_test_file(vault, "projects/weekly-review.md", "# Weekly Review\n");

        let source = vault.join("projects/weekly-review.md");
        let result = move_note_to_folder_sync(MoveNoteToFolderRequest {
            vault_path: vault.to_str().unwrap(),
            old_path: source.to_str().unwrap(),
            destination_folder_path: vault.join("projects").to_str().unwrap(),
        })
        .expect("move should noop");

        assert_eq!(result.new_path, source.to_string_lossy());
        assert!(source.exists());
        assert_eq!(result.updated_files, 0);
    }

    #[test]
    fn test_move_note_to_folder_rejects_existing_destination() {
        assert_move_note_to_folder_error("A note with that name already exists");
    }

    #[test]
    fn test_move_note_to_workspace_preserves_relative_path_and_updates_source_links() {
        let source = TempDir::new().unwrap();
        let destination = TempDir::new().unwrap();
        create_test_file(
            source.path(),
            "Projects/project-kickoff.md",
            "---\ntitle: Project Kickoff\ntype: Note\n---\n\nBody.\n",
        );
        create_test_file(
            source.path(),
            "source-ref.md",
            "# Ref\n\nSee [[Projects/project-kickoff]] and [[Project Kickoff]].\n",
        );

        let old_path = source.path().join("Projects/project-kickoff.md");
        let destination_path = destination.path().join("Projects/project-kickoff.md");
        let result = move_note_to_workspace_sync(MoveNoteToWorkspaceRequest {
            source_vault_path: source.path().to_str().unwrap(),
            destination_vault_path: destination.path().to_str().unwrap(),
            old_path: old_path.to_str().unwrap(),
            destination_path: destination_path.to_str().unwrap(),
            replacement_target: Some("team/Projects/project-kickoff"),
        })
        .unwrap();

        assert_eq!(result.new_path, destination_path.to_string_lossy());

        assert!(!old_path.exists());

        assert!(destination_path.exists());

        let source_reference = fs::read_to_string(source.path().join("source-ref.md")).unwrap();
        assert!(source_reference.contains("[[team/Projects/project-kickoff]]"));
    }

    #[test]
    fn test_replace_wikilinks_in_files_reports_failed_updates() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path();
        create_test_file(vault, "note/ref.md", "See [[Old Note]] for details.\n");

        let pattern = build_wikilink_pattern(&["Old Note"]).unwrap();
        let summary = replace_wikilinks_in_files(
            vec![vault.join("note/ref.md"), vault.join("note/missing.md")],
            &pattern,
            "note/new-note",
        );

        assert_eq!(summary.updated_files, 1);
        assert_eq!(summary.failed_updates, 1);
    }

    #[test]
    fn test_recover_pending_rename_transactions_restores_backup_when_new_file_is_missing() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path();
        let old_path = vault.join("note/original.md");
        let new_path = vault.join("note/renamed.md");

        create_test_file(vault, "note/original.md", "# Original\n");

        let txn_dir = vault.join(".tolaria-rename-txn");
        fs::create_dir_all(&txn_dir).unwrap();

        let backup_path = txn_dir.join("rename-backup.bak");
        let manifest_path = txn_dir.join("rename-transaction.json");
        fs::rename(&old_path, &backup_path).unwrap();
        fs::write(
            &manifest_path,
            serde_json::json!({
                "old_path": old_path.to_string_lossy().to_string(),
                "new_path": new_path.to_string_lossy().to_string(),
                "backup_path": backup_path.to_string_lossy().to_string(),
            })
            .to_string(),
        )
        .unwrap();

        recover_pending_rename_transactions(vault).unwrap();

        assert!(old_path.exists());
        assert!(!new_path.exists());
        assert!(!backup_path.exists());
        assert!(!manifest_path.exists());
    }

    // --- candidate narrowing: link-index path must match the full vault walk ---

    /// A vault that references `note/weekly-review.md` four ways the regex matches
    /// (path stem, title, filename stem, and a frontmatter relationship) plus one
    /// note that links something else entirely.
    fn build_wikilink_fixture(vault: &Path) {
        create_test_file(
            vault,
            "note/weekly-review.md",
            "---\ntitle: Weekly Review\ntype: Note\n---\n# Weekly Review\n\nBody.\n",
        );
        create_test_file(
            vault,
            "note/body-link.md",
            "# Body Link\n\nSee [[note/weekly-review]], [[Weekly Review]], and [[weekly-review|alias]].\n",
        );
        create_test_file(
            vault,
            "project/fm-link.md",
            "---\ntype: Project\nRelated to:\n  - \"[[Weekly Review]]\"\n---\n# Project\n",
        );
        create_test_file(
            vault,
            "note/unrelated.md",
            "# Unrelated\n\nNo match here, just [[Some Other Note]].\n",
        );
    }

    fn read_vault_md(vault: &Path) -> std::collections::BTreeMap<String, String> {
        collect_md_files(vault, Path::new(""))
            .into_iter()
            .map(|p| (to_path_stem(&p, vault), fs::read_to_string(&p).unwrap()))
            .collect()
    }

    fn scan_fixture(vault: &Path) -> Vec<VaultEntry> {
        crate::vault::scan_vault(vault, &std::collections::HashMap::new(), "created").unwrap()
    }

    /// `rename_note_filename` no longer takes or computes an `entries` list — the
    /// candidate-narrowing vault scan moved into `PendingWikilinkRewrite::run` (see
    /// ADR-0137) so it never runs on the rename's synchronous path. This test guards
    /// the correctness side of that move: narrowing driven by a scan taken *after*
    /// the rename, inside `run`, must still resolve to the exact same rewrite a
    /// brute-force walk would produce.
    #[test]
    fn test_rename_filename_narrowed_scan_matches_full_walk() {
        let narrowed = TempDir::new().unwrap();
        let full = TempDir::new().unwrap();
        build_wikilink_fixture(narrowed.path());
        build_wikilink_fixture(full.path());

        let (result, pending) = rename_note_filename(RenameNoteFilenameRequest {
            vault_path: narrowed.path().to_str().unwrap(),
            old_path: narrowed.path().join("note/weekly-review.md").to_str().unwrap(),
            new_filename_stem: "sprint-retro",
        })
        .unwrap();
        // Confirms the deferred rewrite (not the rename call above) is what performs
        // the scan/narrowing — `result` alone carries no rewrite counts yet.
        assert_eq!(result.updated_files, 0);
        let narrowed_completed = pending.run();

        let old_targets = collect_legacy_wikilink_targets("Weekly Review", "note/weekly-review");
        let full_summary = update_wikilinks_in_vault(
            full.path(),
            &old_targets,
            "note/sprint-retro",
            &full.path().join("note/weekly-review.md"),
            None,
        );
        fs::rename(
            full.path().join("note/weekly-review.md"),
            full.path().join("note/sprint-retro.md"),
        )
        .unwrap();

        // The link-narrowed rewrite must update exactly the same files, and the
        // resulting vault must be byte-identical to the brute-force walk.
        assert_eq!(narrowed_completed.updated_files, full_summary.updated_files);
        assert!(
            narrowed_completed.updated_files >= 2,
            "expected body + frontmatter refs, got {}",
            narrowed_completed.updated_files
        );
        assert_eq!(read_vault_md(narrowed.path()), read_vault_md(full.path()));
    }

    #[test]
    fn test_collect_candidate_files_excludes_non_linking_and_self() {
        let dir = TempDir::new().unwrap();
        build_wikilink_fixture(dir.path());
        let entries = scan_fixture(dir.path());
        let exclude = dir.path().join("note/weekly-review.md");

        let candidates = collect_candidate_files(
            &entries,
            &["Weekly Review", "note/weekly-review", "weekly-review"],
            &exclude,
        );
        let stems: HashSet<String> = candidates
            .iter()
            .map(|p| to_path_stem(p, dir.path()))
            .collect();

        assert!(stems.contains("note/body-link"), "body links are candidates");
        assert!(stems.contains("project/fm-link"), "frontmatter links are candidates");
        assert!(!stems.contains("note/unrelated"), "non-linking notes are skipped");
        assert!(!stems.contains("note/weekly-review"), "the renamed note is excluded");
    }
}
