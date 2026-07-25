---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

The kernel safety lane is now replaced per NODE instead of per reporting extension. A safety row states a fact about the node's content, and every probabilistic report carries a complete safety verdict on the body it read, so scoping the replace to the extension kept one copy of the same fact per extension that ever ran: six finders over one trapped file recorded the same injection six times. The finder lane keeps its per-extension supersede.

## User-facing

A file with a prompt-injection trap no longer collects one duplicate warning per AI check you run: the safety flag is recorded once per file.
