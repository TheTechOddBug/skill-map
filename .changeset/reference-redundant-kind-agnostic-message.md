---
"@skill-map/cli": minor
---

Reword the `core/reference-redundant` finding to be kind-agnostic: it no longer says "Duplicate reference" (the redundancy can span different link kinds, e.g. `invokes` plus `references` to one node), and the remediation moves out of the message into `fix.summary`. The hint now reads as optional, the rule is `info` and keeping multiple forms can be deliberate.

## User-facing

**Redundant-link findings read clearer.** The message no longer assumes the links are "references" (they may be a mix of kinds), and the fix hint now reads as optional: consolidate the links, or keep the overlap on purpose.
