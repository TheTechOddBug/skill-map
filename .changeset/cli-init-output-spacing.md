---
"@skill-map/cli": patch
---

Tidy two run-together lines in `sm init` output: insert a blank line before `Running first scan...` so the scaffolding summary and the first scan are visually separated, and terminate the `Auto-detected activeProvider = ...` line with a newline so it no longer abuts the `First scan: ...` summary.
