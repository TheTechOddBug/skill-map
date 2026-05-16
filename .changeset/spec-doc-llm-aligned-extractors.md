---
'@skill-map/spec': minor
---

Document the LLM-aligned semantics that landed in `core/at-directive`
and `core/slash`. `spec/plugin-author-guide.md` § Extractors now
describes the dispatch rules the built-ins follow: bare and
namespaced `@<handle>` tokens emit `mentions`, file-flavoured
`@<...>.ext` / `@./<...>` / `@/<...>` tokens emit `references`,
`/<token>` is dropped when followed by another identifier or slash
(path / URL territory), and both extractors strip fenced + inline
code regions before matching. Plus a normative note in
`spec/db-schema.md` § Rename detection: the `orphan` info issue is
suppressed when the disappeared `deletedPath` is currently filtered
by the active ignore-source (still on disk, just silenced).
