---
'@skill-map/cli': minor
---

Extensions get a diagnostic channel: the kernel binds `ctx.log` onto every Extractor, Analyzer, Action and Hook context. It routes to the kernel logger (stderr, so a chatty extension can never corrupt a `--json` payload the way `console.log` does), strips ANSI escapes and control bytes from extension-authored text, and prefixes every line with the qualified extension id so no extension can emit a line that reads as kernel output.
