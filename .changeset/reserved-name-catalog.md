---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Reserved-name catalog per Provider. Each Provider runtime owns a set of invocation names its built-ins consume (Claude reserves `/help`, `/clear`, `/init`, `/agents`, `/model`, … under `command`, and `general-purpose`, `output-style-setup`, `statusline-setup` under `agent`). User files declaring one of these names are silently shadowed at runtime, the kernel now surfaces the collision.

Two changes ship together:

1. **New `IProvider.reservedNames?: Record<kind, string[]>`**. Each Provider declares the names its runtime reserves per kind. Claude ships the documented built-in catalog (command + agent today); Gemini, OpenAI, and agent-skills declare none yet (no `reservedNames` field). User plugins MAY declare their own with the same shape.

2. **Two consumers share the catalog through a single per-scan `Set<nodePath>`**:
   - **New `core/reserved-name` analyzer** emits one `warn` issue per user node whose normalised identifiers intersect its Provider's `reservedNames[kind]`. The issue carries `data: { provider, kind }` and a message pointing at the file with a rename hint.
   - **The post-walk confidence-lift transform downgrades** any link that resolves to a reserved target (path or name match) to `RESERVED_TARGET_CONFIDENCE = 0.1` instead of bumping to `1.0`. When the same trigger has both a reserved and a non-reserved candidate accepted by the strict-kind filter, the non-reserved one wins and the bump goes to `1.0` normally.

The detection runs once per scan in the orchestrator (`buildReservedNodePaths`) so the analyzer and the transform share identical truth, the two surfaces cannot drift.

New spec section: `§Provider · reservedNames` in `spec/architecture.md`.

## User-facing

**Files whose name shadows a built-in are flagged.** A file like `.claude/commands/help.md` now emits a `warn` (Claude's runtime ignores it for its own `/help`), and incoming `/help` edges resolve to it at confidence `0.1` instead of `1.0`.
