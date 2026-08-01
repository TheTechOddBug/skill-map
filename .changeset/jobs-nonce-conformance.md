---
'@skill-map/spec': patch
---

The nonce-omission rule of `job-lifecycle.md` §Nonce exposure is a security invariant with no conformance case: an implementation could leak the record credential on `sm jobs list --json` and pass the whole suite. The new `jobs-list-omits-nonce` case validates every listed row against `job.schema.json#/$defs/PublicJob`, which asserts the credential's absence, and `job-document-schema` now targets `#/$defs/CredentialedJob` so the submit direction cannot silently drop it either.
