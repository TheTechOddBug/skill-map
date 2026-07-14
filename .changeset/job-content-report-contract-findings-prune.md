---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Rendered job content becomes self-contained (Decision #138): the submit render inlines the report contract verbatim after the extension template (the extension's `report.schema.json` plus the canonical envelope chain), hashed into `promptTemplateHash`, so a draining agent learns the exact output shape, enums included, without disk access. Alongside, `sm findings prune` deletes stale findings rows on demand (destructive-verb pattern with `--dry-run` / `--yes`).

## User-facing

Queued jobs now carry their exact answer format inside the prompt, so agents draining your queue stop guessing (and failing) on report fields. New `sm findings prune` clears out findings that refer to file versions you have since edited.
