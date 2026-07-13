---
"@skill-map/spec": minor
---

Model A provenance enrichment lands in the contract: Actions gain the declared `io: ['network']` purity carve-out (injected `ctx.fetch`, gated by the new committed `allowNetworkActions` policy, default false), `sm refresh` executes enrichment Actions in-process with an `enrichments/` write-through convention mirroring the summaries one, and `enrichments/github.schema.json` pins the verification report shape (`verified`, `method: raw-sha | api-ref`, `resolvedSha`, body-hash comparison fields).
