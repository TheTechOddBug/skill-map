---
name: run-tests
description: Run the unit suite and smoke checks before any handoff to review.
---

# Run tests

Use this before handing a change to review. Run the unit suite and the
smoke checks, following [the testing guide](../../../docs/testing.md).

Invoked by @builder before handoff; @reviewer expects it to be green
before approving.
