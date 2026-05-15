---
'@skill-map/cli': patch
---

Group and sort the extension list rendered by `sm plugins show <bundle>`
by the canonical pipeline order (provider, extractor, analyzer, action,
formatter, hook), then alphabetically by short id within each kind.
Previously the list followed the declaration order of `built-ins.ts`,
which mixed analyzers after formatters and gave readers no quick way to
scan a bundle by kind. Mirrors the kind order published on the marketing
site so the CLI and the web tell the same story. Affects human output of
the bare-bundle form (`sm plugins show core`, `sm plugins show <user-plugin>`);
`--json` keeps emitting the source manifest order so existing JSON
consumers see no shape change, and the single-extension detail form
(`sm plugins show core/superseded`) is untouched.

## User-facing

`sm plugins show core` (and the same verb against any user plugin) now
groups extensions by kind in pipeline order, **provider, extractor,
analyzer, action, formatter, hook**, with each group sorted by id. The
JSON output is unchanged.
