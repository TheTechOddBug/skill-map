---
name: unknown-field-command
description: "Claude command whose frontmatter carries a key that is not in the schema (`customField`). Demonstrates the `additionalProperties: true` carry-through, AJV accepts the file, but the unknown-field analyzer surfaces a warning chip so curators can decide whether to add the key to the schema or drop it."
tags:
  - fixture
  - unknown-field
  - claude
  - command
when_to_use: When the unknown-field analyzer needs a node to flag.
argument-hint: "[name]"
arguments:
  - name
allowed-tools:
  - Read
model: sonnet
customField: this-is-not-in-the-schema
anotherUnknown:
  nested: value
---

# /unknown-field-command

The `customField` and `anotherUnknown` keys above are NOT in `skill-base.schema.json`. AJV accepts them because the schema has `additionalProperties: true`, but the `core/unknown-field` analyzer emits a warning so the curator notices. Pairs with /full-command-claude (same shape, no extras).
