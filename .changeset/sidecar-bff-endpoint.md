---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Step 9.6.5 (BFF half) — `POST /api/sidecar/bump` over the Hono BFF. The endpoint mirrors the `sm bump <node.path> [--force]` CLI verb 1:1: same built-in `core/bump` Action, same `FilesystemSidecarStore`, same fresh-vs-stale refusal semantics. The only differences from the CLI verb are the invoker label (`'ui'` vs `'cli'`) and the wire shape. Batch (`--pending`) stays CLI-only at 9.6.5 — surfacing it over REST needs a job-style progress channel and lands later.

**Wire contract.** Request body: `{ "nodePath": <string, required>, "force"?: <boolean>, "reason"?: <string> }`. Successful (200) envelope: `{ "schemaVersion": "1", "kind": "sidecar.bumped", "value": { "nodePath", "version", "status": "fresh" }, "elapsedMs": <int> }`. Refusal (409) on fresh + no force: `{ "ok": false, "error": { "code": "sidecar-fresh", "message": <string>, "details": null } }`. 404 on unknown `nodePath`; 400 on malformed body. Force-on-fresh is a 200 silent no-op (per the Action spec) carrying the existing version, with no on-disk change. The BFF's global `app.onError` gains a new `'sidecar-fresh'` `TErrorCode` mapped from HTTP 409.

**WS event — `sidecar.bumped`.** After every successful 200 bump that materialises a write, the BFF broadcasts `{ "type": "sidecar.bumped", "nodePath", "version", "status": "fresh" }` over `/ws` so all connected clients refresh in lockstep. Force-on-fresh no-op responses do **not** broadcast (decision: no-op = no event — nothing changed on disk, sending the event would tell every UI to refresh state that has not moved).

**Spec contract.** Documented in `spec/cli-contract.md` §Sidecar bump → BFF endpoint subsection. Two new review-queue items surfaced in `ROADMAP.md` §Step 9.6: R7 (REST envelope `kind: 'sidecar.bumped'` is not in the canonical `rest-envelope.schema.json#/properties/kind/enum` — close before flipping 9.6.5 ✅) and R8 (force-on-fresh broadcast policy — keep no-op = no event, or always broadcast on a successful 200).

Tests at `src/test/server-sidecar-endpoint.test.ts`: 200 stale path with broadcaster receipt assertion; 409 refusal with on-disk untouched + no broadcast; 200 force-on-fresh no-op with no broadcast; 404 unknown path; 400 missing `nodePath` / wrong type / malformed JSON; round-trip parity (the on-disk `.sm` after a UI-driven bump is byte-equal to what the CLI verb would produce). 8 cases pass.

UI half (Angular components, e2e) is the next agent's task and will flip 9.6.5 to ✅.
