---
"@skill-map/cli": patch
---

The reference-redundant finding message is shorter and more direct: "Duplicate reference to <target> (<n> occurrences): <list>." It drops the source-node name (the finding already hangs off that node) and the trailing "consider consolidating..." advice.

## User-facing

The redundant-reference finding now reads with shorter, more direct wording so the duplicated target and where it appears are easier to scan at a glance.
