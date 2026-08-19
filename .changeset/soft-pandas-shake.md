---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Live activity gains a mapper digest: the server accumulates, per provider, how many events arrived and how many resolved to nothing, plus the shape of the ones that did not (hook type, tool name, payload key names, never a value). `sm activity status --verify` reports it on each `--json` entry and warns when a provider received events and mapped none, the case the wiring self-test cannot catch because its probe is answered before the mapper runs.

## User-facing

Live map dark while your agent is clearly working? `sm activity status --verify` now tells you whether events are arriving at all, and if they are, what the provider adapter failed to understand about them.
