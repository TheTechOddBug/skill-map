---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Adds the `match-list` input-type (twelfth in the settings catalog: literal, regex, and gitignore-style glob entries) and gives `core/reference-broken` an `ignored-references` setting: matched targets skip both the issue and the confidence penalty. Editable from the Settings plugins panel or `sm plugins config core/reference-broken`, stored in the committed project settings, covered by the new `reference-broken-ignored` conformance case.

## User-facing

**Ignore known-dead references.** You can now tell the broken-reference check to skip targets you know are fine: add exact values, patterns, or wildcards under Settings, Plugins, reference-broken. Matching links stop being flagged, and the list is saved with your project.
