---
name: source
description: Fixture for the `reference-broken-existence` conformance case. The first link targets a sibling `.json` that exists on disk but is never indexed as a node; it must NOT flag broken. The second link targets a file that does not exist anywhere; it must flag `reference-broken` and fold to confidence 0.25.
---

The report shape is defined in [the schema](./report.schema.json).

Historical results used to live in [the old dump](./missing.json).
