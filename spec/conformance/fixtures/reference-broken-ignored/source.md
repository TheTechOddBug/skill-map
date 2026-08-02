---
name: source
description: Fixture for the `reference-broken-ignored` conformance case. All three links target files that exist neither in the graph nor on disk, so without configuration each would flag `reference-broken`. The scoped `.skill-map/settings.json` carries one `ignored-references` entry per match kind (literal, regex, glob); every link must therefore stay unflagged and keep the 1.0 baseline.
---

The literal entry covers [the old dump](./missing-one.json).

The regex entry covers [the legacy notes](./legacy/missing-two.md).

The glob entry covers [the draft plan](./drafts/x/missing-three.md).
