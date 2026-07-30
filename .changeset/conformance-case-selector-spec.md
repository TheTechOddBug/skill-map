---
'@skill-map/spec': minor
---

`cli-contract.md` documents `sm conformance run --case <id>`, and implementations MUST offer it: without a single-case selector a conformance case that invokes the suite would run the whole suite including itself, so the report shape declared by `conformance-result.schema.json` could not be exercised end-to-end. An id matching no case in the selected scopes is a `bad-query` error rather than an empty run.
