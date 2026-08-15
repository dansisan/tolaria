//! Which date keys a note is missing, and what they should be.
//!
//! A note carries its dates in its frontmatter, so one written by something other
//! than Tolaria arrives without them.

use chrono::{Datelike, Local, NaiveDate, TimeZone};

use super::frontmatter_has_key;

/// The weekday names `dayCreated` uses, matching what new-note creation writes.
const SHORT_DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/// The datetime shape Tolaria writes for `created` and `modified`: naive local
/// time, read back in the machine's ambient zone (see `parse_md_file`).
const DATETIME_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

pub const DAY_CREATED_KEY: &str = "dayCreated";
pub const MODIFIED_KEY: &str = "modified";

/// Frontmatter date values for one note, already formatted for writing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteDates {
    pub created: String,
    pub day_created: String,
    pub modified: String,
}

/// The date keys a note is missing, in the order they would be written.
/// `created_key` is the vault's configured created key.
pub fn missing_date_keys(content: &str, created_key: &str) -> Vec<String> {
    [created_key, DAY_CREATED_KEY, MODIFIED_KEY]
        .into_iter()
        .filter(|key| !frontmatter_has_key(content, key))
        .map(str::to_string)
        .collect()
}

/// The dates a note should carry, from its filename and filesystem timestamps.
///
/// A date-shaped filename wins for `created` — a daily note records the day it is
/// about, while its birth time only records when it reached this machine. `now` is
/// the last resort when the platform reports no timestamp.
pub fn resolve_note_dates(
    filename: &str,
    fs_created: Option<u64>,
    fs_modified: Option<u64>,
    now: chrono::DateTime<Local>,
) -> NoteDates {
    let created = date_from_filename(filename)
        .and_then(local_start_of_day)
        .or_else(|| fs_created.and_then(local_datetime))
        .unwrap_or(now);
    let modified = fs_modified.and_then(local_datetime).unwrap_or(now);

    NoteDates {
        created: created.format(DATETIME_FORMAT).to_string(),
        day_created: SHORT_DAYS[created.weekday().num_days_from_sunday() as usize].to_string(),
        modified: modified.format(DATETIME_FORMAT).to_string(),
    }
}

/// The value belonging to one date key.
pub fn note_date_value<'dates>(
    dates: &'dates NoteDates,
    key: &str,
    created_key: &str,
) -> &'dates str {
    match key {
        DAY_CREATED_KEY => &dates.day_created,
        MODIFIED_KEY => &dates.modified,
        _ if key == created_key => &dates.created,
        _ => "",
    }
}

/// A filename whose stem is exactly a `YYYY-MM-DD` date. Strict on purpose: a stem
/// that merely starts with a date is a title, and guessing would stamp the wrong day.
fn date_from_filename(filename: &str) -> Option<NaiveDate> {
    let stem = filename
        .strip_suffix(".md")
        .or_else(|| filename.strip_suffix(".markdown"))
        .unwrap_or(filename);

    NaiveDate::parse_from_str(stem, "%Y-%m-%d").ok()
}

fn local_start_of_day(date: NaiveDate) -> Option<chrono::DateTime<Local>> {
    Local
        .from_local_datetime(&date.and_hms_opt(0, 0, 0)?)
        .single()
}

fn local_datetime(seconds: u64) -> Option<chrono::DateTime<Local>> {
    Local.timestamp_opt(seconds as i64, 0).single()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str) -> chrono::DateTime<Local> {
        Local
            .from_local_datetime(
                &chrono::NaiveDateTime::parse_from_str(text, DATETIME_FORMAT).unwrap(),
            )
            .single()
            .unwrap()
    }

    fn seconds(text: &str) -> u64 {
        at(text).timestamp() as u64
    }

    #[test]
    fn reports_every_missing_date_key() {
        let content = "# Dropped by an agent\n\nBody\n";

        assert_eq!(
            missing_date_keys(content, "created"),
            vec!["created", "dayCreated", "modified"]
        );
    }

    #[test]
    fn reports_only_the_keys_that_are_absent() {
        let content = "---\ncreated: \"2026-01-02 03:04:05\"\n---\n# Note\n";

        assert_eq!(
            missing_date_keys(content, "created"),
            vec!["dayCreated", "modified"]
        );
    }

    #[test]
    fn reports_nothing_for_a_fully_dated_note() {
        let content = concat!(
            "---\n",
            "created: \"2026-01-02 03:04:05\"\n",
            "dayCreated: Fri\n",
            "modified: \"2026-01-03 03:04:05\"\n",
            "---\n# Note\n"
        );

        assert!(missing_date_keys(content, "created").is_empty());
    }

    /// A vault that renames its created key must be reported against that name.
    #[test]
    fn honors_a_vault_configured_created_key() {
        let content = "---\ndate: \"2026-01-02 03:04:05\"\n---\n# Note\n";

        assert_eq!(
            missing_date_keys(content, "date"),
            vec!["dayCreated", "modified"]
        );
    }

    #[test]
    fn takes_created_from_a_date_shaped_filename() {
        let dates = resolve_note_dates(
            "2025-12-17.md",
            Some(seconds("2026-06-14 12:17:00")),
            Some(seconds("2026-06-20 12:59:00")),
            at("2026-08-14 09:00:00"),
        );

        assert_eq!(dates.created, "2025-12-17 00:00:00");
        assert_eq!(dates.day_created, "Wed");
        assert_eq!(dates.modified, "2026-06-20 12:59:00");
    }

    #[test]
    fn falls_back_to_the_filesystem_birth_time() {
        let dates = resolve_note_dates(
            "dropped-by-an-agent.md",
            Some(seconds("2026-06-14 12:17:00")),
            Some(seconds("2026-06-20 12:59:00")),
            at("2026-08-14 09:00:00"),
        );

        assert_eq!(dates.created, "2026-06-14 12:17:00");
        assert_eq!(dates.day_created, "Sun");
        assert_eq!(dates.modified, "2026-06-20 12:59:00");
    }

    /// A stem that only starts with a date is a title; guessing would stamp the
    /// wrong day.
    #[test]
    fn treats_a_date_prefixed_title_as_a_title() {
        let dates = resolve_note_dates(
            "2025-12-17-draft.md",
            Some(seconds("2026-06-14 12:17:00")),
            None,
            at("2026-08-14 09:00:00"),
        );

        assert_eq!(dates.created, "2026-06-14 12:17:00");
    }

    #[test]
    fn uses_now_when_the_platform_reports_no_timestamps() {
        let dates = resolve_note_dates("note.md", None, None, at("2026-08-14 09:00:00"));

        assert_eq!(dates.created, "2026-08-14 09:00:00");
        assert_eq!(dates.modified, "2026-08-14 09:00:00");
        assert_eq!(dates.day_created, "Fri");
    }

    #[test]
    fn resolves_each_key_to_its_own_value() {
        let dates = resolve_note_dates(
            "note.md",
            Some(seconds("2026-06-14 12:17:00")),
            Some(seconds("2026-06-20 12:59:00")),
            at("2026-08-14 09:00:00"),
        );

        assert_eq!(
            note_date_value(&dates, "created", "created"),
            "2026-06-14 12:17:00"
        );
        assert_eq!(note_date_value(&dates, "dayCreated", "created"), "Sun");
        assert_eq!(
            note_date_value(&dates, "modified", "created"),
            "2026-06-20 12:59:00"
        );
    }

    /// A vault that renames its created key still resolves to the created value.
    #[test]
    fn resolves_a_vault_configured_created_key() {
        let dates = resolve_note_dates(
            "note.md",
            Some(seconds("2026-06-14 12:17:00")),
            None,
            at("2026-08-14 09:00:00"),
        );

        assert_eq!(
            note_date_value(&dates, "date", "date"),
            "2026-06-14 12:17:00"
        );
    }

    #[test]
    fn an_unrecognized_key_resolves_to_nothing() {
        let dates = resolve_note_dates("note.md", None, None, at("2026-08-14 09:00:00"));

        assert_eq!(note_date_value(&dates, "unrelated", "created"), "");
    }
}
