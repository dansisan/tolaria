//! Computed ("derived") frontmatter fields.
//!
//! [`apply_derived_frontmatter`] is the single source of truth for frontmatter
//! that is recomputed from the note's content on every save (see
//! `save_note_content`). It also backs any backfill that re-derives these fields
//! across a whole vault, so the save path and the bulk path can never drift.
//!
//! Each stamper owns its own write policy: `modified` updates only when the
//! note already declares the key, while `codeBlocks` is added as soon as a note
//! contains code (and then kept in sync). Neither forces frontmatter onto a
//! plain prose note that has nothing to record.

use super::ops::content_body;
use super::{frontmatter_has_key, stamp_modified_date, update_frontmatter_content, FrontmatterValue};

/// Inputs for derived fields that can't be computed from the content alone.
/// Injected (rather than read from the clock) so the pipeline stays pure and
/// testable.
pub struct DeriveContext {
    pub timestamp: String,
}

/// Recompute every derived frontmatter field and return the updated content.
/// Runs on the save path. Pure `&str -> String`: callers compare against the
/// input to decide whether a write is actually needed.
pub fn apply_derived_frontmatter(content: &str, ctx: &DeriveContext) -> String {
    let content = stamp_modified_date(content, &ctx.timestamp);
    apply_content_frontmatter(&content)
}

/// Recompute only the frontmatter fields that depend solely on note content
/// (e.g. `codeBlocks`), leaving edit-time fields like `modified` alone. This is
/// the pipeline a bulk backfill runs across an existing vault — re-deriving
/// `modified` there would rewrite every note's timestamp, which a migration
/// must not do.
pub fn apply_content_frontmatter(content: &str) -> String {
    stamp_code_block_count(content)
}

/// Refresh the `codeBlocks` count. The key is added as soon as a note contains
/// at least one fenced code block, and thereafter kept in sync (including back
/// down to `0` once present). A prose note that has never contained code — and
/// so has no key — is left untouched, so frontmatter is never forced onto it.
pub fn stamp_code_block_count(content: &str) -> String {
    let count = count_fenced_code_blocks(content);
    if count == 0 && !frontmatter_has_key(content, "codeBlocks") {
        return content.to_string();
    }
    update_frontmatter_content(
        content,
        "codeBlocks",
        Some(FrontmatterValue::Number(f64::from(count))),
    )
    .unwrap_or_else(|_| content.to_string())
}

/// Count fenced code blocks (```` ``` ```` or `~~~`) in the note body. A block
/// opens on the first fence line and closes on a later line of the same marker
/// character whose run is at least as long, matching how the rest of the app
/// detects fences.
fn count_fenced_code_blocks(content: &str) -> u32 {
    let body = content_body(content);
    let mut count = 0;
    let mut open: Option<Fence> = None;

    for line in body.lines() {
        let Some(fence) = Fence::at_line_start(line) else {
            continue;
        };
        match open {
            None => {
                open = Some(fence);
                count += 1;
            }
            Some(current) if fence.closes(current) => open = None,
            Some(_) => {}
        }
    }

    count
}

/// A run of fence characters at the start of a (left-trimmed) line.
#[derive(Clone, Copy)]
struct Fence {
    marker: char,
    length: usize,
}

impl Fence {
    fn at_line_start(line: &str) -> Option<Fence> {
        let trimmed = line.trim_start();
        let marker = trimmed.chars().next().filter(|&c| c == '`' || c == '~')?;
        let length = trimmed.chars().take_while(|&c| c == marker).count();
        (length >= 3).then_some(Fence { marker, length })
    }

    /// A fence closes an open one when it uses the same marker and is at least
    /// as long (so a longer opening fence can embed shorter ones).
    fn closes(self, open: Fence) -> bool {
        self.marker == open.marker && self.length >= open.length
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note_with_code_blocks_key(body: &str) -> String {
        format!("---\ntitle: Note\ncodeBlocks: 0\n---\n{body}")
    }

    #[test]
    fn counts_basic_fenced_blocks() {
        assert_eq!(count_fenced_code_blocks("```\ncode\n```\n"), 1);
        assert_eq!(
            count_fenced_code_blocks("```rust\na\n```\n\ntext\n\n```\nb\n```\n"),
            2
        );
    }

    #[test]
    fn ignores_inline_code_and_short_runs() {
        assert_eq!(
            count_fenced_code_blocks("Some `inline` and ``double`` code\n"),
            0
        );
    }

    #[test]
    fn counts_tilde_fences_and_treats_longer_opener_as_one_block() {
        assert_eq!(count_fenced_code_blocks("~~~\ncode\n~~~\n"), 1);
        // A four-backtick fence wraps a three-backtick block: one outer block.
        assert_eq!(count_fenced_code_blocks("````\n```\ninner\n```\n````\n"), 1);
    }

    #[test]
    fn ignores_fence_characters_inside_frontmatter() {
        let content = "---\ntemplate: |\n  ```\n  not a body block\n  ```\n---\n# Note\n";
        assert_eq!(count_fenced_code_blocks(content), 0);
    }

    #[test]
    fn stamp_updates_existing_key_with_block_count() {
        let content = note_with_code_blocks_key("# Note\n\n```\ncode\n```\n");
        let stamped = stamp_code_block_count(&content);
        assert!(stamped.contains("codeBlocks: 1"));
        assert!(!stamped.contains("codeBlocks: 0"));
        assert!(stamped.contains("# Note"));
    }

    #[test]
    fn stamp_writes_zero_when_note_has_no_code_blocks() {
        let content = note_with_code_blocks_key("# Note\n\nJust prose.\n");
        assert!(stamp_code_block_count(&content).contains("codeBlocks: 0"));
    }

    #[test]
    fn stamp_adds_key_when_a_note_with_frontmatter_gains_code() {
        let content = "---\ntitle: Note\n---\n# Note\n\n```\ncode\n```\n";
        let stamped = stamp_code_block_count(content);
        assert!(stamped.contains("codeBlocks: 1"));
        assert!(stamped.contains("title: Note"));
    }

    #[test]
    fn stamp_creates_frontmatter_for_a_plain_note_that_contains_code() {
        let stamped = stamp_code_block_count("# Note\n\n```\ncode\n```\n");
        assert!(stamped.starts_with("---\n"));
        assert!(stamped.contains("codeBlocks: 1"));
        assert!(stamped.contains("# Note"));
    }

    #[test]
    fn stamp_leaves_prose_notes_without_code_or_key_alone() {
        for content in [
            "---\ntitle: Note\n---\n# Note\n\nJust prose.\n",
            "# Note\n\nJust prose.\n",
        ] {
            assert_eq!(stamp_code_block_count(content), content);
        }
    }

    #[test]
    fn pipeline_refreshes_modified_and_code_blocks_together() {
        let content =
            "---\nmodified: 2020-01-01 00:00:00\ncodeBlocks: 9\n---\n# Note\n\n```\ncode\n```\n";
        let ctx = DeriveContext {
            timestamp: "2026-06-09 12:00:00".to_string(),
        };
        let derived = apply_derived_frontmatter(content, &ctx);
        assert!(derived.contains("2026-06-09 12:00:00"));
        assert!(derived.contains("codeBlocks: 1"));
        assert!(!derived.contains("2020-01-01"));
    }

    #[test]
    fn content_pipeline_updates_code_blocks_without_touching_modified() {
        let content =
            "---\nmodified: 2020-01-01 00:00:00\ncodeBlocks: 9\n---\n# Note\n\n```\ncode\n```\n";
        let derived = apply_content_frontmatter(content);
        assert!(derived.contains("codeBlocks: 1"));
        // A backfill is a migration, not an edit — the modified date is preserved.
        assert!(derived.contains("2020-01-01 00:00:00"));
    }
}
