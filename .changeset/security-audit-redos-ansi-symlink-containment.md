---
"@skill-map/cli": minor
---

Hardened the scan pipeline per a cli-hacker audit: rewrote the HTML-tag stripper and capped the inline-code opener in `strip-code-blocks` to linear time (they could hang `sm scan`/`sm watch`), routed disk-sourced `sm config get`/`list` output through `sanitizeForTerminal` (now also dropping a bare CR), validated the activity `serve.json` port, and made the walker skip symlinks whose target escapes the scan roots by default, with a new `scan.followExternalSymlinks` opt-in gated by `--yes`.

## User-facing

**Scans stay inside your project.** Symlinks pointing outside it are no longer followed (security fix); re-enable via the Follow external symlinks setting (Settings → Project) or `sm config set scan.followExternalSymlinks true --yes`. Config values are sanitized before printing.
