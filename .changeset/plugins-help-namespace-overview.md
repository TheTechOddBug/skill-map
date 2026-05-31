---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

`sm <namespace> --help` (and `sm help <namespace>`) now render a namespace overview, header, USAGE, an optional DESCRIPTION, and a COMMANDS list of the subcommands, for command prefixes that own subcommands but are not themselves runnable (`plugins`, `db`, `config`, `job`, `actions`, `sidecar`, `hooks`, `conformance`, plus nested ones like `plugins slots`). Previously these fell through to Clipanion's terse "Multiple commands match" listing. Leaf verbs and unknown names are unchanged.

## User-facing

`sm plugins --help` (and `db`, `config`, `job`, and the other command groups) now print a tidy overview with a one-line description and a list of their subcommands, matching the look of `sm scan --help`, instead of a terse internal list.
