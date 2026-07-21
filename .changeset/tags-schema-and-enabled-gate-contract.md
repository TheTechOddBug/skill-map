---
"@skill-map/spec": minor
---

New canonical tagger-report schema `tags/markdown.schema.json` (1-8 lowercase kebab-case topical tags) plus the `job-lifecycle.md` §Tags write-through contract (record-side union merge into sidecar `annotations.tags`, standing `.sm` consent only, storage-rule delegated-curation carve-out), and enabled-gate wording: `POST /api/actions/:id` answers 404 for a disabled Action, `sm bump` refuses while `core/node-bump` is disabled, and boot/shutdown hook dispatch honours the enabled toggle.
