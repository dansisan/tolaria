# Notes

A note is a Markdown file with optional YAML frontmatter, kept on disk as the durable representation.

## Anatomy

```md
---
type: Note
status: Active
belongs_to:
  - "[[workspace]]"
---

Draft the public Tolaria docs and keep them close to code changes.
```

## Titles

A note's filename is its title. Tolaria uses that filename wherever the note is displayed: note lists, search results, wikilink suggestions, relationship pickers, tabs, and window titles. There's no separate title field to keep in sync — rename the file (via the breadcrumb, or in Finder/Explorer) to retitle the note.

Structured [Types](/concepts/types) are the one exception: an instance of a type (for example a `Project` or `Person` record) may still carry a frontmatter `title:` field or a first-H1 heading as a display name distinct from its filename, since those records often aren't free-form prose.

## Body Links

Use `[[wikilinks]]` to connect notes from the body. Tolaria shows autocomplete suggestions while you type, and links resolve by filename (or by title, for structured Types whose title differs from their filename).

## Frontmatter

Use frontmatter for structured fields such as type, status, date, URL, and relationships. Keep free-form thinking in the body.
