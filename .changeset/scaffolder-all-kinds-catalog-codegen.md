---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

`sm plugins create <kind> <plugin-id>` now takes the extension kind as a required first positional and scaffolds a loader-clean stub for each of the six kinds (provider, extractor, analyzer, action, formatter, hook). The slot / input-type catalog gains a single source of truth: the spec enums become `oneOf` const+description, and the kernel + CLI mirrors are generated from it by `scripts/generate-view-catalog.js`, guarded by `view-catalog:check` in `validate:compile`.

## User-facing

`sm plugins create` now takes the extension kind as a required first argument: `sm plugins create <kind> <plugin-id>` (kinds: provider, extractor, analyzer, action, formatter, hook). Previously it only scaffolded extractors.
