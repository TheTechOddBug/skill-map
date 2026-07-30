---
'@skill-map/cli': minor
---

The conformance runner implements the four new case-format fields: `schemaPointer` resolves a subschema through AJV's registered `$id` so a `$def`'s relative `$ref`s still resolve, `each` validates array elements and rejects an empty array rather than passing vacuously, `expectExit` lets a staging step declare a non-zero exit, and `capture` binds JSONPath values from a step's stdout into `{{name}}` placeholders in later arguments and flags.
