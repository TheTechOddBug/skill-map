---
"@skill-map/cli": patch
---

Audit pass over the bundled `sm tutorial` content: fixed a broken `sm plugins create extractor demo-highlight` command, corrected a contribution that was silently dropped by emit-time slot validation, refreshed the stale `sm plugins doctor` count and UI references, trimmed two redundant chapters from the Extend track, and aligned the chapter-count test with the trim.

## User-facing

**`sm tutorial` cleanup.** The Extend track now runs the right commands end to end (the plugin-authoring walkthrough no longer dead-ends on a broken command or a dropped chip), drops two redundant chapters, and matches what `sm` actually prints today.
