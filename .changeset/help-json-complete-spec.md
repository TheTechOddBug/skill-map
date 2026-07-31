---
'@skill-map/spec': minor
---

`cli-contract.md` §Introspection documents the real shape of the `sm help --format json` envelope: the example carried a `subcommands` field no version ever emitted, and the field set is now stated normatively (flat `verbs`, complete `flags` with the hidden-option exception, exhaustive ascending `exitCodes`). The `sm doctor` row also gains exit 5, which it returns when the project database is absent.
