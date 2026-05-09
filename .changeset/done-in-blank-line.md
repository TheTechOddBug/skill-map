---
"@skill-map/cli": patch
---

Universal blank line before the `done in <…>` elapsed-time footer. The line was rendering tight against each verb's body output (`<final body line>\ndone in 5ms`) which read as visually crowded. Now every verb gets a blank-line separator. Tutorial's verb-specific trailing `\n` (added a few commits ago for the same purpose) reverts since the universal one covers it.

Concretely: `UTIL_TEXTS.doneIn` template flips from `'done in {{elapsed}}\n'` to `'\ndone in {{elapsed}}\n'`. No flag surface change; `--quiet` still suppresses the line entirely.
