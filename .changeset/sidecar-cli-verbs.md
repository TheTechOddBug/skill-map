---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Step 9.6.4 — sidecar CLI verbs. Six new verbs split between `sm bump` (top-level, ROADMAP-named per Decision #125) and the `sm sidecar` sub-namespace (administrative helpers; the existing `sm refresh` from Step A.8 — enrichment-layer — stays untouched). Plus `sm hooks install pre-commit-bump` for the opt-in commit-time auto-bump.

**`sm bump <node-path> [--force]`** — single-node mode. Wraps the built-in deterministic `core/bump` Action: refusal on a fresh node (`{ ok: false, reason: 'fresh' }`, exit 2) unless `--force`; with `--force` on a fresh node the verb is a silent no-op (exit 0, no stdout). On a stale or first-time node increments `annotations.version`, refreshes `for.{bodyHash, frontmatterHash}`, stamps `audit.lastBumpedAt` + `lastBumpedBy: 'cli'` (and `audit.createdAt` + `createdBy: 'cli'` on first creation). `--json` emits the report shape declared by `bump-report.schema.json`.

**`sm bump --pending [--staged] [--force]`** — batch mode. Walks every node whose sidecar overlay reports drift in `node.path` ASC order. `--json` envelope: `{ bumped, refused, skipped, errors[], elapsedMs }`. `--staged` runs `git add <sidecar-path>` after each successful bump (failures degrade to a stderr warning, batch keeps running); preflight enforces the spec error matrix — not in a git repo (no `.git/` parent) → exit 5; `git` binary missing on PATH → exit 2.

**`sm sidecar refresh <node-path>`** — hash-only update. Refreshes `for.{bodyHash, frontmatterHash}` to match the live node WITHOUT bumping `annotations.version` and WITHOUT touching the audit block. Useful when a body change is editorial and the user doesn't want to spend a version increment. Distinct from the top-level `sm refresh` (enrichment-layer verb at Step A.8) — different storage, different concept; the sub-namespace prefix prevents the collision.

**`sm sidecar prune [--dry-run]`** — delete orphan `.sm` files (sidecars whose accompanying `<basename>.md` is missing on disk). Different domain from `sm orphans` (which operates on the node graph via the rename heuristic). `--json` envelope: `{ deleted, wouldDelete, errors, items[], elapsedMs }`.

**`sm sidecar annotate <node-path> [--force]`** — pure scaffolding. Writes a minimal `.sm` next to the `.md` with the `for:` block populated and `annotations: {}` empty, ready for editing. The `--from-frontmatter` legacy-import helper is deferred (no released consumer demands it).

**`sm hooks install pre-commit-bump [--dry-run]`** — install (or chain into) a git pre-commit hook running `sm bump --pending --staged` so any staged drift in `.sm` sidecars auto-bumps before the commit lands. Idempotent: re-running detects the embedded skill-map marker and no-ops. When the repo already has a `pre-commit` hook, the verb appends the skill-map block rather than replacing it. `--dry-run` prints the planned content with `--- target: <path> ---` markers and writes nothing. Exit 5 if no `.git/` parent exists; exit 2 on write failures or unknown hook flavours.

**Spec.** `cli-contract.md` §Actions gains a "Sidecar bump (Step 9.6.4)" subsection documenting all six verbs verbatim, the `--staged` git-error matrix, and the explicit `.sm` round-trip contract: **"`.sm` files are managed artifacts; comments and key order are not preserved on round-trip. Author commentary belongs in the markdown body or in a separate documentation file, not inside `.sm`."** R6 stays open in the Step 9.6 review queue — the UI work in 9.6.5 may force a revisit before closing the whole step.

**Tests.** New CLI test suites at `src/test/{bump-cli,sidecar-cli,hooks-cli}.test.ts` cover the refusal / first-time-creation / batch (with real git) / staged / dry-run / chained-hook / idempotent-reinstall / scaffold paths. File-based SQLite under `.tmp/<scope>/`, never `:memory:`. CLI reference regenerated.
