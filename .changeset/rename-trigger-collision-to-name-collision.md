---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Rename `core/trigger-collision` to `core/name-collision` and key it on the resolution identifier instead of the slashed trigger. It fires (`error`) when two or more name-resolvable nodes (kinds whose `identifiers` include `frontmatter.name`) declare the same normalised `name`. The subject is the bare name (the old `/` sigil was wrong for agents), and case / separator invocation variants no longer false-positive.

## User-facing

**`trigger-collision` is now `name-collision`** and fires only when two files declare the same resolvable name (a command and an agent both named `deploy`, say), across any name-resolvable kind. Plain notes, addressed by path, never collide.
