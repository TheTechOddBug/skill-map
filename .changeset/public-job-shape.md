---
'@skill-map/spec': minor
---

`job.schema.json` required the `nonce` while four normative surfaces (`sm jobs list --json`, `sm jobs show --json`, `GET /api/jobs`, the MCP job tools) are required to omit it, so the shape they all call "the public-job shape" was unsatisfiable. It is now a real definition, `#/$defs/PublicJob`, which asserts the credential's ABSENCE rather than permitting it, alongside `#/$defs/CredentialedJob` for the surfaces that carry it.
