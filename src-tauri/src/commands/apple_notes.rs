use serde::Serialize;

/// Result of importing/syncing Apple Notes into the active vault.
#[derive(Debug, Default, Serialize, PartialEq, Eq)]
pub struct AppleNotesImportResult {
    /// Notes written as new files.
    pub created: usize,
    /// Existing notes (matched by `apple_notes_id`) rewritten because they changed.
    pub updated: usize,
    /// Existing notes left untouched because their modification date was unchanged.
    pub unchanged: usize,
    /// Notes Notes couldn't export or that failed to write.
    pub failed: usize,
}

/// Progress payload emitted as `apple-notes-import-progress` after each batch.
#[cfg(target_os = "macos")]
#[derive(Clone, Serialize)]
struct ImportProgress {
    processed: usize,
    total: usize,
}

/// Event name the frontend listens on for incremental import progress.
pub const IMPORT_PROGRESS_EVENT: &str = "apple-notes-import-progress";

/// Import notes from the macOS Notes app into the active vault. Re-runnable: notes
/// are matched to existing files by the `apple_notes_id` stored in frontmatter, so
/// changed notes are updated in place and unchanged ones are skipped — no
/// duplicates. New notes are written with their original creation date under
/// `created_key` (the vault's configured created key, default `created`).
///
/// Runs off the async runtime via `spawn_blocking`, fetches in small batches (each
/// a fast, bounded Apple Event), and writes incrementally so the vault watcher
/// surfaces progress.
#[tauri::command]
pub async fn import_apple_notes(
    app_handle: tauri::AppHandle,
    vault_path: String,
    created_key: String,
) -> Result<AppleNotesImportResult, String> {
    log::info!("[apple-notes] import requested for {vault_path}");
    tokio::task::spawn_blocking(move || run_import(&app_handle, &vault_path, &created_key))
        .await
        .map_err(|e| format!("Apple Notes import task panicked: {e}"))?
}

#[cfg(target_os = "macos")]
fn run_import(
    app_handle: &tauri::AppHandle,
    vault_path: &str,
    created_key: &str,
) -> Result<AppleNotesImportResult, String> {
    use tauri::Emitter;
    let app = app_handle.clone();
    let on_progress = move |processed: usize, total: usize| {
        let _ = app.emit(IMPORT_PROGRESS_EVENT, ImportProgress { processed, total });
    };
    macos_impl::run_import(vault_path, created_key, &on_progress)
}

#[cfg(not(target_os = "macos"))]
fn run_import(
    _app_handle: &tauri::AppHandle,
    _vault_path: &str,
    _created_key: &str,
) -> Result<AppleNotesImportResult, String> {
    Err("Apple Notes import is only available on macOS".to_string())
}

#[cfg(any(target_os = "macos", test))]
mod macos_impl {
    use super::AppleNotesImportResult;
    use crate::commands::vault::boundary::{with_boundary, VaultBoundary};
    use std::collections::hash_map::DefaultHasher;
    use std::collections::HashMap;
    use std::hash::{Hash, Hasher};
    use std::path::{Path, PathBuf};

    /// Field separator (ASCII RS) splits a record's fields; record separator
    /// (ASCII GS) splits records. Both are control characters that never occur in
    /// note text.
    const FIELD_SEP: char = '\u{1e}';
    const RECORD_SEP: char = '\u{1d}';

    /// Frontmatter folder tag applied to every imported note.
    const IMPORT_FOLDER: &str = "applenotes";
    /// Frontmatter key holding the stable Apple Notes identifier (a Core Data URI).
    const ID_KEY: &str = "apple_notes_id";
    /// Frontmatter key holding Apple's last-modified timestamp, used to detect change.
    const MODIFIED_KEY: &str = "apple_notes_modified";

    struct RawNote {
        title: String,
        created: String,
        modified: String,
        id: String,
        body: String,
    }

    /// An already-imported note discovered in the vault, keyed by `apple_notes_id`.
    struct ExistingNote {
        path: PathBuf,
        modified: Option<String>,
    }

    enum SyncOutcome {
        Created,
        Updated,
        Unchanged,
    }

    #[cfg(target_os = "macos")]
    pub(super) fn run_import(
        vault_path: &str,
        created_key: &str,
        on_progress: &dyn Fn(usize, usize),
    ) -> Result<AppleNotesImportResult, String> {
        log::info!("[apple-notes] reading all notes from the Notes app (this can take a while for large libraries)…");
        let started = std::time::Instant::now();
        let raw = run_export().map_err(|e| {
            log::error!("[apple-notes] export failed: {e}");
            e
        })?;
        let notes = parse_records(&raw);
        log::info!(
            "[apple-notes] fetched {} note(s) in {:.1}s; syncing into {vault_path}",
            notes.len(),
            started.elapsed().as_secs_f64()
        );
        let key = effective_created_key(created_key);
        let result = with_boundary(Some(vault_path), |boundary| {
            let index = index_existing_notes(boundary.requested_root());
            log::info!("[apple-notes] {} note(s) already imported", index.len());
            Ok(sync_notes(boundary, &key, &notes, &index, on_progress))
        })
        .map_err(|e| {
            log::error!("[apple-notes] sync failed: {e}");
            e
        })?;
        log::info!(
            "[apple-notes] done: {} new, {} updated, {} unchanged, {} failed",
            result.created, result.updated, result.unchanged, result.failed
        );
        Ok(result)
    }

    #[cfg(target_os = "macos")]
    fn run_export() -> Result<String, String> {
        run_osascript(EXPORT_SCRIPT)
    }

    /// Exports every note in a SINGLE osascript process. Positional `note i` is only
    /// stable within one process — spreading it across separate processes let Notes
    /// reorder between calls, which read some notes twice (duplicate ids) and skipped
    /// others. Records are accumulated into a list and joined once (not `&`-appended
    /// in a loop, which is O(n²) and previously hung), and each note is wrapped in
    /// `try` so one bad note can't abort the export. Dates are emitted as a plain `&`
    /// chain (text-first so the result stays text) and zero-padded later in Rust,
    /// avoiding `«class isot»` (fails with `-1700` on recent macOS).
    #[cfg(target_os = "macos")]
    const EXPORT_SCRIPT: &str = concat!(
        "with timeout of 600 seconds\n",
        "  set recordSep to (character id 29)\n",
        "  set fieldSep to (character id 30)\n",
        "  set noteRows to {}\n",
        "  tell application \"Notes\"\n",
        "    set noteCount to count of notes\n",
        "    repeat with i from 1 to noteCount\n",
        "      try\n",
        "        set n to note i\n",
        "        set cd to creation date of n\n",
        "        set md to modification date of n\n",
        "        set createdIso to ((year of cd) as text) & \"-\" & ((month of cd) as integer) & \"-\" & (day of cd) & \"T\" & (hours of cd) & \":\" & (minutes of cd) & \":\" & (seconds of cd)\n",
        "        set modIso to ((year of md) as text) & \"-\" & ((month of md) as integer) & \"-\" & (day of md) & \"T\" & (hours of md) & \":\" & (minutes of md) & \":\" & (seconds of md)\n",
        "        set end of noteRows to ((name of n) & fieldSep & createdIso & fieldSep & modIso & fieldSep & (id of n) & fieldSep & (body of n))\n",
        "      end try\n",
        "    end repeat\n",
        "  end tell\n",
        "  set AppleScript's text item delimiters to recordSep\n",
        "  set out to noteRows as text\n",
        "  set AppleScript's text item delimiters to \"\"\n",
        "  return out\n",
        "end timeout",
    );

    #[cfg(target_os = "macos")]
    fn run_osascript(script: &str) -> Result<String, String> {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| format!("Failed to run osascript: {e}"))?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();
        if message.contains("timed out") {
            return Err(
                "Notes isn't responding. Open the Notes app, let it finish syncing, then try again."
                    .to_string(),
            );
        }
        Err(format!("Apple Notes export failed: {message}"))
    }

    fn parse_records(output: &str) -> Vec<RawNote> {
        output
            .split(RECORD_SEP)
            .filter(|record| !record.trim().is_empty())
            .filter_map(parse_record)
            .collect()
    }

    fn parse_record(record: &str) -> Option<RawNote> {
        let mut fields = record.splitn(5, FIELD_SEP);
        let title = fields.next()?.to_string();
        let created = normalize_created_date(fields.next()?);
        let modified = normalize_created_date(fields.next()?);
        let id = fields.next()?.to_string();
        let body = fields.next().unwrap_or("").to_string();
        Some(RawNote {
            title,
            created,
            modified,
            id,
            body,
        })
    }

    /// Zero-pads the unpadded `Y-M-DTH:M:S` string emitted by AppleScript into a
    /// canonical `%Y-%m-%dT%H:%M:%S` timestamp. Falls back to the trimmed input if
    /// it isn't the expected six numeric components.
    fn normalize_created_date(raw: &str) -> String {
        let parts = raw
            .split(['-', 'T', ':'])
            .map(|token| token.trim().parse::<u32>())
            .collect::<Result<Vec<u32>, _>>();
        match parts.as_deref() {
            Ok([y, mo, d, h, mi, s]) => format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}"),
            _ => raw.trim().to_string(),
        }
    }

    fn sync_notes(
        boundary: &VaultBoundary,
        created_key: &str,
        notes: &[RawNote],
        index: &HashMap<String, ExistingNote>,
        on_progress: &dyn Fn(usize, usize),
    ) -> AppleNotesImportResult {
        let mut result = AppleNotesImportResult::default();
        let total = notes.len();
        for (i, note) in notes.iter().enumerate() {
            match sync_note(boundary, created_key, note, index) {
                Ok(SyncOutcome::Created) => result.created += 1,
                Ok(SyncOutcome::Updated) => result.updated += 1,
                Ok(SyncOutcome::Unchanged) => result.unchanged += 1,
                Err(e) => {
                    result.failed += 1;
                    log::warn!("[apple-notes] skipped {:?}: {e}", note.title);
                }
            }
            if (i + 1) % 25 == 0 {
                on_progress(i + 1, total);
            }
            if (i + 1) % 100 == 0 {
                log::info!(
                    "[apple-notes] synced {}/{} ({} new, {} updated, {} unchanged)",
                    i + 1,
                    total,
                    result.created,
                    result.updated,
                    result.unchanged
                );
            }
        }
        on_progress(total, total);
        result
    }

    fn sync_note(
        boundary: &VaultBoundary,
        created_key: &str,
        note: &RawNote,
        index: &HashMap<String, ExistingNote>,
    ) -> Result<SyncOutcome, String> {
        match existing_match(note, index) {
            Some(existing) if existing.modified.as_deref() == Some(note.modified.as_str()) => {
                Ok(SyncOutcome::Unchanged)
            }
            Some(existing) => write_update(existing, &render_content(boundary, created_key, note)),
            None => write_new(boundary, note, &render_content(boundary, created_key, note)),
        }
    }

    fn existing_match<'a>(
        note: &RawNote,
        index: &'a HashMap<String, ExistingNote>,
    ) -> Option<&'a ExistingNote> {
        if note.id.is_empty() {
            return None;
        }
        index.get(&note.id)
    }

    fn write_update(existing: &ExistingNote, content: &str) -> Result<SyncOutcome, String> {
        std::fs::write(&existing.path, content)
            .map_err(|e| format!("Failed to update {}: {e}", existing.path.display()))?;
        Ok(SyncOutcome::Updated)
    }

    fn write_new(
        boundary: &VaultBoundary,
        note: &RawNote,
        content: &str,
    ) -> Result<SyncOutcome, String> {
        let relative = available_filename(boundary, &safe_note_filename(&note.title))?;
        let path = boundary.child_path(&relative)?;
        crate::vault::create_note_content(&path.to_string_lossy(), content)?;
        Ok(SyncOutcome::Created)
    }

    /// Renders the full note file: frontmatter plus the body, with inline images
    /// extracted to the vault's `attachments/` directory.
    fn render_content(boundary: &VaultBoundary, created_key: &str, note: &RawNote) -> String {
        let attachments_dir = boundary.requested_root().join("attachments");
        let body = render_body(&note.body, &attachments_dir);
        let body = strip_leading_title(&body, &note.title);
        build_note_markdown(created_key, note, &body)
    }

    /// Apple Notes repeats the note title as the first line of the body. Drop that
    /// leading line when it matches the title so it isn't duplicated in the file.
    fn strip_leading_title(body: &str, title: &str) -> String {
        let title = title.trim();
        if title.is_empty() {
            return body.to_string();
        }
        match body.split_once('\n') {
            Some((first, rest)) if first.trim() == title => rest.trim_start().to_string(),
            _ if body.trim() == title => String::new(),
            _ => body.to_string(),
        }
    }

    fn available_filename(boundary: &VaultBoundary, base: &str) -> Result<String, String> {
        for attempt in 0..1000 {
            let name = candidate_md_filename(base, attempt);
            if !boundary.child_path(&name)?.exists() {
                return Ok(name);
            }
        }
        Err(format!("Too many notes named '{base}'"))
    }

    fn candidate_md_filename(base: &str, attempt: usize) -> String {
        if attempt == 0 {
            format!("{base}.md")
        } else {
            format!("{base} {}.md", attempt + 1)
        }
    }

    fn safe_note_filename(title: &str) -> String {
        let cleaned: String = title
            .chars()
            .map(|c| if is_unsafe_filename_char(c) { '-' } else { c })
            .collect();
        let trimmed = cleaned.trim().trim_matches('.').trim();
        if trimmed.is_empty() {
            "Untitled".to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn is_unsafe_filename_char(c: char) -> bool {
        matches!(c, '/' | '\\' | ':') || c.is_control()
    }

    fn effective_created_key(created_key: &str) -> String {
        let trimmed = created_key.trim();
        if trimmed.is_empty() {
            "created".to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn build_note_markdown(created_key: &str, note: &RawNote, body: &str) -> String {
        format!(
            "---\n{created_key}: \"{created}\"\nfolder: {IMPORT_FOLDER}\n{ID_KEY}: \"{id}\"\n{MODIFIED_KEY}: \"{modified}\"\n---\n\n{body}\n",
            created = note.created,
            id = note.id,
            modified = note.modified,
        )
    }

    // --- Inline image extraction ----------------------------------------------

    /// Converts a note's HTML body to Markdown, first extracting inline
    /// `data:image/...;base64,...` images into `attachments_dir` and replacing each
    /// `<img>` with a Markdown image reference.
    fn render_body(html: &str, attachments_dir: &Path) -> String {
        let with_images = replace_images(html, attachments_dir);
        html_to_plain_text(&with_images)
    }

    fn replace_images(html: &str, attachments_dir: &Path) -> String {
        let mut out = String::with_capacity(html.len());
        let mut rest = html;
        while let Some((before, tag, after)) = next_img_tag(rest) {
            out.push_str(before);
            out.push('\n');
            out.push_str(&image_markdown(tag, attachments_dir));
            out.push('\n');
            rest = after;
        }
        out.push_str(rest);
        out
    }

    /// Splits `html` at the first `<img …>` tag, returning (before, tag, after).
    fn next_img_tag(html: &str) -> Option<(&str, &str, &str)> {
        let start = find_case_insensitive(html, "<img")?;
        let end_rel = html[start..].find('>')?;
        let end = start + end_rel + 1;
        Some((&html[..start], &html[start..end], &html[end..]))
    }

    fn image_markdown(tag: &str, attachments_dir: &Path) -> String {
        match tag_src(tag).and_then(parse_data_image) {
            Some((ext, data)) => match save_inline_image(attachments_dir, ext, data) {
                Ok(filename) => format!("![](attachments/{filename})"),
                Err(e) => {
                    log::warn!("[apple-notes] image not saved: {e}");
                    "[missing image]".to_string()
                }
            },
            None => "[missing image]".to_string(),
        }
    }

    /// Extracts the value of the tag's `src="…"` (or `src='…'`) attribute.
    fn tag_src(tag: &str) -> Option<&str> {
        let after_key = &tag[find_case_insensitive(tag, "src=")? + 4..];
        let quote = after_key.chars().next()?;
        if quote != '"' && quote != '\'' {
            return None;
        }
        let inner = &after_key[1..];
        let end = inner.find(quote)?;
        Some(&inner[..end])
    }

    /// Parses a `data:image/<subtype>;base64,<data>` URI into (extension, data).
    fn parse_data_image(src: &str) -> Option<(String, &str)> {
        let rest = src.strip_prefix("data:image/")?;
        let (mime, data) = rest.split_once(";base64,")?;
        let subtype = mime.split(';').next().unwrap_or("");
        Some((image_extension(subtype), data))
    }

    fn image_extension(subtype: &str) -> String {
        match subtype.to_ascii_lowercase().as_str() {
            "jpeg" | "jpg" => "jpg".to_string(),
            "" => "img".to_string(),
            other => other.to_string(),
        }
    }

    /// Writes the decoded image to `attachments_dir` under a content-hashed name
    /// (so identical images dedupe and re-syncs don't rewrite them) and returns the
    /// filename. Skips the write when the file already exists.
    fn save_inline_image(
        attachments_dir: &Path,
        ext: String,
        base64_data: &str,
    ) -> Result<String, String> {
        use base64::Engine;
        let mut hasher = DefaultHasher::new();
        base64_data.hash(&mut hasher);
        let filename = format!("applenotes-{:016x}.{ext}", hasher.finish());
        let path = attachments_dir.join(&filename);
        if path.exists() {
            return Ok(filename);
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(base64_data.trim())
            .map_err(|e| format!("invalid base64: {e}"))?;
        std::fs::create_dir_all(attachments_dir)
            .map_err(|e| format!("could not create attachments dir: {e}"))?;
        std::fs::write(&path, bytes).map_err(|e| format!("could not write {filename}: {e}"))?;
        Ok(filename)
    }

    /// Case-insensitive byte search that returns the index in the original string
    /// without allocating a lowercased copy.
    fn find_case_insensitive(haystack: &str, needle_lower: &str) -> Option<usize> {
        let (hay, needle) = (haystack.as_bytes(), needle_lower.as_bytes());
        if needle.is_empty() || hay.len() < needle.len() {
            return None;
        }
        (0..=hay.len() - needle.len()).find(|&i| {
            hay[i..i + needle.len()]
                .iter()
                .zip(needle)
                .all(|(h, n)| h.to_ascii_lowercase() == *n)
        })
    }

    // --- Existing-note index (match by apple_notes_id) -------------------------

    fn index_existing_notes(root: &Path) -> HashMap<String, ExistingNote> {
        let mut index = HashMap::new();
        collect_into_index(root, &mut index);
        index
    }

    fn collect_into_index(dir: &Path, index: &mut HashMap<String, ExistingNote>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                collect_into_index(&path, index);
            } else if name.ends_with(".md") {
                index_note_file(&path, index);
            }
        }
    }

    fn index_note_file(path: &Path, index: &mut HashMap<String, ExistingNote>) {
        let Ok(content) = std::fs::read_to_string(path) else {
            return;
        };
        let Some(block) = frontmatter_block(&content) else {
            return;
        };
        let Some(id) = read_frontmatter_value(block, ID_KEY).filter(|id| !id.is_empty()) else {
            return;
        };
        let modified = read_frontmatter_value(block, MODIFIED_KEY);
        index.entry(id).or_insert(ExistingNote {
            path: path.to_path_buf(),
            modified,
        });
    }

    /// Returns the text between the opening `---` line and the next `---` line, or
    /// `None` if the content has no leading frontmatter block.
    fn frontmatter_block(content: &str) -> Option<&str> {
        let rest = content.strip_prefix("---")?;
        let rest = rest
            .strip_prefix('\n')
            .or_else(|| rest.strip_prefix("\r\n"))?;
        let end = rest.find("\n---")?;
        Some(&rest[..end])
    }

    fn read_frontmatter_value(block: &str, key: &str) -> Option<String> {
        block.lines().find_map(|line| {
            let rest = line.trim().strip_prefix(key)?.trim_start();
            let value = rest.strip_prefix(':')?.trim();
            Some(unquote(value).to_string())
        })
    }

    fn unquote(value: &str) -> &str {
        value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .unwrap_or(value)
    }

    // --- HTML -> plain text ----------------------------------------------------

    fn html_to_plain_text(html: &str) -> String {
        let markdown = html_to_markdown_lines(html);
        let decoded = decode_entities(&markdown);
        collapse_blank_lines(&decoded)
    }

    /// One ordered/unordered list level: whether it's numbered, and its running
    /// item counter.
    struct ListContext {
        ordered: bool,
        counter: usize,
    }

    /// Walks the HTML, converting `<ol>`/`<ul>`/`<li>` into Markdown list markers
    /// (`1.`/`-`, indented by nesting depth) and other block tags into line breaks,
    /// while stripping the rest.
    fn html_to_markdown_lines(html: &str) -> String {
        let mut out = String::with_capacity(html.len());
        let mut stack: Vec<ListContext> = Vec::new();
        let mut chars = html.chars();
        while let Some(c) = chars.next() {
            if c != '<' {
                out.push(c);
                continue;
            }
            let mut tag = String::new();
            for t in chars.by_ref() {
                if t == '>' {
                    break;
                }
                tag.push(t);
            }
            apply_tag(&tag, &mut out, &mut stack);
        }
        out
    }

    fn apply_tag(tag: &str, out: &mut String, stack: &mut Vec<ListContext>) {
        let (is_close, rest) = match tag.trim().strip_prefix('/') {
            Some(rest) => (true, rest),
            None => (false, tag.trim()),
        };
        let name = rest
            .split(|c: char| c.is_whitespace() || c == '/')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        match name.as_str() {
            "ol" | "ul" => {
                if is_close {
                    stack.pop();
                } else {
                    stack.push(ListContext {
                        ordered: name == "ol",
                        counter: 0,
                    });
                }
                ensure_newline(out);
            }
            "li" if !is_close => push_list_marker(out, stack),
            "br" => out.push('\n'),
            // A block element starts a new line. Only the opening tag breaks the
            // line, and only when not already at one, so consecutive lines stay
            // adjacent instead of gaining a blank line from the matching close
            // tag plus the source newline. Explicit blank lines come from `<br>`;
            // lists manage their own breaks.
            "div" | "p" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
                if stack.is_empty() && !is_close =>
            {
                ensure_newline(out)
            }
            _ => {}
        }
    }

    /// Pushes a newline unless `out` is empty or already ends with one, so block
    /// boundaries collapse to a single break instead of stacking up.
    fn ensure_newline(out: &mut String) {
        if !matches!(out.chars().last(), None | Some('\n')) {
            out.push('\n');
        }
    }

    fn push_list_marker(out: &mut String, stack: &mut [ListContext]) {
        while matches!(out.chars().last(), Some(' ' | '\t' | '\r' | '\n')) {
            out.pop();
        }
        out.push('\n');
        for _ in 0..stack.len().saturating_sub(1) {
            out.push_str("  ");
        }
        match stack.last_mut() {
            Some(ctx) if ctx.ordered => {
                ctx.counter += 1;
                out.push_str(&format!("{}. ", ctx.counter));
            }
            _ => out.push_str("- "),
        }
    }

    fn decode_entities(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut rest = input;
        while let Some(amp) = rest.find('&') {
            out.push_str(&rest[..amp]);
            rest = decode_next_entity(&rest[amp..], &mut out);
        }
        out.push_str(rest);
        out
    }

    /// Decodes the entity at the start of `after` (which begins with `&`), pushing
    /// the result into `out`, and returns the remaining unprocessed slice.
    fn decode_next_entity<'a>(after: &'a str, out: &mut String) -> &'a str {
        match after.find(';').filter(|&semi| semi <= 10) {
            Some(semi) => match decode_entity(&after[1..semi]) {
                Some(ch) => {
                    out.push(ch);
                    &after[semi + 1..]
                }
                None => {
                    out.push_str(&after[..=semi]);
                    &after[semi + 1..]
                }
            },
            None => {
                out.push('&');
                &after[1..]
            }
        }
    }

    fn decode_entity(entity: &str) -> Option<char> {
        match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => decode_numeric_entity(entity),
        }
    }

    fn decode_numeric_entity(entity: &str) -> Option<char> {
        let code = match entity.strip_prefix('#') {
            Some(rest) => parse_numeric_code(rest)?,
            None => return None,
        };
        char::from_u32(code)
    }

    fn parse_numeric_code(rest: &str) -> Option<u32> {
        match rest.strip_prefix('x').or_else(|| rest.strip_prefix('X')) {
            Some(hex) => u32::from_str_radix(hex, 16).ok(),
            None => rest.parse().ok(),
        }
    }

    fn collapse_blank_lines(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut newline_run = 0usize;
        for c in input.chars() {
            if c == '\n' {
                newline_run += 1;
                if newline_run <= 2 {
                    out.push('\n');
                }
            } else {
                newline_run = 0;
                out.push(c);
            }
        }
        out.trim().to_string()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn records(rows: &[(&str, &str, &str, &str, &str)]) -> String {
            rows.iter()
                .map(|(name, created, modified, id, body)| {
                    format!("{name}{FIELD_SEP}{created}{FIELD_SEP}{modified}{FIELD_SEP}{id}{FIELD_SEP}{body}")
                })
                .collect::<Vec<_>>()
                .join(&RECORD_SEP.to_string())
        }

        fn sync_to_temp(
            vault: &Path,
            notes: &[RawNote],
        ) -> AppleNotesImportResult {
            let vault_path = vault.to_string_lossy().into_owned();
            with_boundary(Some(&vault_path), |boundary| {
                let index = index_existing_notes(boundary.requested_root());
                Ok(sync_notes(boundary, "created", notes, &index, &|_, _| {}))
            })
            .unwrap()
        }

        #[test]
        fn parses_all_five_fields_and_normalizes_dates() {
            let output = records(&[("First", "2026-1-2T3:4:5", "2026-1-2T3:4:5", "x://1", "<div>Hi</div>")]);
            let notes = parse_records(&output);
            assert_eq!(notes.len(), 1);
            assert_eq!(notes[0].title, "First");
            assert_eq!(notes[0].created, "2026-01-02T03:04:05");
            assert_eq!(notes[0].modified, "2026-01-02T03:04:05");
            assert_eq!(notes[0].id, "x://1");
            assert_eq!(notes[0].body, "<div>Hi</div>");
        }

        #[test]
        fn zero_pads_unpadded_dates() {
            assert_eq!(normalize_created_date("2026-4-13T12:0:56"), "2026-04-13T12:00:56");
            assert_eq!(normalize_created_date("2026-01-02T03:04:05"), "2026-01-02T03:04:05");
            assert_eq!(normalize_created_date("  whenever  "), "whenever");
        }

        #[test]
        fn skips_blank_and_empty_records() {
            assert!(parse_records("").is_empty());
            let output = format!("{}{RECORD_SEP}", records(&[("Only", "d", "d", "id", "x")]));
            assert_eq!(parse_records(&output).len(), 1);
        }

        #[test]
        fn converts_block_tags_to_newlines() {
            assert_eq!(
                html_to_plain_text("<div>Hello</div><div><br></div><div>World</div>"),
                "Hello\n\nWorld"
            );
        }

        #[test]
        fn keeps_consecutive_lines_adjacent() {
            // Apple Notes separates each line with `</div>\n<div>`. Consecutive
            // content lines must stay adjacent, not gain a blank line from the
            // matching close tag plus the source newline.
            let html =
                "<div><h1><br></h1></div>\n<div>Pears</div>\n<div>Coconut milk</div>\n<div>Lemon</div>";
            assert_eq!(html_to_plain_text(html), "Pears\nCoconut milk\nLemon");
        }

        #[test]
        fn keeps_line_after_bold_first_line_adjacent() {
            // Apple Notes styles the title line as bold/heading; the following
            // line must not be pushed onto a separate paragraph.
            let html = "<div><b>Shopping</b></div>\n<div>milk</div>";
            assert_eq!(html_to_plain_text(html), "Shopping\nmilk");
        }

        #[test]
        fn converts_ordered_list_to_numbered_markdown() {
            let html = "<ol>\n<li>Elizabeth</li>\n<li>Liz</li>\n<li>Joseph</li>\n</ol>";
            assert_eq!(html_to_plain_text(html), "1. Elizabeth\n2. Liz\n3. Joseph");
        }

        #[test]
        fn converts_unordered_list_to_bullets() {
            assert_eq!(
                html_to_plain_text("<ul><li>milk</li><li>eggs</li></ul>"),
                "- milk\n- eggs"
            );
        }

        #[test]
        fn indents_nested_lists() {
            let html = "<ul><li>top</li><ul><li>sub</li></ul></ul>";
            assert_eq!(html_to_plain_text(html), "- top\n  - sub");
        }

        #[test]
        fn keeps_title_then_list_for_real_note_markup() {
            let html = "<div><h1>June 20</h1></div>\n<div><br></div>\n<ol>\n<li>Elizabeth Thomas</li>\n<li>Liz Easterbrooks</li>\n</ol>\n<div><br></div>";
            // title still leads (stripped later by strip_leading_title)
            assert_eq!(
                html_to_plain_text(html),
                "June 20\n1. Elizabeth Thomas\n2. Liz Easterbrooks"
            );
            assert_eq!(
                strip_leading_title(&html_to_plain_text(html), "June 20"),
                "1. Elizabeth Thomas\n2. Liz Easterbrooks"
            );
        }

        #[test]
        fn decodes_named_and_numeric_entities() {
            let html = "<div>a &amp; b &lt;c&gt; &#39;q&#39; &#x41; &nbsp;end</div>";
            assert_eq!(html_to_plain_text(html), "a & b <c> 'q' A  end");
        }

        #[test]
        fn sanitizes_filename() {
            assert_eq!(safe_note_filename("a/b:c\\d"), "a-b-c-d");
            assert_eq!(safe_note_filename("   "), "Untitled");
            assert_eq!(safe_note_filename("Meeting notes"), "Meeting notes");
        }

        #[test]
        fn builds_frontmatter_with_identity_fields() {
            let note = RawNote {
                title: "T".into(),
                created: "2026-01-02T03:04:05".into(),
                modified: "2026-02-03T04:05:06".into(),
                id: "x://1".into(),
                body: "body".into(),
            };
            let md = build_note_markdown("date", &note, "body");
            assert_eq!(
                md,
                "---\ndate: \"2026-01-02T03:04:05\"\nfolder: applenotes\napple_notes_id: \"x://1\"\napple_notes_modified: \"2026-02-03T04:05:06\"\n---\n\nbody\n"
            );
        }

        #[test]
        fn extracts_inline_image_to_attachments() {
            use base64::Engine;
            let dir = tempfile::TempDir::new().unwrap();
            let attachments = dir.path().join("attachments");
            let data = base64::engine::general_purpose::STANDARD.encode(b"\xff\xd8\xff jpeg bytes");
            let html = format!(
                "<div>before</div><div><img style=\"x\" src=\"data:image/jpeg;base64,{data}\"></div><div>after</div>"
            );

            let body = render_body(&html, &attachments);

            // body references the saved file, not the base64 blob
            assert!(body.contains("![](attachments/applenotes-"));
            assert!(body.contains(".jpg)"));
            assert!(body.contains("before") && body.contains("after"));
            assert!(!body.contains("base64"));

            // exactly one image file was written, with the decoded bytes
            let files: Vec<_> = std::fs::read_dir(&attachments).unwrap().flatten().collect();
            assert_eq!(files.len(), 1);
            assert_eq!(std::fs::read(files[0].path()).unwrap(), b"\xff\xd8\xff jpeg bytes");
        }

        #[test]
        fn dedupes_identical_inline_images_across_runs() {
            use base64::Engine;
            let dir = tempfile::TempDir::new().unwrap();
            let attachments = dir.path().join("attachments");
            let data = base64::engine::general_purpose::STANDARD.encode(b"png");
            let html = format!("<img src=\"data:image/png;base64,{data}\">");

            let first = render_body(&html, &attachments);
            let second = render_body(&html, &attachments);

            assert_eq!(first, second);
            assert_eq!(std::fs::read_dir(&attachments).unwrap().count(), 1);
        }

        #[test]
        fn leaves_placeholder_for_non_data_image() {
            let dir = tempfile::TempDir::new().unwrap();
            let body = render_body(
                "<div><img src=\"cid:abc@icloud\"></div>",
                &dir.path().join("attachments"),
            );
            assert_eq!(body, "[missing image]");
            assert!(!dir.path().join("attachments").exists());
        }

        #[test]
        fn strips_leading_title_line_when_it_matches() {
            assert_eq!(strip_leading_title("Groceries\nmilk\neggs", "Groceries"), "milk\neggs");
            // title-only note becomes empty
            assert_eq!(strip_leading_title("Groceries", "Groceries"), "");
            // first line differs -> untouched
            assert_eq!(strip_leading_title("milk\neggs", "Groceries"), "milk\neggs");
            // blank title -> untouched
            assert_eq!(strip_leading_title("anything", ""), "anything");
        }

        #[test]
        fn maps_image_subtypes_to_extensions() {
            assert_eq!(image_extension("jpeg"), "jpg");
            assert_eq!(image_extension("JPG"), "jpg");
            assert_eq!(image_extension("png"), "png");
            assert_eq!(image_extension(""), "img");
        }

        #[test]
        fn reads_frontmatter_values() {
            let content = "---\ncreated: \"2026-01-02T03:04:05\"\napple_notes_id: \"x://7\"\n---\n\nbody\n";
            let block = frontmatter_block(content).unwrap();
            assert_eq!(read_frontmatter_value(block, "apple_notes_id").as_deref(), Some("x://7"));
            assert_eq!(read_frontmatter_value(block, "missing"), None);
            assert_eq!(frontmatter_block("no frontmatter"), None);
        }

        #[test]
        fn creates_then_updates_then_skips_unchanged() {
            let vault = tempfile::TempDir::new().unwrap();

            // First sync: two distinct notes are created.
            let first = parse_records(&records(&[
                ("Trip", "2026-01-02T03:04:05", "2026-01-02T03:04:05", "x://a", "<div>Pack &amp; go</div>"),
                ("Plan", "2026-03-04T05:06:07", "2026-03-04T05:06:07", "x://b", "first"),
            ]));
            let r1 = sync_to_temp(vault.path(), &first);
            assert_eq!((r1.created, r1.updated, r1.unchanged), (2, 0, 0));
            let trip = std::fs::read_to_string(vault.path().join("Trip.md")).unwrap();
            assert!(trip.contains("apple_notes_id: \"x://a\""));
            assert!(trip.contains("Pack & go"));

            // Re-running with identical data updates nothing.
            let r2 = sync_to_temp(vault.path(), &first);
            assert_eq!((r2.created, r2.updated, r2.unchanged), (0, 0, 2));

            // Bumping one note's modification date updates only that note in place.
            let second = parse_records(&records(&[
                ("Trip", "2026-01-02T03:04:05", "2026-09-09T09:09:09", "x://a", "<div>Changed</div>"),
                ("Plan", "2026-03-04T05:06:07", "2026-03-04T05:06:07", "x://b", "first"),
            ]));
            let r3 = sync_to_temp(vault.path(), &second);
            assert_eq!((r3.created, r3.updated, r3.unchanged), (0, 1, 1));
            let trip = std::fs::read_to_string(vault.path().join("Trip.md")).unwrap();
            assert!(trip.contains("Changed"));
            assert!(trip.contains("apple_notes_modified: \"2026-09-09T09:09:09\""));
            // No duplicate file was created.
            assert!(!vault.path().join("Trip 2.md").exists());
        }

        #[test]
        fn dedupes_distinct_notes_sharing_a_title() {
            let vault = tempfile::TempDir::new().unwrap();
            let notes = parse_records(&records(&[
                ("Note", "2026-01-01T00:00:00", "2026-01-01T00:00:00", "x://1", "one"),
                ("Note", "2026-01-01T00:00:00", "2026-01-01T00:00:00", "x://2", "two"),
            ]));
            let result = sync_to_temp(vault.path(), &notes);
            assert_eq!(result.created, 2);
            assert!(vault.path().join("Note.md").exists());
            assert!(vault.path().join("Note 2.md").exists());
        }
    }
}
