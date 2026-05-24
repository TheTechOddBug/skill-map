---
'@skill-map/cli': patch
---

Two bugs surfaced by the `sm-tutorial` external-tester walkthrough.

**Finding 1, denormalised `linksInCount` undercounts trigger-style links** (`src/kernel/orchestrator/extractors.ts:620`)

The `scan_nodes.linksInCount` column drives every read surface that does NOT walk `scan_links` directly: the inspector's "Linked nodes → INCOMING" badge, the `Links X out · Y in` counter in the inspector header, and the `IN` column in `sm list`. The recomputation looped over `links` and incremented `byPath.get(link.target)`, which works for path-style emits (markdown references where `target === resolvedTarget`) but skips every trigger-style emit (Claude `@<handle>` mentions, slash `/<command>` invokes), where `link.target` holds the authored trigger and `link.resolvedTarget` carries the resolved node path.

Effect: `demo-agent`, `demo-command`, and `demo-skill` showed `IN 0` and "No incoming links to this node" in both the SPA inspector and `sm list`, even though the graph drew the arrow from `notes/todo.md` correctly (the card chip walks `scan_links` directly, so it was unaffected) and `demo-guideline` (reached by a markdown reference) showed `IN 1` as expected.

Fix: read `link.resolvedTarget ?? link.target` when keying the increment, so trigger-style links count toward the resolved node's row. New `recompute-link-counts.spec.ts` covers path-style, mention, slash, the unresolved-trigger fallback, and the idempotent re-run invariant.

**Finding 2, `sm plugins doctor` raises a false-positive applicableKinds warning** (`src/cli/commands/plugins/doctor.ts:371`)

`core/tools-count` declares `precondition.kind: ['claude/agent']` (qualified form). `collectKnownKinds` populated its set with the bare keys from `IProvider.kinds` (`agent`, `command`, `skill`) and never indexed the qualified form, so the lookup `knownKinds.has('claude/agent')` missed and `sm plugins doctor` reported `0 issues · 1 warning` on a clean install: `applicableKinds include 'claude/agent' but no installed Provider declares that kind`. The kernel runtime (`matchesKindPrecondition`) strips the qualifier before comparing, so the false positive was purely on the doctor's validator side.

Fix: index BOTH forms (bare and qualified `<pluginId>/<kindKey>`) so a precondition declared in either dialect resolves cleanly. The runtime matcher stays unchanged. New integration case in `cli-json-envelopes.spec.ts` asserts a fresh `sm plugins doctor --json` carries no `claude/agent` warnings.

**Drive-by: fixture cleanup** (`fixtures/local-scope/`)

`.gemini/` directory removed (the `gemini` provider was retired upstream when Google migrated the CLI to `antigravity`; the bundle today carries metadata only, no `.gemini/` territory). Two prose references to `gemini` rephrased on the surviving fixtures (`stable-markdown.md`, `full-agent-claude.md`, `full-skill-agents/SKILL.md`) so reviewers reading the demo project do not encounter a dead vendor.

## User-facing

`sm list` IN counts and the inspector's "Linked nodes → INCOMING" now include every `@mention` and `/invoke`, not just markdown links. `sm plugins doctor` no longer raises a spurious `claude/agent` warning on a clean install.
