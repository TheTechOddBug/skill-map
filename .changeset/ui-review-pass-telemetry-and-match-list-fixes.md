---
"@skill-map/cli": patch
---

UI review-pass fixes: string values on the generic `ui.feature` channel now collapse inside the event builder (a third-party plugin id can no longer leak through a call site), consent-gated toggles (capture, follow-symlinks) emit usage events only once the confirm dialog or write resolves, re-clicking the active Changelog / About tab no longer re-emits, and the match-list editor gains inline over-256-char and duplicate-entry errors plus collision-free DOM ids for same-label settings.

## User-facing

**Stricter ignore-list editing.** When adding entries to a plugin's match list in Settings (like reference-broken's ignored references), a value over 256 characters or an entry already in the list is now flagged right at Add time instead of failing the whole Apply later.
