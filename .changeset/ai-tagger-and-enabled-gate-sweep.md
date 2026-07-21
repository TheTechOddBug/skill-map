---
"@skill-map/cli": minor
---

New `core/ai-tagger-action` built-in (taxonomy sibling of the summarizer): `sm record` merges its report tags into the sidecar `annotations.tags` under standing `.sm` consent, and the inspector tag row gains a sparkles auto-tag button. Enabled-gate sweep: tag surfaces follow a self-projected `core/node-set-tags` contribution, `POST /api/actions/:id` re-checks the live enabled state (disabled = 404), `sm bump` refuses while `core/node-bump` is off, and boot/shutdown hooks skip disabled ones.

## User-facing

**Auto-tag.** A sparkles button on the tag row asks the AI to suggest topical tags for the file; they merge into your tags once you grant the sidecar write consent. Disabled extensions now stay off everywhere: their buttons, chips, verbs and hooks disappear or refuse to run.
