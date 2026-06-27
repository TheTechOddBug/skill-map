---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Add an optional `presentation.invocationSigil` to the Provider manifest: the single glyph a lens's runtime uses to invoke a skill (`/` for Claude and Antigravity, `$` for Codex). The BFF projects it into `providerRegistry`, and the link-kind palette now paints the `invokes` edge-kind glyph (and its tooltip example) for the active lens instead of a hardcoded `/`. Lenses with no `/`/`$` invocation channel (`agent-skills`, `markdown`) omit it.

## User-facing

Under the Codex lens, the Invokes connector filter on the graph now shows a `$` glyph, matching how Codex invokes skills, instead of a `/`.
