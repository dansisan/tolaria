use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Instant;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Clone)]
pub struct SearchResult {
    pub title: String,
    pub path: String,
    pub snippet: String,
    pub score: f64,
    pub note_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub elapsed_ms: u64,
    pub query: String,
    pub mode: String,
}

pub struct SearchOptions<'a> {
    pub vault_path: &'a str,
    pub query: &'a str,
    pub mode: &'a str,
    pub limit: usize,
    pub hide_gitignored_files: bool,
    pub exclude_frontmatter: bool,
}

struct Utf8Boundary<'a> {
    text: &'a str,
}

struct SnippetRequest<'a> {
    content: &'a str,
    content_lower: &'a str,
    query_lower: &'a str,
}

struct SearchCandidate<'a> {
    exclude_frontmatter: bool,
    path: &'a Path,
    query_lower: &'a str,
}

struct MatchScoreRequest<'a> {
    title_lower: &'a str,
    content_lower: &'a str,
    query_lower: &'a str,
}

impl Utf8Boundary<'_> {
    fn floor(&self, index: usize) -> usize {
        let mut boundary = index.min(self.text.len());
        while boundary > 0 && !self.text.is_char_boundary(boundary) {
            boundary -= 1;
        }
        boundary
    }

    fn lower_to_source(&self, lower_index: usize) -> usize {
        let mut lowered_len = 0;
        for (source_index, ch) in self.text.char_indices() {
            if lowered_len >= lower_index {
                return source_index;
            }
            lowered_len += ch.to_lowercase().map(|c| c.len_utf8()).sum::<usize>();
            if lowered_len > lower_index {
                return source_index;
            }
        }
        self.text.len()
    }
}

impl SnippetRequest<'_> {
    fn extract(&self) -> String {
        let lower_pos = match self.content_lower.find(self.query_lower) {
            Some(p) => p,
            None => return String::new(),
        };
        let content_boundary = Utf8Boundary { text: self.content };
        let pos = content_boundary.lower_to_source(lower_pos);
        let start = self.content[..pos]
            .rfind('\n')
            .map(|i| i + 1)
            .unwrap_or_else(|| content_boundary.floor(pos.saturating_sub(60)));
        let end = self.content[pos..]
            .find('\n')
            .map(|i| pos + i)
            .unwrap_or_else(|| content_boundary.floor((pos + 120).min(self.content.len())));
        let snippet = &self.content[start..end];
        if snippet.len() > 200 {
            let end = Utf8Boundary { text: snippet }.floor(200);
            format!("{}…", &snippet[..end])
        } else {
            snippet.to_string()
        }
    }
}

impl MatchScoreRequest<'_> {
    fn score(&self) -> f64 {
        let title_exact = self.title_lower.contains(self.query_lower);
        let title_word = self
            .title_lower
            .split_whitespace()
            .any(|word| word == self.query_lower);
        let content_count = self.content_lower.matches(self.query_lower).count();

        let mut score = 0.0;
        if title_word {
            score += 10.0;
        } else if title_exact {
            score += 5.0;
        }
        score += (content_count as f64).min(20.0) * 0.5;
        score
    }
}

pub fn search_vault(
    vault_path: &str,
    query: &str,
    _mode: &str,
    limit: usize,
) -> Result<SearchResponse, String> {
    search_vault_with_options(SearchOptions {
        vault_path,
        query,
        mode: _mode,
        limit,
        hide_gitignored_files: crate::settings::hide_gitignored_files_enabled(),
        exclude_frontmatter: false,
    })
}

fn strip_frontmatter(content: &str) -> &str {
    let Some(rest) = content.strip_prefix("---") else {
        return content;
    };

    match rest.find("\n---") {
        Some(end) => rest[end + 4..].trim_start(),
        None => content,
    }
}

fn searchable_content(content: &str, exclude_frontmatter: bool) -> &str {
    if exclude_frontmatter {
        strip_frontmatter(content)
    } else {
        content
    }
}

fn is_markdown_search_candidate(vault_dir: &Path, path: &Path) -> bool {
    if !path.extension().is_some_and(|ext| ext == "md") {
        return false;
    }

    let vault_relative_path = path.strip_prefix(vault_dir).unwrap_or(path);
    !vault_relative_path
        .components()
        .any(|component| component.as_os_str().to_string_lossy().starts_with('.'))
}

fn collect_markdown_paths(vault_dir: &Path, hide_gitignored_files: bool) -> Vec<PathBuf> {
    let paths = WalkDir::new(vault_dir)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.into_path())
        .filter(|path| is_markdown_search_candidate(vault_dir, path))
        .collect::<Vec<_>>();

    crate::vault::filter_gitignored_paths(vault_dir, paths, hide_gitignored_files)
}

impl SearchCandidate<'_> {
    /// Read, match, and score one note. `None` means the note is unreadable or
    /// simply does not match — both drop it from the results.
    fn search(&self) -> Option<SearchResult> {
        let content = std::fs::read_to_string(self.path).ok()?;
        let searchable_content = searchable_content(&content, self.exclude_frontmatter);
        let content_lower = searchable_content.to_lowercase();
        let filename = self
            .path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let title = crate::vault::derive_markdown_title_from_content(&content, filename);
        let title_lower = title.to_lowercase();

        if !title_lower.contains(self.query_lower) && !content_lower.contains(self.query_lower) {
            return None;
        }

        let score = MatchScoreRequest {
            title_lower: &title_lower,
            content_lower: &content_lower,
            query_lower: self.query_lower,
        }
        .score();
        let snippet = SnippetRequest {
            content: searchable_content,
            content_lower: &content_lower,
            query_lower: self.query_lower,
        }
        .extract();

        Some(SearchResult {
            title,
            path: self.path.to_string_lossy().to_string(),
            snippet,
            score,
            note_type: None,
        })
    }
}

/// Spreading a handful of files over every core costs more in thread setup than
/// the scan itself, so workers are only added once each has real work to do.
const MIN_PATHS_PER_SEARCH_WORKER: usize = 64;

fn search_worker_count(path_count: usize) -> usize {
    let available = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1);
    available
        .min(path_count.div_ceil(MIN_PATHS_PER_SEARCH_WORKER))
        .max(1)
}

fn search_paths_in_order(
    paths: &[PathBuf],
    query_lower: &str,
    exclude_frontmatter: bool,
) -> Vec<SearchResult> {
    paths
        .iter()
        .filter_map(|path| {
            SearchCandidate {
                exclude_frontmatter,
                path,
                query_lower,
            }
            .search()
        })
        .collect()
}

/// Notes are read and scored independently, so the file list splits across worker
/// threads. Each chunk keeps its scan order and the chunks are concatenated in
/// order, so the stable sort that follows still produces exactly the ordering the
/// single-threaded scan produced — the win is wall clock, not a different result.
fn search_paths(
    paths: &[PathBuf],
    query_lower: &str,
    exclude_frontmatter: bool,
) -> Vec<SearchResult> {
    let worker_count = search_worker_count(paths.len());
    if worker_count <= 1 {
        return search_paths_in_order(paths, query_lower, exclude_frontmatter);
    }

    let chunk_size = paths.len().div_ceil(worker_count);
    std::thread::scope(|scope| {
        let workers = paths
            .chunks(chunk_size)
            .map(|chunk| {
                scope.spawn(move || search_paths_in_order(chunk, query_lower, exclude_frontmatter))
            })
            .collect::<Vec<_>>();
        workers
            .into_iter()
            .filter_map(|worker| worker.join().ok())
            .flatten()
            .collect()
    })
}

pub fn search_vault_with_options(options: SearchOptions<'_>) -> Result<SearchResponse, String> {
    let start = Instant::now();
    let query_lower = options.query.to_lowercase();
    let vault_dir = Path::new(options.vault_path);
    let paths = collect_markdown_paths(vault_dir, options.hide_gitignored_files);

    let mut results = search_paths(&paths, &query_lower, options.exclude_frontmatter);

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(options.limit);

    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(SearchResponse {
        results,
        elapsed_ms,
        query: options.query.to_string(),
        mode: options.mode.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::Builder;

    fn init_git_repo(root: &Path) {
        crate::hidden_command("git")
            .args(["init"])
            .current_dir(root)
            .output()
            .unwrap();
    }

    macro_rules! snippet {
        ($content:expr, $query_lower:expr) => {{
            let content: &str = $content;
            let content_lower = content.to_lowercase();
            SnippetRequest {
                content,
                content_lower: &content_lower,
                query_lower: $query_lower,
            }
            .extract()
        }};
    }

    macro_rules! match_score {
        ($title_lower:expr, $content_lower:expr, $query_lower:expr) => {
            MatchScoreRequest {
                title_lower: $title_lower,
                content_lower: $content_lower,
                query_lower: $query_lower,
            }
            .score()
        };
    }

    #[test]
    fn test_extract_snippet_basic() {
        let content = "line one\nline with keyword here\nline three";
        let snippet = snippet!(content, "keyword");
        assert!(snippet.contains("keyword"));
    }

    #[test]
    fn test_extract_snippet_no_match() {
        let snippet = snippet!("nothing here", "missing");
        assert!(snippet.is_empty());
    }

    #[test]
    fn test_score_match_title_word() {
        let score = match_score!("my keyword", "", "keyword");
        assert!(score >= 10.0);
    }

    #[test]
    fn test_score_match_content_only() {
        let score = match_score!("unrelated", "some keyword text keyword", "keyword");
        assert!(score > 0.0);
        assert!(score < 10.0);
    }

    #[test]
    fn test_extract_snippet_long() {
        let long_line = "a".repeat(300);
        let content = format!("start\n{}keyword{}\nend", long_line, long_line);
        let snippet = snippet!(&content, "keyword");
        assert!(snippet.len() <= 203); // 200 + "…" (3 bytes UTF-8)
    }

    #[test]
    fn test_extract_snippet_multibyte_context_start() {
        let prefix = format!("{}a", "한".repeat(21));
        let content = format!("{prefix}needle after multibyte prefix");

        let snippet = snippet!(&content, "needle");

        assert!(snippet.contains("needle"));
        assert!(snippet.is_char_boundary(snippet.len()));
    }

    #[test]
    fn test_extract_snippet_multibyte_context_end() {
        let content = format!("x{}", "한".repeat(50));

        let snippet = snippet!(&content, "x");

        assert!(snippet.starts_with('x'));
        assert!(snippet.is_char_boundary(snippet.len()));
    }

    #[test]
    fn test_extract_snippet_multibyte_truncation() {
        let content = format!("key {}\n", "한".repeat(100));

        let snippet = snippet!(&content, "key");

        assert!(snippet.starts_with("key"));
        assert!(snippet.ends_with('…'));
        assert!(snippet.is_char_boundary(snippet.len()));
    }

    #[test]
    fn test_extract_snippet_maps_expanded_lowercase_to_source_boundary() {
        let content = "İstanbul needle";

        let snippet = snippet!(content, "i");

        assert!(snippet.starts_with("İstanbul"));
        assert!(snippet.is_char_boundary(snippet.len()));
    }

    #[test]
    fn test_search_vault_uses_filename_for_note_result_title() {
        // Notes always title by filename — H1 is not a title source for the
        // default "Note" type (see ADR superseding 0068).
        let dir = Builder::new()
            .prefix("search-vault-")
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        let note_path = dir.path().join("legacy-name.md");
        fs::write(
            &note_path,
            "# Updated Display Title\n\nThe body contains keyword for search.",
        )
        .unwrap();

        let response =
            search_vault(dir.path().to_str().unwrap(), "keyword", "keyword", 10).unwrap();

        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].title, "legacy-name");
    }

    #[test]
    fn test_search_vault_uses_h1_for_type_instance_result_title() {
        let dir = Builder::new()
            .prefix("search-vault-")
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        let note_path = dir.path().join("legacy-name.md");
        fs::write(
            &note_path,
            "---\ntype: Person\n---\n# Updated Display Title\n\nThe body contains keyword for search.",
        )
        .unwrap();

        let response =
            search_vault(dir.path().to_str().unwrap(), "keyword", "keyword", 10).unwrap();

        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].title, "Updated Display Title");
    }

    #[test]
    fn test_search_vault_hides_gitignored_notes_when_enabled() {
        let dir = Builder::new()
            .prefix("search-gitignored-")
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        init_git_repo(dir.path());
        fs::create_dir_all(dir.path().join("ignored")).unwrap();
        fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
        fs::write(dir.path().join("visible.md"), "# Visible\n\nneedle").unwrap();
        fs::write(dir.path().join("ignored/hidden.md"), "# Hidden\n\nneedle").unwrap();

        let hidden = search_vault_with_options(SearchOptions {
            vault_path: dir.path().to_str().unwrap(),
            query: "needle",
            mode: "keyword",
            limit: 10,
            hide_gitignored_files: true,
            exclude_frontmatter: false,
        })
        .unwrap();
        let shown = search_vault_with_options(SearchOptions {
            vault_path: dir.path().to_str().unwrap(),
            query: "needle",
            mode: "keyword",
            limit: 10,
            hide_gitignored_files: false,
            exclude_frontmatter: false,
        })
        .unwrap();

        assert_eq!(hidden.results.len(), 1);
        assert_eq!(hidden.results[0].title, "visible");
        assert_eq!(shown.results.len(), 2);
    }

    #[test]
    fn test_search_vault_can_exclude_frontmatter_from_content_matches() {
        let dir = Builder::new()
            .prefix("search-frontmatter-scope-")
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        fs::write(
            dir.path().join("frontmatter-only.md"),
            [
                "---",
                "Owner: hidden-frontmatter-keyword",
                "---",
                "",
                "# Public Body",
                "",
                "The note body deliberately omits the hidden property token.",
            ]
            .join("\n"),
        )
        .unwrap();
        fs::write(
            dir.path().join("body-match.md"),
            "# Body Match\n\nBody includes hidden-frontmatter-keyword here.",
        )
        .unwrap();

        let response = search_vault_with_options(SearchOptions {
            vault_path: dir.path().to_str().unwrap(),
            query: "hidden-frontmatter-keyword",
            mode: "keyword",
            limit: 10,
            hide_gitignored_files: false,
            exclude_frontmatter: true,
        })
        .unwrap();

        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].title, "body-match");
    }

    #[test]
    fn test_search_worker_count_keeps_small_vaults_on_one_thread() {
        assert_eq!(search_worker_count(0), 1);
        assert_eq!(search_worker_count(1), 1);
        assert_eq!(search_worker_count(MIN_PATHS_PER_SEARCH_WORKER), 1);
    }

    #[test]
    fn test_search_worker_count_adds_workers_only_once_each_has_work() {
        assert_eq!(search_worker_count(MIN_PATHS_PER_SEARCH_WORKER + 1), 2.min(available_cores()));
        assert!(search_worker_count(usize::MAX) <= available_cores());
    }

    fn available_cores() -> usize {
        std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1)
    }

    /// Enough notes to span every worker chunk on any realistic core count.
    const MULTI_WORKER_NOTE_COUNT: usize = 400;

    fn write_equal_scoring_vault(prefix: &str) -> tempfile::TempDir {
        let dir = Builder::new()
            .prefix(prefix)
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        for index in 0..MULTI_WORKER_NOTE_COUNT {
            fs::write(
                dir.path().join(format!("note-{index:04}.md")),
                "Body text with a shared needle token.",
            )
            .unwrap();
        }
        dir
    }

    fn search_result_paths(dir: &Path) -> Vec<String> {
        search_vault_with_options(SearchOptions {
            vault_path: dir.to_str().unwrap(),
            query: "needle",
            mode: "keyword",
            limit: MULTI_WORKER_NOTE_COUNT * 2,
            hide_gitignored_files: false,
            exclude_frontmatter: false,
        })
        .unwrap()
        .results
        .into_iter()
        .map(|result| result.path)
        .collect()
    }

    #[test]
    fn test_search_vault_returns_every_match_across_worker_chunks() {
        let dir = write_equal_scoring_vault("search-chunk-coverage-");

        let paths = search_result_paths(dir.path());

        assert_eq!(paths.len(), MULTI_WORKER_NOTE_COUNT);
        assert_eq!(
            paths.iter().collect::<std::collections::HashSet<_>>().len(),
            MULTI_WORKER_NOTE_COUNT,
            "every matching note must appear exactly once"
        );
    }

    #[test]
    fn test_search_vault_orders_equal_scoring_results_deterministically() {
        let dir = write_equal_scoring_vault("search-chunk-order-");
        let expected = search_result_paths(dir.path());

        for attempt in 0..4 {
            assert_eq!(
                search_result_paths(dir.path()),
                expected,
                "result order drifted on attempt {attempt}"
            );
        }
    }
}
