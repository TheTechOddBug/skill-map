---
'@skill-map/cli': patch
---

Ship `.skillmapignore` at POSIX mode `0o644` so anyone with checkout
access can read it on multi-user hosts and shared-mount workflows
without a chmod dance. The file is meant to be committed alongside
`.gitignore`, the project-private default of `0o600` (kept for
`settings.json` and sidecars that may carry private paths) was
misapplied here. Implementation: `writeFileAtomicExclusive` gains a
third `mode: number` parameter with the previous `0o600` as default;
the init command passes `0o644` for `.skillmapignore` only. On
Windows the parameter is a no-op (Node maps POSIX modes to the
readonly attribute only).

## User-facing

`.skillmapignore` is now created with mode `0o644` (was `0o600`), so other users on multi-user hosts can read it without `chmod`. Existing files keep their current mode; re-run `sm init --force` if you want the new default.
