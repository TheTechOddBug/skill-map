---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

CLI human output now sanitizes the stored and model-authored strings it interpolates: the jobs family renders through a shared terminal-safe row view, and `sm record`, `sm sidecar`, `sm bump` and `sm db migrate` sanitize the tags, paths, reasons and ledger labels they echo. `sm jobs preview` sanitizes its rendered content while `sm graph` formatter output stays byte-exact, a split the spec now states on the `sm jobs preview` row. `sm plugins upgrade` adopts the standard glyph blocks.

## User-facing

**Terminal output is safer to read.** Text that `sm` quotes back from your project database or from an agent's report can no longer smuggle escape codes into your terminal, and `sm plugins upgrade` now prints the same check marks and error blocks as the rest of the CLI.
