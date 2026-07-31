---
'@skill-map/cli': minor
---

`sm help --format json` now describes the CLI it actually is. Clipanion's `definitions()` silently drops any option that declares no `description`, folding it into the usage string, so 78 real flags were invisible to the surface the contract calls normative (`jobs submit` published none of its seven). Exit codes were missing on all 79 verbs and `globalFlags` listed one of six. Human `--help` and `--format md` were lying identically and are fixed with it.
