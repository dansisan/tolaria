//! Bulk conversion of plain `people` names into wikilinks.
//!
//! A name is converted only when it resolves to an existing Person note by
//! filename, title or alias (case-insensitive). Every other item is left exactly
//! as written, and nothing outside the `people` field is touched.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use walkdir::{DirEntry, WalkDir};

use super::{is_hidden_dir, is_md_file};

const FIELD: &str = "people";

fn strip_quotes(s: &str) -> &str {
    s.trim().trim_matches(|c| c == '"' || c == '\'')
}

fn normalize(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn is_wikilink(s: &str) -> bool {
    let t = strip_quotes(s);
    t.starts_with("[[") && t.ends_with("]]")
}

/// Body line range of the frontmatter (exclusive of both `---` fences).
fn frontmatter_range(lines: &[&str]) -> Option<(usize, usize)> {
    if lines.first()?.trim_end() != "---" {
        return None;
    }
    let close = lines.iter().skip(1).position(|l| l.trim_end() == "---")? + 1;
    Some((1, close))
}

fn key_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let (k, v) = line.split_once(':')?;
    if k.starts_with(char::is_whitespace) || !k.trim().eq_ignore_ascii_case(key) {
        return None;
    }
    Some(v.trim())
}

fn split_flow(inner: &str) -> Vec<String> {
    let (mut items, mut cur, mut depth) = (Vec::new(), String::new(), 0i32);
    for ch in inner.chars() {
        match ch {
            '[' => depth += 1,
            ']' => depth -= 1,
            _ => {}
        }
        if ch == ',' && depth == 0 {
            items.push(std::mem::take(&mut cur));
        } else {
            cur.push(ch);
        }
    }
    items.push(cur);
    items
        .into_iter()
        .map(|i| i.trim().to_string())
        .filter(|i| !i.is_empty())
        .collect()
}

#[derive(PartialEq)]
enum Style {
    Flow,
    Scalar,
    Block,
}

struct Field {
    start: usize,
    end: usize, // exclusive
    style: Style,
    items: Vec<String>,
}

fn find_field(lines: &[&str], range: (usize, usize), key: &str) -> Option<Field> {
    for i in range.0..range.1 {
        let Some(value) = key_value(lines[i], key) else { continue };
        if value.starts_with('[') && value.ends_with(']') && !is_wikilink(value) {
            let items = split_flow(&value[1..value.len() - 1]);
            return Some(Field { start: i, end: i + 1, style: Style::Flow, items });
        }
        if !value.is_empty() {
            return Some(Field { start: i, end: i + 1, style: Style::Scalar, items: vec![value.to_string()] });
        }
        let mut j = i + 1;
        let mut items = Vec::new();
        while j < range.1 && lines[j].trim_start().starts_with("- ") {
            items.push(lines[j].trim_start()[2..].trim().to_string());
            j += 1;
        }
        return Some(Field { start: i, end: j, style: Style::Block, items });
    }
    None
}

fn scalar(lines: &[&str], range: (usize, usize), key: &str) -> Option<String> {
    (range.0..range.1)
        .find_map(|i| key_value(lines[i], key))
        .map(|v| strip_quotes(v).to_string())
}

/// Index of normalized person identity -> Person note stem.
fn person_identities(content: &str, stem: &str, ids: &mut HashMap<String, String>) {
    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    let Some(range) = frontmatter_range(&lines) else { return };
    let kind = scalar(&lines, range, "type").or_else(|| scalar(&lines, range, "is_a"));
    if !kind.is_some_and(|k| k.eq_ignore_ascii_case("person")) {
        return;
    }
    let mut idents = vec![stem.to_string()];
    idents.extend(scalar(&lines, range, "title"));
    if let Some(aliases) = find_field(&lines, range, "aliases") {
        idents.extend(aliases.items.iter().map(|a| strip_quotes(a).to_string()));
    }
    for ident in idents.into_iter().filter(|i| !i.is_empty()) {
        ids.insert(normalize(&ident), stem.to_string());
    }
}

/// Rewrite the `people` field of one note; `None` when nothing changes.
fn link_people_in_content(content: &str, ids: &HashMap<String, String>) -> Option<String> {
    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    let range = frontmatter_range(&lines)?;
    let field = find_field(&lines, range, FIELD)?;

    let mut out: Vec<String> = Vec::new();
    let mut changed = false;
    for raw in &field.items {
        let target = if is_wikilink(raw) { None } else { ids.get(&normalize(strip_quotes(raw))) };
        match target {
            None => out.push(raw.clone()),
            Some(stem) => {
                changed = true;
                let link = format!("\"[[{stem}]]\"");
                if !out.contains(&link) {
                    out.push(link);
                }
            }
        }
    }
    if !changed {
        return None;
    }

    let eol = if lines[field.start].ends_with("\r\n") { "\r\n" } else { "\n" };
    let key = lines[field.start].split(':').next().unwrap_or(FIELD).to_string();
    let replacement: Vec<String> = match field.style {
        Style::Block => out.iter().map(|i| format!("  - {i}{eol}")).collect(),
        _ if out.len() == 1 && field.style == Style::Scalar => vec![format!("{key}: {}{eol}", out[0])],
        _ => vec![format!("{key}: [{}]{eol}", out.join(", "))],
    };
    let replacement = if field.style == Style::Block {
        let mut v = vec![format!("{key}:{eol}")];
        v.extend(replacement);
        v
    } else {
        replacement
    };

    let mut result = String::with_capacity(content.len() + 32);
    result.extend(lines[..field.start].iter().copied());
    result.extend(replacement.iter().map(String::as_str));
    result.extend(lines[field.end..].iter().copied());
    Some(result)
}

fn is_hidden_walk_dir(entry: &DirEntry) -> bool {
    entry.file_type().is_dir()
        && entry.depth() > 0
        && is_hidden_dir(&entry.file_name().to_string_lossy())
}

fn markdown_files(vault_path: &Path) -> Vec<std::path::PathBuf> {
    WalkDir::new(vault_path)
        .follow_links(true)
        .into_iter()
        .filter_entry(|e| !is_hidden_walk_dir(e))
        .filter_map(Result::ok)
        .map(DirEntry::into_path)
        .filter(|p| is_md_file(p))
        .collect()
}

/// Convert plain `people` names that resolve to a Person note into wikilinks
/// across the vault. Returns the number of notes rewritten.
pub fn link_people_frontmatter(vault_path: &Path) -> Result<usize, String> {
    if !vault_path.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path.display()));
    }
    let files = markdown_files(vault_path);
    let mut ids = HashMap::new();
    for path in &files {
        let Ok(content) = fs::read_to_string(path) else { continue };
        let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        person_identities(&content, &stem, &mut ids);
    }
    if ids.is_empty() {
        return Ok(0);
    }

    let mut changed = 0;
    for path in &files {
        let Ok(content) = fs::read_to_string(path) else { continue };
        let Some(updated) = link_people_in_content(&content, &ids) else { continue };
        fs::write(path, updated).map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
        changed += 1;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids() -> HashMap<String, String> {
        let mut m = HashMap::new();
        m.insert("h".into(), "H".into());
        m.insert("h.".into(), "H".into());
        m.insert("kate".into(), "kate W".into());
        m
    }

    fn run(content: &str) -> Option<String> {
        link_people_in_content(content, &ids())
    }

    #[test]
    fn converts_flow_items_and_keeps_the_rest() {
        let out = run("---\ntitle: x\npeople: [H., Ben Hendricks, David]\n---\nbody H.\n").unwrap();
        assert_eq!(out, "---\ntitle: x\npeople: [\"[[H]]\", Ben Hendricks, David]\n---\nbody H.\n");
    }

    #[test]
    fn collapses_duplicate_variants_into_one_link() {
        let out = run("---\npeople: [H, h, H.]\n---\n").unwrap();
        assert_eq!(out, "---\npeople: [\"[[H]]\"]\n---\n");
    }

    #[test]
    fn converts_block_lists() {
        let out = run("---\npeople:\n  - Kate\n  - \"Bob\"\ntags: [a]\n---\n").unwrap();
        assert_eq!(out, "---\npeople:\n  - \"[[kate W]]\"\n  - \"Bob\"\ntags: [a]\n---\n");
    }

    #[test]
    fn converts_scalar() {
        let out = run("---\npeople: H\n---\n").unwrap();
        assert_eq!(out, "---\npeople: \"[[H]]\"\n---\n");
    }

    #[test]
    fn leaves_unresolved_and_existing_links_alone() {
        assert!(run("---\npeople: [David, \"[[H]]\"]\n---\n").is_none());
        assert!(run("---\ntitle: no people\n---\n").is_none());
        assert!(run("no frontmatter\npeople: [H]\n").is_none());
    }

    #[test]
    fn preserves_crlf() {
        let out = run("---\r\npeople: [H]\r\n---\r\n").unwrap();
        assert_eq!(out, "---\r\npeople: [\"[[H]]\"]\r\n---\r\n");
    }

    #[test]
    fn indexes_person_notes_by_stem_title_and_alias() {
        let mut m = HashMap::new();
        person_identities("---\ntype: Person\ntitle: Kate Wills\naliases: [Kate, KW]\n---\n", "kate W", &mut m);
        assert_eq!(m.get("kate"), Some(&"kate W".to_string()));
        assert_eq!(m.get("kate wills"), Some(&"kate W".to_string()));
        let mut none = HashMap::new();
        person_identities("---\ntype: Note\naliases: [Kate]\n---\n", "x", &mut none);
        assert!(none.is_empty());
    }
}
