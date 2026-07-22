---
"@skill-map/cli": minor
---

The `ai-verbosity` and `ai-vagueness` optimization pairs (finder analyzer plus fixer action each) graduated from experimental to stable and now ship enabled by default, after each proved its prompts end to end in the live playground; the three remaining optimization pairs (`ai-structure`, `ai-trigger`, `ai-scope`) stay experimental and disabled.

## User-facing

**Verbosity and vagueness reviews now come enabled out of the box.** Their finders show up on every file's AI actions row and their fixes can be applied per finding; turn either off in Settings if you don't want them.
