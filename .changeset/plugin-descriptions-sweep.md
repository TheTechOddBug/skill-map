---
"@skill-map/cli": patch
---

Rewrite the `description` field on every built-in plugin (extractors, analyzers, actions, formatters, hooks) in user-facing language. Removes internal jargon — slot ids, frontmatter key names, kernel-side concepts — in favour of explanations that match what the operator actually sees in Settings → Plugins and on the cards / graph.

The `annotations` extractor's description now says outright what it does ("turns the supersedes / requires / related / conflictsWith / supersededBy entries into the arrows between nodes"), which was the original spark for the sweep: every operator who opened Settings → Plugins asked what `annotations` was for, because the previous description ("reads structured references from the sidecar `.sm` `annotations:` block") only made sense if you already knew the answer.

No behaviour change.

## User-facing

Built-in plugin descriptions in Settings → Plugins are rewritten in plain language: less internal jargon, clearer explanations of what each one does. The annotations extractor now says outright that it draws the arrows between nodes.
