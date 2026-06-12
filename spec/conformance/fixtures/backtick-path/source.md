---
name: source
description: Fixture for the `backtick-path-extraction` conformance case. The backtick-wrapped relative path below must reach the graph as ONE Link row via the code-region path extractor, deduped against the fenced repeat, with the URL bait rejected.
---

Before doing anything else, read `docs/target.md` for the full rules.

Validation example (the duplicate path below must dedupe into the same link):

```bash
report-validator --rules docs/target.md check output.json
```

External docs live at `https://example.com/docs/target.md` and must never become a link.
