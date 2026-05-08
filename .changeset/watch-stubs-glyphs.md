---
"@skill-map/cli": patch
---

Polish `sm watch` per-batch summary line and stub verbs to match the visual rhythm of the rest of the CLI.

`sm watch`'s post-batch `scanned <N> nodes / <M> links / <K> issues in <ms>` line is now `✓ <N> nodes · <M> links · <K> issues   in <ms>`, mirroring the `sm scan` outcome shape (green ✓ glyph, mid-dot separators, dim duration tag, plural-correct nouns).

Every stub verb (`findings`, `actions list`, `actions show`, `job submit`, `doctor`, etc) now opens its `not yet implemented (planned)` advisory with a yellow `⋯` glyph so the user gets a visual handle on "this is coming, not broken."
