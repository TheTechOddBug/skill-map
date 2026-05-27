---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Adds a hard cap on the number of files `sm scan` and `sm watch` accept after `.skillmapignore` filtering, plus a persistent UI banner that fires when the graph crosses the recommended limit. Default cap is **256 nodes**. Override per invocation with `--max-nodes <N>` (bidirectional: raises OR lowers the cap).

**Spec (`spec/schemas/project-config.schema.json`)**: new `scan.maxNodes` integer field (default 256, minimum 1). Documented in `spec/cli-contract.md` §Scan / Node cap.

**Spec (`spec/schemas/scan-result.schema.json`)**: ScanResult envelope gains two optional fields, `recommendedNodeLimit` (effective cap that produced this scan) and `overrideMaxNodes` (per-invocation override or `null`). Absent on legacy / synthetic fixtures.

**Kernel walker (`src/kernel/orchestrator/walk.ts`)**: `walkAndExtract` accepts `recommendedNodeLimit` + `overrideMaxNodes` and stops accepting classified nodes once `accum.nodes.length >= effectiveLimit`. Result envelope echoes both values plus a `capReached: boolean` derived signal so callers can phrase a "scan capped" notice without re-deriving it.

**DB schema (`src/migrations/001_initial.sql`)**: `scan_meta` gains two columns, `recommended_node_limit` and `override_max_nodes` (nullable). Edited inline per the project's greenfield rule, no new migration file. The persistence layer (`scan-persistence.ts`, `scan-load.ts`) serialises / deserialises both columns; synthetic envelopes default `recommendedNodeLimit` to 256.

**CLI surface (`src/cli/commands/scan.ts`, `src/cli/commands/watch.ts`, `src/core/runtime/scan-runner.ts`, `src/core/watcher/runtime.ts`)**: new `--max-nodes <N>` flag on `sm scan` and `sm watch` (and the alias `sm scan --watch`). Validates integer ≥ 1, anything else exits 2 with a §3.1b two-line block. When a real scan caps, the CLI prints a yellow notice naming both escape routes the user has: edit `.skillmapignore` (preferred) or re-run with a higher `--max-nodes`. `sm refresh` operates on a single already-classified node, so the cap does not apply there.

**BFF (`src/server/routes/scan.ts`, `src/kernel/adapters/sqlite/scan-load.ts`)**: `GET /api/scan` and `POST /api/scan` propagate the two new fields verbatim from `scan_meta`. The empty-DB fallback returns the design default (256) and a `null` override so the SPA reads the same field shape on cold boot as on populated DBs.

**SPA (`ui/src/app/components/oversized-banner/`)**: new `<sm-oversized-banner>` component mounted in the shell next to `<sm-demo-banner>`. Visibility is purely derived from the loaded `ScanResult`, three render modes drive the body copy:

- **capped** (red), `stats.filesWalked > effectiveLimit`. Files were dropped.
- **overLimit** (yellow), `nodesCount > recommendedNodeLimit` with an override above the recommendation. Graph is bigger than recommended, allowed through.
- **atLimit** (yellow), `nodesCount >= recommendedNodeLimit` without an override above. Soft warning at the recommended cap.

The CTA opens Settings → Project (Ignored patterns section) so the operator can trim `.skillmapignore` without leaving the SPA. No dismiss state, the banner stays until a re-scan brings the graph back under the recommended limit.

**Tests**: new unit tests for the walker cap (`walk-node-cap.spec.ts`, 4 cases covering default cap fire, override above, override below, and project-below-limit) and for the banner (`oversized-banner.spec.ts`, 6 cases covering all three modes + hide + CTA emit). Existing `buildScan` helpers in three integration specs now reset `cmd.maxNodes` so the Clipanion marker object does not leak into manually-instantiated commands.

## User-facing

New `--max-nodes <N>` on `sm scan` / `sm watch` / `sm serve` caps how many files the walker accepts (default 256, bidirectional). Past the limit, a persistent banner links to **Settings → Project** to trim `.skillmapignore`.
