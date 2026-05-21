---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

`sm plugins enable` and `sm plugins disable` now accept multiple plugin ids in one invocation, e.g. `sm plugins disable gemini openai agent-skills`. The single-id form and `--all` keep working unchanged.

Batches are all-or-nothing: a single unknown or granularity-mismatched id aborts the call before any `config_plugins` write, so the user never lands in a partial state. Repeated ids in the same call are deduped. Locked plugins inside a batch are silently skipped (matching `--all` semantics), while in single-id mode a locked target still surfaces a directed exit-5 error.

Internals: only `#validateArgs` and `#pickTargets` in `src/cli/commands/plugins/toggle.ts` changed; `#persistTargets` and `#renderSuccess` already iterated over `string[]` and reused the existing multi-row i18n. `spec/cli-contract.md` documents the new `<id>...` shape on both verbs.

## User-facing

`sm plugins enable` / `sm plugins disable` now take multiple plugins at once, e.g. `sm plugins disable gemini openai agent-skills`. Unknown id rejects the whole batch (no partial writes); repeated ids are deduped; locked plugins in a batch are skipped silently.
