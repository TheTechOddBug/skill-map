---
'@skill-map/web': major
---

The public site reaches 1.0.0 alongside the spec and the CLI, and serves the spec at `/spec/v1/`: the schema browse index, the landing links and every schema URL move from the pre-stable `/spec/v0/` path, which is no longer emitted; requests to the old `/spec/v0/` URLs redirect permanently to their `/spec/v1/` equivalents.
