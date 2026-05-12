---
"@skill-map/spec": patch
---

Strip em dashes (`—`) from spec prose and schema descriptions.

Stylistic sweep across `spec/*.md` (architecture, cli-contract, db-schema, job-events, job-lifecycle, plugin-author-guide, plugin-kv-api, prompt-preamble, versioning, view-slots, input-types, interfaces/security-scanner, conformance/README.md, conformance/coverage.md, README.md) and `spec/schemas/**/*.json` description fields. Each em dash is replaced with a comma, colon, semicolon, or parenthetical pair chosen to read naturally in context.

`spec/index.json` regenerated so the integrity hashes line up with the new content. No normative changes: schema keys, enum values, type definitions, required-field sets are all unchanged. Conformance fixtures and `CHANGELOG.md` historical snapshots are deliberately untouched.
