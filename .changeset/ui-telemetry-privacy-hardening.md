---
"@skill-map/cli": patch
---

Security-audit hardening of the UI telemetry surface: the UI scrubber regains the CLI's project-root collapse (the /api/health cwd threads into the Sentry beforeSend and the crash-dialog preview), short deterministic analyzer ids collapse through a closed built-in set before riding usage events, the crash dialog previews an honest truncated JSON summary for non-Error rejections, plugin secret inputs stop password-manager save offers, and the match-list editor dedupes seeded duplicates.

## User-facing

**More private crash reports.** The crash-report dialog now redacts your project folder's name from anything it sends, shows a real summary even for non-standard errors, and plugin secret fields in Settings no longer trigger your password manager's save prompt.
