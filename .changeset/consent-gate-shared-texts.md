---
"@skill-map/cli": patch
---

Extract the `.sm` sidecar consent gate strings shared by `sm bump`,
`sm sidecar refresh`, and `sm sidecar annotate` into a single
`src/cli/i18n/consent.texts.ts` module (`CONSENT_TEXTS`). The directed
error prefixes are now driven by a `{{verb}}` placeholder filled by
each caller (`'sm bump'` or `'sm sidecar'`), so the user-visible output
is unchanged and the catalogs (`bump.texts.ts`, `sidecar.texts.ts`)
stop carrying duplicated copies of the same paragraph. Internal DRY
cleanup, no behaviour or surface change.
