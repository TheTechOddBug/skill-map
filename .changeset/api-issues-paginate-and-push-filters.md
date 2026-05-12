---
"@skill-map/cli": patch
---

Audit fix L6 on the BFF: `/api/issues` now paginates (`offset`, `limit`, default 100, max 1000, mirroring `/api/nodes`) and pushes its three filters (`severity`, `analyzerId`, `node`) into the storage layer instead of loading every persisted issue into memory and filtering in JS.

Internal changes for plugin authors / contributors:

- New port method `port.issues.list({ severities?, analyzerIds?, nodePath?, offset, limit }): Promise<{ items: Issue[]; total: number }>` on `StoragePort` (kernel). Filters translate to parameterised SQL: `severity IN (?, ?, ...)`, `analyzerId = ? OR analyzerId LIKE '%/' || ?` per token (preserves the qualified + suffix-match semantics of `matchesAnalyzerFilter`), and a correlated `EXISTS (json_each(node_ids_json) WHERE value = ?)` for `nodePath`. Order is `id` ASC so pagination stays deterministic.
- The `/api/issues` response envelope now carries `counts.page = { offset, limit }` like `/api/nodes`; `counts.total` is the full filter match count (NOT the page slice). The route still echoes the active filters back via `filters: { severity, analyzerId, node }`.
- `port.issues.listAll()` is unchanged and still exposed for callers that genuinely need every row (currently none on the read path; kept for back-compat).
