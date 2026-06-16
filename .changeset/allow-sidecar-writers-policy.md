---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

New committed project setting `allowSidecarWriters` (default `true`) lets shared projects forbid every extension that writes `.sm` annotation sidecars. Actions declare the capability via `writes: ['sidecar']` on their manifest; when the policy is `false` the scan composer drops those actions (buttons never render) and the sidecar store refuses the write (BFF 403 `sidecar-writers-forbidden`), a hard gate that wins over the per-machine `allowEditSmFiles` consent.

## User-facing

Shared projects can now turn off sidecar writers: a new Project setting stops actions from creating or editing the `.sm` files next to your notes. It is saved in the committed settings.json so it applies to the whole team and cannot be overridden locally.
