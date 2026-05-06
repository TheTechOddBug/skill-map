---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Step 9.6.7 — wire-shape cleanup. Closes two §Step 9.6 review-queue items in one batch (R7 + R9) so the BFF's REST and WS surfaces match the canonical contracts every other route already follows.

**R7 — REST envelope `kind` enum gap (`sidecar.bumped` + `annotations.registered`).** `spec/schemas/api/rest-envelope.schema.json` grew from four `oneOf` variants to six. `'sidecar.bumped'` (action-result variant: `value` + `elapsedMs`, no `filters` / `counts` / `kindRegistry`) covers `POST /api/sidecar/bump`. `'annotations.registered'` (catalog variant: `items` + `counts.total` only, no `filters` / `kindRegistry` / `returned`) covers `GET /api/annotations/registered`. The list variant re-imposes `counts.required: ['total', 'returned']` via per-variant override so its tally shape stays strict. `elapsedMs` is now a top-level optional integer property, present only on action-result envelopes.

**R9 — WS event shape asymmetry.** `src/server/routes/sidecar.ts` now wraps the `sidecar.bumped` payload in the canonical `IWsEventEnvelope` shape `{ type, timestamp, data: { nodePath, version, status } }` (matches every kernel→broadcaster bridge — `scan.*`, `watcher.*`). `timestamp` serialises as an ISO 8601 string via `new Date().toISOString()`, matching the kernel orchestrator's `makeEvent`. The prior flat shape (`{ type, nodePath, version, status }`) forced the UI to accept two shapes in `isWsEvent`; that relaxation is now obsolete (the UI half lands in a follow-up `ui/` PR).

**Tests.** `src/test/server-sidecar-endpoint.test.ts` and `src/test/server-annotations-endpoint.test.ts` each gain an AJV-compile + validate pass against `rest-envelope.schema.json` over the live 200 responses, so any future drift in the route or in the schema fails immediately. The sidecar test's broadcaster-receipt assertion now checks the canonical envelope (timestamp ISO regex, `data.{nodePath,version,status}`, no flat siblings).

**Spec doc.** `spec/cli-contract.md` BFF subsections (`POST /api/sidecar/bump`, `GET /api/annotations/registered`) updated — both `kind` values are now part of the canonical enum, the WS event documents the wrapped envelope. `spec/index.json` regenerated.

No new dependencies; AJV is already on the path (`Ajv2020` from `ajv/dist/2020.js`, used by the unknown-field rule). No CLI-verb surface changes.
