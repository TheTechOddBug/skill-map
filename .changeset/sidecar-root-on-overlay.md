---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

R15 closure (Step 9.6 review queue): extend `Node.sidecar` overlay with the full parsed `.sm` root.

**Spec.** `spec/schemas/node.schema.json#/$defs/sidecarOverlay` gains an optional `root` property (`type: ['object', 'null']`, `additionalProperties: true`). It carries the entire parsed YAML payload of the matching `.sm` sidecar — every reserved block (`for`, `annotations`, `settings`, `audit`) plus any opt-in `<plugin-id>:` namespace. NULL when no sidecar accompanies the node, or when the sidecar exists but failed to parse / validate. The existing top-level `annotations` field stays — `root.annotations` duplicates it by design so pre-R15 consumers reading `sidecar.annotations` keep working unchanged. `spec/index.json` regenerated.

**Kernel.** `ISidecarOverlay` (in `src/kernel/types.ts`) gains `root?: Record<string, unknown> | null`. The orchestrator's `resolveAndApplySidecar` site stamps `root: result.parsed.raw` (the full root that `parseSidecar()` already builds for the rule pass — no extra YAML reads). On parse failure the overlay ships `{ present: true, status: null, annotations: null, root: null }`; on absent sidecar `{ present: false }` (root absent).

**Persistence.** Additive sibling column `scan_nodes.sidecar_root_json` (migration `004_sidecar_root_json.sql`) stores the JSON-encoded root alongside the existing `annotations_json`. Option (b) per the R15 brief — no rewrite of the existing `annotations_json` read path. `scan-persistence.ts` writes the column; `scan-load.ts` rehydrates `sidecar.root` from it.

**BFF.** No route changes: `/api/nodes`, `/api/nodes/:pathB64`, and `/api/graph` are pass-through serializers — the new field flows through automatically once the kernel populates it.

**UI wire model.** `ISidecarOverlayApi` (in `ui/src/models/api.ts`) gains `root?: Record<string, unknown> | null`. The internal `ISidecarOverlay` (in `ui/src/models/node.ts`) declared the field forward-compat-ready since the inspector-tiering pass; the `projectNode` mapper spreads `api.sidecar` as-is so the field propagates into `INodeView.sidecar.root` unchanged. The WS `sidecar.bumped` patcher (`CollectionLoaderService.patchSidecarFromBump`) preserves `root` across the bump-driven re-render so the inspector audit / debug / plugin-contributions panels stay populated after a bump.

**Tests.** `src/test/sidecar-reader.test.ts`: fresh-sidecar case asserts `sidecar.root.for.{path,bodyHash}` and `sidecar.root.annotations.{stability,version}`; absent-sidecar case asserts `sidecar.root` is null/absent; persistence round-trip case adds the new `sidecar_root_json` column to the selected projection and asserts the persisted JSON rehydrates correctly. `src/test/server-endpoints.test.ts`: fixture now plants a `.sm` co-located with `architect.md` (pinned to baseline hashes for `status: fresh`); new test case `R15 — surfaces sidecar.root with the full parsed .sm payload` asserts `item.sidecar.root.for.path === target` and `item.sidecar.root.audit.lastBumpedBy === 'cli'` on the `/api/nodes/:pathB64` response.

**Backward compatibility.** Pre-R15 consumers reading `sidecar.annotations` keep working unchanged — the field is preserved, just duplicates `root.annotations`. New consumers reading structured sub-fields (`root.for.*`, `root.audit.*`, plugin namespaces) light up automatically once their BFF / persistence layer ships this minor.
