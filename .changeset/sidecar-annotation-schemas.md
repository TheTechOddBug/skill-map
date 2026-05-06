---
"@skill-map/spec": minor
---

Step 9.6.1 — sidecar + annotation schemas. Closes the deferred portion of Decision #124 (where skill-map's own annotation fields live) by introducing two new schemas that lock the shape of the co-located YAML sidecars (`<basename>.sm`) the kernel will start reading in Step 9.6.2.

`spec/schemas/sidecar.schema.json` declares the root shape: required `for` block (`path` + `bodyHash` + `frontmatterHash`, optional `resolvedAs` for ambiguous-classification overrides) plus reserved sibling blocks `annotations`, `settings`, `audit`. Schema is `additionalProperties: true` at every level so plugins write to their own `<plugin-id>:` namespace without coordination; the built-in `unknown-field` rule (Tier 1, always-on) warns on unrecognized root keys to catch typos.

`spec/schemas/annotations.schema.json` lists 25 conventional annotation fields with full descriptions for editor autocomplete and IDE doc-on-hover. The load-bearing core covers versioning + supersession (`version`, `stability`, `supersedes`, `supersededBy`, `requires`, `conflictsWith`, `provides`, `related`); provenance and lifecycle dates (`type`, `author`, `authors`, `license`, `source`, `sourceVersion`, `created`, `updated`, `released`); taxonomy (`tags`, `category`, `keywords`); display (`icon`, `color`, `priority`, `hidden`); and docs (`docsUrl`). Every field is optional; an empty `annotations: {}` is valid. `version` is a single integer monotonic counter, orthogonal to `stability` — there is no major bump concept; the convention for breaking changes is to create a new node and supersede the old.

Conformance fixture `spec/conformance/fixtures/sidecar-example/` ships a structural sample (one `.md` + matching `.sm`); coverage matrix gains rows 26 and 27 marked 🟠 deferred — direct end-to-end conformance cases land in Step 9.6.6 alongside plugin contributions.

This changeset is greenfield-permitted breaking surface (no released consumers depend on the prior shape) but ships as a minor per the pre-1.0 versioning policy. No code changes — Step 9.6.2 (kernel reader + drift detection) is the next sub-step. The previous "annotation home — pending decision" section in ROADMAP is rewritten to describe the sidecar shape; Decision #125 carries the formal record.
