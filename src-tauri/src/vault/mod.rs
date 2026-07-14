mod backfill;
mod cache;
mod config_seed;
mod entry;
mod file;
pub(crate) mod filename_rules;
mod folders;
mod frontmatter;
mod getting_started;
mod ignored;
mod image;
mod migration;
mod parsing;
pub(crate) mod path_identity;
mod rename;
mod rename_transaction;
mod trash;
mod view_date_filters;
mod view_migration;
mod view_relationships;
#[cfg(test)]
mod view_tests;
mod view_value_conversions;
mod views;

pub use backfill::backfill_derived_frontmatter;
pub use cache::{invalidate_cache, scan_vault_cached};
pub use config_seed::{
    get_ai_guidance_status, migrate_agents_md, repair_config_files, restore_ai_guidance_files,
    seed_config_files, AiGuidanceFileState, VaultAiGuidanceStatus,
};
pub use entry::{FolderNode, VaultEntry};
pub use file::{
    create_note_content, get_note_content, note_content_matches, save_note_content,
    save_note_content_tracking_removed_attachments,
};
pub use folders::{delete_folder, rename_folder, FolderRenameResult};
pub use getting_started::{create_getting_started_vault, default_vault_path, vault_exists};
pub use ignored::{filter_gitignored_entries, filter_gitignored_folders, filter_gitignored_paths};
pub use image::{copy_image_to_vault, delete_attachment, rename_attachment_via_command, save_image};
pub(crate) use image::{prepare_attachment_payload, stored_attachment_name};
pub use migration::migrate_is_a_to_type;
pub use rename::{
    detect_renames, move_note_to_folder, move_note_to_workspace, rename_note_filename,
    update_wikilinks_for_renames, DetectedRename, MoveNoteToFolderRequest,
    MoveNoteToWorkspaceRequest, PendingWikilinkRewrite, RenameNoteFilenameRequest, RenameResult,
    WikilinkRewriteCompleted,
};
pub use trash::{batch_delete_notes, delete_note};
pub use views::{
    delete_view, evaluate_view, save_view, scan_views, FilterCondition, FilterGroup, FilterNode,
    FilterOp, ViewDefinition, ViewFile,
};

use file::read_file_metadata;
use frontmatter::{extract_fm_and_rels, resolve_is_a, resolve_note_width};
use parsing::{count_body_words, extract_attachment_links, extract_inline_tags, extract_outgoing_links, extract_snippet, extract_title};

use gray_matter::engine::YAML;
use gray_matter::Matter;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

fn preferred_relationship_refs(
    relationships: &std::collections::HashMap<String, Vec<String>>,
    canonical_key: &str,
    legacy_key: &str,
) -> Vec<String> {
    relationships
        .get(canonical_key)
        .cloned()
        .or_else(|| relationships.get(legacy_key).cloned())
        .unwrap_or_default()
}

/// Notes (no `type:`/`Is A:` frontmatter, or an explicit "Note" type) title by
/// filename alone — H1 and frontmatter `title:` are not title sources for them.
/// Structured Types keep the H1 -> frontmatter title -> filename priority chain.
fn is_default_note_type(is_a: &Option<String>) -> bool {
    is_a.is_none() || is_a.as_deref() == Some("Note")
}

pub(crate) fn derive_markdown_title_from_content(content: &str, filename: &str) -> String {
    let matter = Matter::<YAML>::new();
    let parsed = matter.parse(content);
    let (frontmatter, _, _, _) = extract_fm_and_rels(parsed.data, content, "created");
    let is_a = resolve_is_a(frontmatter.is_a.clone());
    if is_default_note_type(&is_a) {
        return filename.strip_suffix(".md").unwrap_or(filename).to_string();
    }
    extract_title(frontmatter.title.as_deref(), content, filename)
}

fn resolve_entry_dates(
    fs_modified: Option<u64>,
    fs_created: Option<u64>,
    git_dates: Option<(u64, u64)>,
) -> (Option<u64>, Option<u64>) {
    match git_dates {
        Some((git_modified, git_created)) => {
            let modified_at = Some(fs_modified.map_or(git_modified, |fs| fs.max(git_modified)));
            (modified_at, Some(git_created))
        }
        None => (fs_modified, fs_created),
    }
}

/// Parse a single markdown file into a VaultEntry.
///
/// If `git_dates` is provided, `created_at` comes from git history while
/// `modified_at` uses the newer of the latest git touch and the current
/// filesystem modified time. Pass `None` to use filesystem dates only
/// (appropriate for non-git vaults).
pub fn parse_md_file(path: &Path, git_dates: Option<(u64, u64)>, fm_created_key: &str) -> Result<VaultEntry, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let filename = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();

    let matter = Matter::<YAML>::new();
    let parsed = matter.parse(&content);
    let (frontmatter, mut relationships, properties, fm_created_at) =
        extract_fm_and_rels(parsed.data, &content, fm_created_key);

    let is_a = resolve_is_a(frontmatter.is_a);
    let title = derive_markdown_title_from_content(&content, &filename);
    let has_h1 = !is_default_note_type(&is_a) && parsing::extract_h1_title(&content).is_some();
    let snippet = extract_snippet(&content);
    let word_count = count_body_words(&content);
    let outgoing_links = extract_outgoing_links(&parsed.content);
    let attachment_links = extract_attachment_links(&parsed.content);
    let mut inline_tags = extract_inline_tags(&content);
    if let Some(fm_tags) = frontmatter.tags.clone() {
        for raw in fm_tags.into_vec() {
            let tag = raw.trim_start_matches('#').to_string();
            if !tag.is_empty() && !inline_tags.contains(&tag) {
                inline_tags.push(tag);
            }
        }
        inline_tags.sort();
    }
    let (fs_modified, fs_created, file_size) = read_file_metadata(path)?;
    let (modified_at, fs_or_git_created) = resolve_entry_dates(fs_modified, fs_created, git_dates);
    let created_at = fm_created_at.or(fs_or_git_created);

    // Add "Type" relationship: isA becomes a navigable link to the type document.
    // Skip for type documents themselves (isA == "Type") to avoid self-referential links.
    if let Some(ref type_name) = is_a {
        if type_name != "Type" {
            let type_link = if type_name.starts_with("[[") && type_name.ends_with("]]") {
                type_name.clone()
            } else {
                format!("[[{}]]", type_name.to_lowercase())
            };
            relationships.insert("Type".to_string(), vec![type_link]);
        }
    }

    let belongs_to = preferred_relationship_refs(&relationships, "belongs_to", "Belongs to");
    let related_to = preferred_relationship_refs(&relationships, "related_to", "Related to");

    Ok(VaultEntry {
        path: path.to_string_lossy().to_string(),
        filename,
        title,
        is_a,
        snippet,
        relationships,
        aliases: frontmatter
            .aliases
            .map(|a| a.into_vec())
            .unwrap_or_default(),
        belongs_to,
        related_to,
        status: frontmatter.status.and_then(|v| v.into_scalar()),
        archived: frontmatter.archived.unwrap_or(false),
        modified_at,
        created_at,
        file_size,
        icon: frontmatter.icon.and_then(|v| v.into_scalar()),
        color: frontmatter.color.and_then(|v| v.into_scalar()),
        order: frontmatter.order,
        sidebar_label: frontmatter.sidebar_label.and_then(|v| v.into_scalar()),
        template: frontmatter.template.and_then(|v| v.into_scalar()),
        sort: frontmatter.sort.and_then(|v| v.into_scalar()),
        view: frontmatter.view.and_then(|v| v.into_scalar()),
        note_width: resolve_note_width(frontmatter.note_width),
        visible: frontmatter.visible,
        organized: frontmatter.organized.unwrap_or(false),
        favorite: frontmatter.favorite.unwrap_or(false),
        favorite_index: frontmatter.favorite_index,
        list_properties_display: frontmatter.list_properties_display.unwrap_or_default(),
        word_count,
        outgoing_links,
        attachment_links,
        inline_tags,
        properties,
        has_h1,
        file_kind: "markdown".to_string(),
    })
}

/// Parse a non-markdown file into a minimal VaultEntry.
/// Uses filename as title, except for `.yml` files where the YAML `name` field is used.
pub(crate) fn parse_non_md_file(
    path: &Path,
    git_dates: Option<(u64, u64)>,
) -> Result<VaultEntry, String> {
    let filename = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let (fs_modified, fs_created, file_size) = read_file_metadata(path)?;
    let (modified_at, created_at) = resolve_entry_dates(fs_modified, fs_created, git_dates);
    let file_kind = classify_file_kind(path).to_string();
    let title = extract_yml_name(path).unwrap_or_else(|| filename.clone());

    Ok(VaultEntry {
        path: path.to_string_lossy().to_string(),
        filename: filename.clone(),
        title,
        file_kind,
        modified_at,
        created_at,
        file_size,
        ..VaultEntry::default()
    })
}

/// For `.yml` files, try to extract the `name` field from the YAML content.
fn extract_yml_name(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?;
    if ext != "yml" && ext != "yaml" {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let mapping: serde_yaml::Value = serde_yaml::from_str(&content).ok()?;
    mapping.get("name")?.as_str().map(|s| s.to_string())
}

/// Re-read a single file from disk and return a fresh VaultEntry.
/// Uses filesystem dates (no git lookup) since the file was likely just saved.
pub fn reload_entry(path: &Path) -> Result<VaultEntry, String> {
    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }
    let fm_key = crate::settings::get_settings()
        .map(|s| s.frontmatter_created_key.unwrap_or_else(|| crate::settings::DEFAULT_FRONTMATTER_CREATED_KEY.to_string()))
        .unwrap_or_else(|_| crate::settings::DEFAULT_FRONTMATTER_CREATED_KEY.to_string());
    if is_md_file(path) {
        parse_md_file(path, None, &fm_key)
    } else {
        parse_non_md_file(path, None)
    }
}

/// Directories hidden from user-facing vault scans.
const HIDDEN_DIRS: &[&str] = &[".git", ".laputa", ".DS_Store"];
/// Keep type definitions in their dedicated sidebar section instead of the generic folder tree.
const FOLDER_TREE_EXCLUDED_DIRS: &[&str] = &["type"];

fn is_hidden_dir(name: &str) -> bool {
    name.starts_with('.') || HIDDEN_DIRS.contains(&name)
}

fn is_folder_tree_hidden_dir(name: &str) -> bool {
    is_hidden_dir(name) || FOLDER_TREE_EXCLUDED_DIRS.contains(&name)
}

pub(crate) fn is_md_file(path: &Path) -> bool {
    path.is_file() && path.extension().is_some_and(|ext| ext == "md")
}

/// Extensions recognized as editable text files (opened in raw editor).
const TEXT_EXTENSIONS: &[&str] = &[
    "yml",
    "yaml",
    "json",
    "txt",
    "toml",
    "csv",
    "xml",
    "html",
    "htm",
    "css",
    "scss",
    "less",
    "ts",
    "tsx",
    "js",
    "jsx",
    "py",
    "rs",
    "sh",
    "bash",
    "zsh",
    "fish",
    "rb",
    "go",
    "java",
    "kt",
    "c",
    "cpp",
    "h",
    "hpp",
    "swift",
    "lua",
    "sql",
    "graphql",
    "env",
    "ini",
    "cfg",
    "conf",
    "properties",
    "makefile",
    "dockerfile",
    "gitignore",
    "editorconfig",
    "mdx",
    "svelte",
    "vue",
    "astro",
    "tf",
    "hcl",
    "nix",
    "zig",
    "hs",
    "ml",
    "ex",
    "exs",
    "erl",
    "clj",
    "lisp",
    "el",
    "vim",
    "r",
    "jl",
    "ps1",
    "bat",
    "cmd",
];

/// Classify a file extension into "markdown", "text", or "binary".
pub(crate) fn classify_file_kind(path: &Path) -> &'static str {
    let ext = match path.extension() {
        Some(e) => e.to_string_lossy().to_lowercase(),
        None => {
            // Files without extension: check if name itself is a known text file
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            return if [
                "makefile",
                "dockerfile",
                "rakefile",
                "gemfile",
                "procfile",
                "brewfile",
                ".gitignore",
                ".gitattributes",
                ".editorconfig",
                ".env",
            ]
            .contains(&name.as_str())
            {
                "text"
            } else {
                "binary"
            };
        }
    };
    if ext == "md" || ext == "markdown" {
        "markdown"
    } else if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        "text"
    } else {
        "binary"
    }
}

use crate::git::GitDates;
use std::collections::HashMap;

fn lookup_git_dates(
    path: &Path,
    vault_path: &Path,
    git_dates: &HashMap<String, GitDates>,
) -> Option<(u64, u64)> {
    let rel = path_identity::vault_relative_path_string(vault_path, path).ok()?;
    git_dates.get(&rel).map(|d| (d.modified_at, d.created_at))
}

fn try_parse_file(
    path: &Path,
    vault_path: &Path,
    git_dates: &HashMap<String, GitDates>,
    entries: &mut Vec<VaultEntry>,
    fm_created_key: &str,
) {
    let dates = lookup_git_dates(path, vault_path, git_dates);
    let result = if is_md_file(path) {
        parse_md_file(path, dates, fm_created_key)
    } else {
        parse_non_md_file(path, dates)
    };
    match result {
        Ok(vault_entry) => entries.push(vault_entry),
        Err(e) => log::warn!("Skipping file: {}", e),
    }
}

/// Scan all files in the vault, including subdirectories.
/// Hidden directories (starting with `.`) are excluded.
fn scan_all_files(
    vault_path: &Path,
    git_dates: &HashMap<String, GitDates>,
    entries: &mut Vec<VaultEntry>,
    fm_created_key: &str,
) {
    let walker = WalkDir::new(vault_path)
        .follow_links(true)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                // Skip the vault root itself (depth 0) — we only filter subdirs
                if e.depth() == 0 {
                    return true;
                }
                return !is_hidden_dir(&name);
            }
            true
        });
    for entry in walker.filter_map(|e| e.ok()) {
        if entry.path().is_file() {
            // Skip hidden files (starting with '.') — e.g. .gitignore, .DS_Store
            let fname = entry.file_name().to_string_lossy();
            if fname.starts_with('.') {
                continue;
            }
            try_parse_file(entry.path(), vault_path, git_dates, entries, fm_created_key);
        }
    }
}

/// Scan a directory recursively for all files and return VaultEntry for each.
/// Pass an empty map for `git_dates` to use filesystem dates only.
pub fn scan_vault(
    vault_path: &Path,
    git_dates: &HashMap<String, GitDates>,
    fm_created_key: &str,
) -> Result<Vec<VaultEntry>, String> {
    if !vault_path.exists() {
        return Err(format!(
            "Vault path does not exist: {}",
            vault_path.display()
        ));
    }
    if !vault_path.is_dir() {
        return Err(format!(
            "Vault path is not a directory: {}",
            vault_path.display()
        ));
    }

    if let Err(err) = rename::recover_pending_rename_transactions(vault_path) {
        log::warn!(
            "Failed to recover pending rename transactions in {}: {}",
            vault_path.display(),
            err
        );
    }

    let mut entries = Vec::new();
    scan_all_files(vault_path, git_dates, &mut entries, fm_created_key);

    entries.sort_by_key(|entry| std::cmp::Reverse(entry.modified_at));
    Ok(entries)
}

/// Build a tree of user-created folders in the vault.
pub fn scan_vault_folders(vault_path: &Path) -> Result<Vec<FolderNode>, String> {
    if !vault_path.is_dir() {
        return Err(format!("Not a directory: {}", vault_path.display()));
    }
    fn build_tree(dir: &Path, vault_root: &Path) -> Vec<FolderNode> {
        let mut nodes: Vec<FolderNode> = Vec::new();
        let entries = match fs::read_dir(dir) {
            Ok(d) => d,
            Err(_) => return nodes,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if is_folder_tree_hidden_dir(&name) {
                continue;
            }
            let rel_path = path_identity::vault_relative_path_string(vault_root, &path)
                .unwrap_or_else(|_| {
                    path_identity::normalize_path_for_identity(&path.to_string_lossy())
                });
            let children = build_tree(&path, vault_root);
            nodes.push(FolderNode {
                name,
                path: rel_path,
                children,
            });
        }
        nodes.sort_by_key(|node| node.name.to_lowercase());
        nodes
    }
    Ok(build_tree(vault_path, vault_path))
}

#[cfg(test)]
#[path = "frontmatter_regression_tests.rs"]
mod frontmatter_regression_tests;
#[cfg(test)]
#[path = "modified_dates_tests.rs"]
mod modified_dates_tests;
#[cfg(test)]
#[path = "relationship_key_tests.rs"]
mod relationship_key_tests;
#[cfg(test)]
#[path = "system_metadata_tests.rs"]
mod system_metadata_tests;
#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
